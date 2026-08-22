#!/usr/bin/env python3
"""ベンチの入力を用意する。

やることは 2 つだけ。

1. 画像を **アプリが実際に送るバイト列**へ揃える。
   `lib/features/journey/data/attachments.dart` の `prepareAttachment` と
   同じ段階（短辺 2000 / JPEG q82 から始め、4MB に収まるまで落とす）。
   ここを原本のまま流すと、実運用より綺麗な入力で採点することになり、
   「ベンチは通るのに実機で落ちる」を作り込む。
2. 正解表を 1 つの cases.json にまとめる。データ側の ground_truth.json は
   書式がデータセットごとに違うので、ここで一本化する。

使い方: python3 prepare.py <データroot> <出力先>
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
from pathlib import Path

from PIL import Image

# アプリ側 `prepareAttachment` の attempts と同じ。
ATTEMPTS = [(2000, 82), (1500, 78), (1100, 72), (800, 65)]
TARGET_BYTES = 4 * 1024 * 1024


def app_jpeg(src: Path) -> bytes:
    """アプリと同じ段階で JPEG 化する。"""
    im = Image.open(src)
    im = im.convert("RGB")
    w, h = im.size
    for dim, quality in ATTEMPTS:
        short = min(w, h)
        if short > dim:
            scale = dim / short
            resized = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        else:
            resized = im  # 拡大はしない（flutter_image_compress も同じ）
        buf = io.BytesIO()
        resized.save(buf, format="JPEG", quality=quality)
        out = buf.getvalue()
        if len(out) <= TARGET_BYTES:
            return out
    raise RuntimeError(f"再エンコードで目標サイズに収まらない: {src}")


# ---------------------------------------------------------------- 正解表

# text-samples の正解。ファイル本文から手で起こしたもの。
# **書いていない項目は採点しない**（None は「正解が null であること」を意味する）。
TEXT_EXPECT: dict[str, dict] = {
    "01_flight": {
        "steps": [{
            "category": "飛行機", "title": "NH225",
            "date": None, "startTime": "09:30", "endTime": "11:45",
            "from": "NRT", "to": "KIX", "confNumber": "ANA-882541",
        }],
        "note": "**日付がどこにも無い。**推測で埋めたら不合格。needsReview が立つべき。",
        "needsReview": True,
    },
    "02_train": {
        "steps": [{
            "category": "列車", "title": "のぞみ 225号",
            "date": "2026-04-15", "startTime": "10:00", "endTime": "12:33",
            "from": "東京", "to": "新大阪", "confNumber": "TK-882541",
        }],
    },
    "03_hotel": {
        "steps": [{
            "category": "宿泊", "title": "ホテル大阪ベイタワー",
            "date": "2026-04-15", "endDate": "2026-04-16",
            "startTime": "15:00", "endTime": "11:00", "confNumber": "HB-394021",
        }],
        "note": "「4月15日〜16日」を IN/OUT に割る。",
    },
    "04_hospital": {
        "steps": [{"category": "その他", "date": None}],
        # 「内科」は施設名（田中内科クリニック）の一部として出るので禁止語に
        # しない。落としたいのは**医療の項目**であって固有名詞ではない。
        "forbid": ["診療科", "診察券", "田中先生", "保険証"],
        "note": "**医療の安全規則。**受診予約は対象外＝カテゴリ「その他」。"
                "診療科・担当医・診察券番号を値として拾ってはいけない。"
                "年が無く月日だけなので date は補完（inferred に year）される想定。",
        "expectInferredYear": True,
        "skipDate": True,
    },
    "05_ticket": {
        "steps": [{
            "category": "観光", "title": "Mr.Children DOME TOUR 2026",
            "startTime": "18:00", "from": "東京ドーム", "confNumber": "TC-440291",
        }],
        "expectInferredYear": True,
        "note": "年が無い（タイトルの 2026 は公演名の一部で、日付の年ではない）。"
                "開場 16:00 ではなく開演 18:00 を startTime に取る。",
        "skipDate": True,
    },
    "06_restaurant": {
        "steps": [{
            "category": "食事", "title": "レストランオルフェ",
            "date": "2026-04-16", "startTime": "19:00", "confNumber": "RF-120456",
        }],
    },
    "07_bus": {
        "steps": [{
            "category": "バス", "title": "関西空港交通バス",
            "date": "2026-04-15", "startTime": "07:30", "endTime": "08:45",
            "from": "大阪駅前", "to": "関西空港", "confNumber": "KB-553012",
        }],
    },
    "08_business": {
        "steps": [{
            "category": "アポ",
            "date": "2026-04-17", "startTime": "14:00", "endTime": "16:00",
            "from": "グランフロント大阪 北館ビル 12F 会議室A",
        }],
        "note": "会議・商談は「アポ」（医療だけが対象外）。場所は表記ゆれを許容。",
        "loose": ["from"],
    },
    "09_flight_email": {
        "steps": [{
            "category": "飛行機", "title": "JL 317",
            "startTime": "08:15", "endTime": "10:15",
            "from": "HND", "to": "FUK", "confNumber": "JL-291034",
        }],
        "expectInferredYear": True,
        "note": "件名に「4月22日」。年が無い。",
        "skipDate": True,
    },
    "10_hotel_email": {
        "steps": [{
            "category": "宿泊", "title": "ホテルニューオータニ博多",
            "date": "2026-04-22", "endDate": "2026-04-23",
            "startTime": "14:00", "endTime": "10:00", "confNumber": "HN-672103",
        }],
    },
}


# データ同梱の ground_truth.json が**現在の仕様と食い違っている**分の上書き。
#
# 正解表はカテゴリ整理（医療を対象外にした・入場券を観光にした）より前に
# 作られていて、そのまま採点すると実装が正しいのに不合格になる。
# 「テストが緑であることを、仕様が正しい根拠にしない」の裏返しで、
# **正解表が赤いことも、実装が誤っている根拠にはならない**。
GT_OVERRIDE: dict[str, dict] = {
    # 同日で終わる予定の endDate。プロンプトは「同日なら null」と明記している。
    "02_train": {"drop": ["endDate"]},
    "03_bus": {"drop": ["endDate"]},
    # 医療機関の受診予約は本サービスの対象外 → カテゴリは「その他」。
    # 診療科をタイトルにしない（"内科 診察予約" は医療項目）。
    "08_appointment": {"category": "その他", "drop": ["title"]},
    # 展示会入場券はプロンプトの定義では「観光（入場券・予約バウチャー）」。
    "10_other": {"category": "観光", "loose": ["title"]},
    # レンタカーの title は会社名と車種のどちらでも通す。
    "09_rentalcar": {"loose": ["title"]},
    # 会場名がタイトルに続くことがある。
    "06_event": {"loose": ["title", "from"]},
}


def load_dataset_a(root: Path) -> list[dict]:
    """ocr_testdata2026-06-27（10 カテゴリ × clean/photo/pdf）。"""
    base = root / "ocr_testdata2026-06-27"
    gt = json.loads((base / "ground_truth.json").read_text(encoding="utf-8"))
    cases = []
    # 写真風と PDF は全部は回さない。傾き・影・低コントラストの効き方が
    # カテゴリで大きく変わらないので、書式が違うものを選ぶ。
    photo_pick = {"01_flight", "03_bus", "05_hotel", "07_dining", "09_rentalcar"}
    pdf_pick = {"01_flight", "05_hotel", "09_rentalcar"}
    for d in gt["documents"]:
        name = d["file"]
        step = {"category": d["category_key"], **d["expected_fixed_fields"]}
        ov = GT_OVERRIDE.get(name, {})
        if "category" in ov:
            step["category"] = ov["category"]
        for k in ov.get("drop", []):
            step.pop(k, None)
        expect = {
            "steps": [step],
            "note": d.get("notes", ""),
            "variable": d.get("expected_variable_info", {}),
            # 空港・駅・港の表記は書類に載っているまま返すのが正（固有名詞を
            # 訳さない規則）。"NRT" とだけ書いた正解表に対して
            # "東京/成田 NRT T1" は誤りではない。
            "loose": ["from", "to", "airline"] + ov.get("loose", []),
        }
        cases.append({
            "id": f"A_{name}_clean", "group": "画像(清書)", "kind": "image",
            "src": str(base / "png_clean" / f"{name}.png"), "expect": expect,
        })
        if name in photo_pick:
            cases.append({
                "id": f"B_{name}_photo", "group": "画像(写真風)", "kind": "image",
                "src": str(base / "png_photo" / f"{name}_photo.png"), "expect": expect,
            })
        if name in pdf_pick:
            cases.append({
                "id": f"C_{name}_pdf", "group": "PDF", "kind": "pdf",
                "src": str(base / "pdf" / f"{name}.pdf"), "expect": expect,
            })
    return cases


# 文書に年が書かれていない multistep。正解表は 2026 年で書いてあるが、
# 「年が無ければ最も近い将来の同じ月日」の規則では実行日によって年が変わる。
# 日付そのものは採点せず、**年を推測した印が立つか**だけを見る。
MULTISTEP_NO_YEAR = {"13_unsorted_summary"}

# multistep 側の正解表も、同日で終わる予定に endDate を入れている。
# プロンプトは「同日なら null」なので、そのままでは実装が正しくても外れる。
MULTISTEP_DROP_ENDDATE_WHEN_SAME_DAY = True


def load_dataset_multistep(root: Path) -> list[dict]:
    """1 書類に複数予定。steps[] の分割が要る一番難しい群。"""
    base = root / "ocr_testdata_multistep"
    gt = json.loads((base / "ground_truth.json").read_text(encoding="utf-8"))
    cases = []
    for d in gt["documents"]:
        steps = []
        for s in d["steps"]:
            st = {k: v for k, v in s.items() if k != "variable"}
            if (MULTISTEP_DROP_ENDDATE_WHEN_SAME_DAY
                    and st.get("endDate") == st.get("date")):
                st.pop("endDate")
            steps.append(st)
        cases.append({
            "id": f"M_{d['id']}", "group": "複数予定", "kind": "image",
            "src": str(base / "png" / f"{d['id']}.png"),
            "expect": {"steps": steps, "note": d.get("label", ""),
                       "stepCount": d.get("step_count"),
                       "loose": ["from", "to", "airline", "title"],
                       "skipDate": d["id"] in MULTISTEP_NO_YEAR,
                       "expectInferredYear": d["id"] in MULTISTEP_NO_YEAR},
        })
    return cases


def load_text_samples(root: Path) -> list[dict]:
    base = root / "テストデータ" / "text-samples"
    cases = []
    for name, expect in TEXT_EXPECT.items():
        p = base / f"{name}.txt"
        if not p.exists():
            print(f"  ! text sample not found: {p}", file=sys.stderr)
            continue
        cases.append({"id": f"T_{name}", "group": "テキスト貼付", "kind": "text",
                      "src": str(p), "expect": expect})
    return cases


def load_broken(root: Path) -> list[dict]:
    """劣化入力。**正解は「読めた値が正しい」ことではなく、捏造しないこと。**"""
    base = root / "テストデータ" / "broken-samples"
    picks = [
        ("broken_img_02_flight_low_contrast.jpg", "image", "低コントラスト"),
        ("broken_img_03_hotel_glare.jpg", "image", "強い映り込み"),
        ("broken_img_07_hospital_mixed_lang.jpg", "image", "多言語混在・医療"),
        ("broken_pdf_02_receipt_faded.pdf", "pdf", "褪色 PDF"),
    ]
    cases = []
    for fname, kind, note in picks:
        p = base / fname
        if not p.exists():
            continue
        cases.append({
            "id": f"X_{p.stem}", "group": "劣化入力", "kind": kind, "src": str(p),
            "expect": {"degraded": True, "note": note,
                       "forbid": ["診療科", "診察券"] if "hospital" in fname else []},
        })
    return cases


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    root = Path(sys.argv[1])
    out = Path(sys.argv[2])
    files = out / "files"
    files.mkdir(parents=True, exist_ok=True)

    cases: list[dict] = []
    cases += load_dataset_a(root)
    cases += load_dataset_multistep(root)
    cases += load_text_samples(root)
    cases += load_broken(root)

    # 自作の多言語サンプル（同梱）。海外展開の下見なので、日本語以外の
    # 書式・時刻表記・日付順を意図的に散らしてある。
    made = Path(__file__).parent / "samples"
    if made.exists():
        for p in sorted(made.glob("*.json")):
            spec = json.loads(p.read_text(encoding="utf-8"))
            txt = files / f"{spec['id']}.txt"
            txt.write_text(spec["text"], encoding="utf-8")
            # group は spec 側で上書きできる。多区間・変動項目多などを
            # 別グループとして数えたいため（既定は従来どおり）。
            cases.append({"id": spec["id"], "group": spec.get("group", "多言語(自作)"),
                          "kind": "text",
                          "src": str(txt), "lang": spec.get("lang", "ja"),
                          "expect": spec["expect"]})

    prepared = []
    for c in cases:
        src = Path(c["src"])
        if not src.exists():
            print(f"  ! missing: {src}", file=sys.stderr)
            continue
        if c["kind"] == "image":
            dst = files / f"{c['id']}.jpg"
            dst.write_bytes(app_jpeg(src))
        elif c["kind"] == "pdf":
            dst = files / f"{c['id']}.pdf"
            shutil.copyfile(src, dst)
        else:
            dst = files / f"{c['id']}.txt"
            if dst.resolve() != src.resolve():
                shutil.copyfile(src, dst)
        c["file"] = os.path.relpath(dst, out)
        c.setdefault("lang", "ja")
        c.pop("src")
        prepared.append(c)

    (out / "cases.json").write_text(
        json.dumps(prepared, ensure_ascii=False, indent=2), encoding="utf-8")
    by_group: dict[str, int] = {}
    for c in prepared:
        by_group[c["group"]] = by_group.get(c["group"], 0) + 1
    print(f"{len(prepared)} 件 → {out/'cases.json'}")
    for g, n in by_group.items():
        print(f"  {g}: {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
