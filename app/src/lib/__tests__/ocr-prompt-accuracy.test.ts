// 読み取り精度の規則（2026-10-08・実データ 186 件の検査で確定した誤り）。
//
// どれも「指示文に書いていなかった／逆のことを書いていた」ことが原因だった。
// 文面が後から書き換わって規則が抜けると、**落ちも警告も出ずに**誤りが戻る
// （`CLAUDE.md` §6-1）。ここで「指示文に入っている」ことを固定する。
//
// - #2 乗継便が variable の「乗り継ぎ情報」に押し込まれ、区間が予定から消えた
//      （「通常は1要素、往復時は2要素」と書いていた）
// - #4 日・月の順の予約確認で、曜日の合わない側の日付を返した
// - #5 印字された到着日を計算で直した／到着日の無い搭乗券で到着日を埋めた
//      （inferred の例に「到着日を出発日+所要時間から推定」と書いていた）
// - #7 運賃明細・注意書きのページから、日付の無い予定を作った
// - 便名の形が揺れた（"Delta Air Lines フライト 1234" と "DL1234"）
//
// 🔴 **公開中の版（features を送らない）にも同じ規則が入る**ことを見る。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../ocr-prompt.ts";

const TODAY = "2026-10-08";
const variants = () =>
  ["日本語", "English"].flatMap((lang) => [
    { name: `${lang}・合図なし`, p: buildSystemPrompt(lang, TODAY) },
    { name: `${lang}・booking_service`, p: buildSystemPrompt(lang, TODAY, { bookingService: true }) },
  ]);

describe("#2 区間を漏れなく返す", () => {
  test("区間（便名）ごとに 1 要素・乗継を variable にまとめない", () => {
    for (const { name, p } of variants()) {
      assert.ok(p.includes("区間（便名・列車名ひとつ）ごとに1要素"), name);
      assert.ok(p.includes("乗継便を variable（乗り継ぎ情報）にまとめない"), name);
      assert.ok(p.includes("数え直す"), name);
    }
  });

  test("🔴 「通常は1要素、往復時は2要素」に戻さない", () => {
    for (const { name, p } of variants()) {
      assert.equal(p.includes("往復時は2要素"), false, name);
      assert.equal(p.includes("通常は1要素"), false, name);
    }
  });
});

describe("#4 日・月の順序は曜日で決める", () => {
  test("同じ書類の日付は同じ順序・曜日を照合する", () => {
    for (const { name, p } of variants()) {
      assert.ok(p.includes("同じ書類の日付は\n  全部同じ順序で書かれている"), name);
      assert.ok(p.includes("返す前に必ず曜日を照合する"), name);
      assert.ok(p.includes("書かれた曜日と一致する方"), name);
    }
  });

  test("例の曜日が正しい（誤った例を教えない）", () => {
    // 指示文の例: 2026-04-03 は金曜・2026-03-04 は水曜
    assert.equal(new Date(Date.UTC(2026, 3, 3)).getUTCDay(), 5);
    assert.equal(new Date(Date.UTC(2026, 2, 4)).getUTCDay(), 3);
  });
});

describe("#5 到着日は印字を写す・無ければ null", () => {
  test("印字どおり・計算しない・書かれていなければ null", () => {
    for (const { name, p } of variants()) {
      assert.ok(p.includes("書類に印字された到着日をそのまま"), name);
      assert.ok(p.includes("時差・所要時間から計算して直さない"), name);
      assert.ok(p.includes("到着日が書類に書かれていなければ endDate は null"), name);
    }
  });

  test("計算で埋めたら必ず inferred", () => {
    for (const { name, p } of variants()) {
      assert.ok(p.includes("推定・計算で埋めた値は必ずここに入れる"), name);
    }
  });

  test("🔴 「到着日を出発日+所要時間から推定」を例として教えない", () => {
    for (const { name, p } of variants()) {
      assert.equal(p.includes("出発日+所要時間"), false, name);
      assert.equal(p.includes("到着が翌日の場合はendDateに到着日を入れる"), false, name);
    }
  });
});

describe("#7 予定の無いページから予定を作らない", () => {
  test("運賃明細・約款・注意書きのページは空配列", () => {
    for (const { name, p } of variants()) {
      assert.ok(p.includes("運賃明細"), name);
      assert.ok(p.includes('{"steps": []}'), name);
      assert.ok(p.includes("日付も時刻も無い step は返さない"), name);
    }
  });
});

describe("便名の形", () => {
  test("2 文字コード + 半角スペース + 数字・コードシェアは予約した便名", () => {
    for (const { name, p } of variants()) {
      assert.ok(p.includes("航空会社の2文字コード + 半角スペース + 便名の数字"), name);
      assert.ok(p.includes("先頭の 0 を消さない"), name);
      assert.ok(p.includes("運航便名は variable に入れる"), name);
    }
  });
});
