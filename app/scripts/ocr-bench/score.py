#!/usr/bin/env python3
"""ベンチ結果を正解表と突き合わせる。

**「全部一致」を目標にしない。**書類には正解が一つに決まらない項目がある
（食事の from に住所と店名のどちらを入れるか等）。だから

- `loose` に挙げた項目は「部分一致」で見る
- 正解表に書いていない項目は採点しない
- `date: null` は「null であるべき」という主張として採点する（読めなかった
  ことが正解の場合がある。ここを甘くすると捏造を見逃す）

を守る。合否よりも**どこがどう外れたか**を出すのが仕事。

使い方: python3 score.py <stageDir> <outDir> [--json レポート出力先]
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

FIELDS = ["title", "airline", "date", "endDate", "startTime", "endTime",
          "from", "to", "confNumber"]


def norm(v) -> str:
    if v is None:
        return ""
    s = unicodedata.normalize("NFKC", str(v)).strip().lower()
    s = re.sub(r"[\s　\-–—_/()（）,、。．.]+", "", s)
    return s


def loose_hit(exp, got) -> bool:
    a, b = norm(exp), norm(got)
    if not a:
        return True
    return bool(a) and bool(b) and (a in b or b in a)


# 移動でないカテゴリは `to` 欄を持たない。アプリは受け取った `to` を `from` へ
# 寄せる（ocr_service.dart の coalesceLocation）ので、住所が `to` に入って
# 返ってきても利用者の目には正しく出る。ここもそれに合わせないと、
# **アプリが直しているものを不合格として数える**ことになる。
NO_TO_CATEGORIES = {"宿泊", "食事", "アポ", "観光", "その他"}


def coalesce_location(category: str, frm, to):
    if category in NO_TO_CATEGORIES and not frm and to:
        return to, None
    return frm, to


def cmp_step(exp: dict, got_fixed: dict, loose: list[str], skip_date: bool):
    """1 step ぶんの項目照合。戻り値は (一致数, 全体数, 不一致リスト)。"""
    hit = miss = 0
    diffs = []
    for f in FIELDS:
        if f not in exp:
            continue
        if skip_date and f in ("date", "endDate"):
            continue
        want = exp[f]
        got = got_fixed.get(f)
        if want is None:
            ok = got is None or norm(got) == ""
        elif f in loose:
            ok = loose_hit(want, got)
        else:
            ok = norm(want) == norm(got)
        if ok:
            hit += 1
        else:
            miss += 1
            diffs.append((f, want, got))
    return hit, miss, diffs


def pick_order(exp_steps: list[dict], got_steps: list[dict]) -> list[int]:
    """正解 step に対応する出力 step の index を貪欲に選ぶ。

    出力順が正解順と違うことがある（分割の並びは仕様で縛っていない）ので、
    順番違いを不一致として数えないための対応付け。
    """
    used: set[int] = set()
    order = []
    for e in exp_steps:
        best, best_score = -1, -1
        for i, g in enumerate(got_steps):
            if i in used:
                continue
            fx = g.get("fixed") or {}
            score = 0
            for key in ("title", "date", "confNumber", "from", "to", "startTime"):
                if key in e and e[key] is not None and norm(e[key]) == norm(fx.get(key)):
                    score += 2
            if e.get("category") and e["category"] == g.get("category"):
                score += 1
            if score > best_score:
                best, best_score = i, score
        if best >= 0:
            used.add(best)
        order.append(best)
    return order


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    stage, out = Path(sys.argv[1]), Path(sys.argv[2])
    cases = {c["id"]: c for c in json.loads((stage / "cases.json").read_text(encoding="utf-8"))}

    rows = []
    for cid, c in cases.items():
        p = out / f"{cid}.json"
        if not p.exists():
            continue
        rec = json.loads(p.read_text(encoding="utf-8"))
        exp = c["expect"]
        row = {"id": cid, "group": c["group"], "kind": c["kind"],
               "ok": rec.get("ok", False), "problems": [], "diffs": [],
               "hit": 0, "miss": 0, "note": exp.get("note", "")}
        rows.append(row)
        if not rec.get("ok"):
            row["problems"].append(f"呼び出し失敗: {rec.get('error', 'JSON取り出し失敗')}")
            continue
        got_steps = (rec.get("result") or {}).get("steps") or []

        # --- 出してはいけない語（医療の安全規則など）
        blob = json.dumps(rec.get("result"), ensure_ascii=False)
        for word in exp.get("forbid", []):
            if word in blob:
                row["problems"].append(f"禁止語が出力に含まれる: 「{word}」")

        if exp.get("degraded"):
            # 劣化入力は「読めたか」ではなく「捏造していないか」を見る。
            row["degraded"] = True
            row["stepCount"] = len(got_steps)
            continue

        exp_steps = exp.get("steps") or []
        if exp.get("stepCount") and len(got_steps) != exp["stepCount"]:
            row["problems"].append(
                f"予定の数が違う: 正解 {exp['stepCount']} / 出力 {len(got_steps)}")
        elif len(got_steps) != len(exp_steps):
            row["problems"].append(
                f"予定の数が違う: 正解 {len(exp_steps)} / 出力 {len(got_steps)}")

        order = pick_order(exp_steps, got_steps)
        loose = exp.get("loose", [])
        for i, e in enumerate(exp_steps):
            gi = order[i]
            if gi < 0:
                row["problems"].append(f"step{i + 1} に対応する出力が無い")
                row["miss"] += len([f for f in FIELDS if f in e])
                continue
            g = got_steps[gi]
            if e.get("category") and e["category"] != g.get("category"):
                row["problems"].append(
                    f"step{i + 1} カテゴリ: 正解 {e['category']} / 出力 {g.get('category')}")
            fx = dict(g.get("fixed") or {})
            fx["from"], fx["to"] = coalesce_location(
                g.get("category", ""), fx.get("from"), fx.get("to"))
            h, m, d = cmp_step(e, fx, loose, exp.get("skipDate", False))
            row["hit"] += h
            row["miss"] += m
            row["diffs"] += [(f"step{i + 1}", *x) for x in d]

        # --- inferred の主張
        infer_all = set()
        for g in got_steps:
            infer_all |= set(g.get("inferred") or [])
        if exp.get("expectInferredYear") and "year" not in infer_all:
            row["problems"].append("年が書かれていないのに inferred に year が無い")
        if exp.get("needsReview") and not any(g.get("needsReview") for g in got_steps):
            row["problems"].append("要確認が立つべきなのに立っていない")

        # --- 出力言語
        if exp.get("labelLang") == "en":
            labels = [v.get("label", "") for g in got_steps for v in (g.get("variable") or [])]
            jp = [x for x in labels if re.search(r"[ぁ-んァ-ン一-龥]", x)]
            if jp:
                row["problems"].append(f"出力言語 en を指定したのに日本語ラベル: {jp}")

    # ---------------------------------------------------------------- 出力
    print(f"\n{'=' * 78}\nOCR ベンチ結果  {len(rows)} 件\n{'=' * 78}")
    by_group: dict[str, list] = {}
    for r in rows:
        by_group.setdefault(r["group"], []).append(r)

    for g, rs in by_group.items():
        hit = sum(r["hit"] for r in rs)
        miss = sum(r["miss"] for r in rs)
        clean = [r for r in rs if not r["problems"] and not r["diffs"]]
        total = hit + miss
        rate = f"{hit}/{total} ({hit * 100 // total}%)" if total else "—"
        print(f"\n■ {g}   完全一致 {len(clean)}/{len(rs)} 件   項目 {rate}")
        for r in rs:
            mark = "✓" if not r["problems"] and not r["diffs"] else "✗"
            extra = f"  [予定 {r['stepCount']} 件]" if r.get("degraded") else ""
            print(f"  {mark} {r['id']}{extra}")
            for p in r["problems"]:
                print(f"      ! {p}")
            for step, f, want, got in r["diffs"]:
                print(f"      · {step}.{f}: 正解「{want}」 → 出力「{got}」")

    hit = sum(r["hit"] for r in rows)
    miss = sum(r["miss"] for r in rows)
    clean = [r for r in rows if not r["problems"] and not r["diffs"]]
    print(f"\n{'=' * 78}")
    print(f"完全一致 {len(clean)}/{len(rows)} 件   項目一致 {hit}/{hit + miss} "
          f"({hit * 100 // max(1, hit + miss)}%)")
    hard = [r for r in rows if r["problems"]]
    print(f"要対応（項目差ではなく主張の誤り）: {len(hard)} 件")

    # --- 揺れ（--repeat で複数回投げた分）
    reps: dict[str, list] = {}
    for p in out.glob("*__r*.json"):
        base = p.name.split("__r")[0]
        reps.setdefault(base, []).append(p)
    if reps:
        print(f"\n■ 揺れの確認（同じ入力を複数回）")
        for base, paths in sorted(reps.items()):
            allp = [out / f"{base}.json"] + sorted(paths)
            sigs = []
            for p in allp:
                if not p.exists():
                    continue
                r = json.loads(p.read_text(encoding="utf-8"))
                steps = (r.get("result") or {}).get("steps") or []
                sigs.append(json.dumps(
                    [{k: (s.get("fixed") or {}).get(k) for k in FIELDS} for s in steps],
                    ensure_ascii=False, sort_keys=True))
            uniq = len(set(sigs))
            mark = "✓" if uniq == 1 else "✗"
            print(f"  {mark} {base}: {len(sigs)} 回中 {uniq} 通り")
            if uniq > 1:
                for s in sorted(set(sigs)):
                    print(f"      {s}")

    if len(sys.argv) > 4 and sys.argv[3] == "--json":
        Path(sys.argv[4]).write_text(json.dumps(rows, ensure_ascii=False, indent=2),
                                     encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
