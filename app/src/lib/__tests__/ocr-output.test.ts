// AI の出力を信用せずに受ける。**文書に書かれた文字列がそのまま出てくる前提。**
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeOcrResult, parseWeekday, MAX_STEPS, MAX_VALUE_CHARS } from "../ocr-output.ts";

describe("形が違うものは捨てる", () => {
  test("steps が無ければ空（落ちない）", () => {
    assert.deepEqual(sanitizeOcrResult({}).steps, []);
    assert.deepEqual(sanitizeOcrResult(null).steps, []);
    assert.deepEqual(sanitizeOcrResult("x").steps, []);
  });

  test("step でないものは落とす", () => {
    const r = sanitizeOcrResult({ steps: [1, "a", null, { category: "飛行機" }] });
    assert.equal(r.steps.length, 1);
    assert.ok(r.dropped >= 3);
  });
});

describe("量の上限", () => {
  test("🔴 件数を膨らませられない", () => {
    const many = Array.from({ length: 500 }, () => ({ category: "その他", fixed: {}, variable: [] }));
    const r = sanitizeOcrResult({ steps: many });
    assert.equal(r.steps.length, MAX_STEPS);
    assert.ok(r.dropped > 0, "捨てたことを黙らない");
  });

  test("🔴 巨大な文字列を切る", () => {
    const r = sanitizeOcrResult({
      steps: [{ category: "宿泊", fixed: { name: "あ".repeat(100_000) }, variable: [] }],
    });
    assert.equal(r.steps[0].fixed.name.length, MAX_VALUE_CHARS);
  });
});

describe("🔴 危険な URL", () => {
  test("javascript: / data: は空にする", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
      const r = sanitizeOcrResult({ steps: [{ category: "宿泊", fixed: { url: bad }, variable: [] }] });
      assert.equal(r.steps[0].fixed.url, "", `${bad} が残っている`);
      assert.ok(r.dropped > 0);
    }
  });

  test("http / https は残す", () => {
    const r = sanitizeOcrResult({
      steps: [{ category: "宿泊", fixed: { url: "https://example.com/x" }, variable: [] }],
    });
    assert.equal(r.steps[0].fixed.url, "https://example.com/x");
  });

  test("スキームの無い普通の値は残す（住所・便名など）", () => {
    const r = sanitizeOcrResult({
      steps: [{ category: "飛行機", fixed: { flight: "NZ90", addr: "東京都千代田区1-1" }, variable: [] }],
    });
    assert.equal(r.steps[0].fixed.flight, "NZ90");
    assert.equal(r.steps[0].fixed.addr, "東京都千代田区1-1");
  });
});

describe("知らないキーは持ち込ませない", () => {
  test("step の余計なプロパティは落ちる", () => {
    const r = sanitizeOcrResult({
      steps: [{ category: "宿泊", fixed: {}, variable: [], __proto__hack: "x", script: "y" }],
    });
    assert.deepEqual(Object.keys(r.steps[0]).sort(), [
      "category",
      "fixed",
      "inferred",
      "needsReview",
      "variable",
    ]);
  });
});

describe("🔴 推定の印を捨てない（2026-10-08）", () => {
  // 2026-08-22〜10-08 は inferred / needsReview をここで捨てていた。
  // アプリは inferred を見て要確認を出し、"year" を見て年ズレ補正をする。
  test("inferred と needsReview がアプリまで届く", () => {
    const r = sanitizeOcrResult({
      steps: [
        {
          category: "飛行機",
          fixed: { title: "NH 10", date: "2026-12-26" },
          variable: [],
          inferred: ["endDate", "year"],
          needsReview: true,
        },
      ],
    });
    assert.deepEqual(r.steps[0].inferred, ["endDate", "year"]);
    assert.equal(r.steps[0].needsReview, true);
  });

  test("無ければ空配列・false（落ちない）", () => {
    const r = sanitizeOcrResult({ steps: [{ category: "宿泊", fixed: {}, variable: [] }] });
    assert.deepEqual(r.steps[0].inferred, []);
    assert.equal(r.steps[0].needsReview, false);
  });

  test("キーの形でないもの・文字列でないもの・真偽値でないものは通さない", () => {
    const r = sanitizeOcrResult({
      steps: [
        {
          category: "宿泊",
          fixed: {},
          variable: [],
          inferred: ["date", "javascript:alert(1)", 1, null, "あ", "x".repeat(100), "date"],
          needsReview: "true",
        },
      ],
    });
    assert.deepEqual(r.steps[0].inferred, ["date"]);
    assert.equal(r.steps[0].needsReview, false);
    assert.ok(r.dropped >= 5, "捨てたことを黙らない");
  });

  test("件数を膨らませられない", () => {
    const r = sanitizeOcrResult({
      steps: [{ category: "宿泊", fixed: {}, variable: [], inferred: Array.from({ length: 500 }, (_, i) => `k${i}`) }],
    });
    assert.ok(r.steps[0].inferred.length <= 20);
  });
});

describe("飛行機の便名の形を揃える（2026-10-08）", () => {
  const title = (category: string, t: string) =>
    sanitizeOcrResult({ steps: [{ category, fixed: { title: t }, variable: [] }] }).steps[0].fixed.title;

  test("コードと数字の間に空白を入れる", () => {
    assert.equal(title("飛行機", "NH118"), "NH 118");
    assert.equal(title("飛行機", "DL 2844"), "DL 2844");
    assert.equal(title("飛行機", "NH  10"), "NH 10");
  });

  test("🔴 文字は変えない（先頭の 0 を残す・数字が英字始まりのコードも扱う）", () => {
    assert.equal(title("飛行機", "ZG029"), "ZG 029");
    assert.equal(title("飛行機", "9C8501"), "9C 8501");
    assert.equal(title("飛行機", "B6123"), "B6 123");
  });

  test("形が違うものには触らない", () => {
    assert.equal(title("飛行機", "EK 1234 / FZ0567"), "EK 1234 / FZ0567");
    assert.equal(title("飛行機", "Delta Air Lines フライト 1234"), "Delta Air Lines フライト 1234");
    assert.equal(title("飛行機", "12345"), "12345");
  });

  test("🔴 予約番号を便名にしたものは航空会社名に替える", () => {
    const one = (fixed: Record<string, string>) =>
      sanitizeOcrResult({ steps: [{ category: "飛行機", fixed, variable: [] }] }).steps[0].fixed.title;
    assert.equal(one({ title: "NH AB12CD", confNumber: "NH-AB12CD", airline: "ANA" }), "ANA");
    // 航空会社名が無ければ触らない（値を作らない）
    assert.equal(one({ title: "NH AB12CD", confNumber: "NH-AB12CD" }), "NH AB12CD");
    // 普通の便名には触らない
    assert.equal(one({ title: "NH 10", confNumber: "AB12CD", airline: "ANA" }), "NH 10");
  });

  test("飛行機以外には触らない（列車番号・バスの便名）", () => {
    assert.equal(title("列車", "AB12"), "AB12");
    assert.equal(title("バス", "KB101"), "KB101");
  });
});

describe("曜日の照合（2026-10-08・日・月の取り違え）", () => {
  const run = (fixed: Record<string, string>, inferred: string[] = []) =>
    sanitizeOcrResult({ steps: [{ category: "車", fixed, variable: [], inferred }] }).steps[0];

  test("曜日の書き方を読む（知らない書き方は null）", () => {
    assert.equal(parseWeekday("金"), 5);
    assert.equal(parseWeekday("(土)"), 6);
    assert.equal(parseWeekday("日曜日"), 0);
    assert.equal(parseWeekday("Fri"), 5);
    assert.equal(parseWeekday("Thursday"), 4);
    assert.equal(parseWeekday("Thurs."), 4);
    assert.equal(parseWeekday("星期五"), 5);
    assert.equal(parseWeekday("周日"), 0);
    assert.equal(parseWeekday("금요일"), 5);
    assert.equal(parseWeekday("Friyay"), null);
    assert.equal(parseWeekday("vendredi"), null);
    assert.equal(parseWeekday(""), null);
  });

  test("曜日が合えばそのまま・印も付けない", () => {
    // 2026-04-03 は金曜
    const s = run({ date: "2026-04-03", dateWeekday: "金" });
    assert.equal(s.fixed.date, "2026-04-03");
    assert.deepEqual(s.inferred, []);
    assert.equal(s.needsReview, false);
  });

  test("🔴 日と月を入れ替えると合うなら入れ替え、推定の印を付ける", () => {
    // "金, 03 4, 2026" を 2026-03-04（水曜）と読んだ → 2026-04-03（金曜）
    // 返却日も同じ: 2026-06-04（木曜）と読んだ "Mon" → 2026-04-06（月曜）
    const s = run({ date: "2026-03-04", dateWeekday: "金", endDate: "2026-06-04", endDateWeekday: "Mon" });
    assert.equal(s.fixed.date, "2026-04-03");
    assert.equal(s.fixed.endDate, "2026-04-06");
    assert.ok(s.inferred.includes("date"));
    assert.ok(s.inferred.includes("endDate"));
    assert.equal(s.needsReview, true);
  });

  test("どちらでも合わなければ値は変えず、印だけ付ける", () => {
    // 2026-04-03 は金曜・2026-03-04 は水曜。「月」はどちらとも合わない
    const s = run({ date: "2026-04-03", dateWeekday: "月" });
    assert.equal(s.fixed.date, "2026-04-03");
    assert.ok(s.inferred.includes("date"));
    assert.equal(s.needsReview, true);
  });

  test("年を補った日付は入れ替えない（曜日のずれは年のせいかもしれない）", () => {
    const s = run({ date: "2026-03-04", dateWeekday: "金" }, ["year"]);
    assert.equal(s.fixed.date, "2026-03-04");
    assert.ok(s.inferred.includes("date"));
  });

  test("曜日の欄はアプリへ送らない", () => {
    const s = run({ date: "2026-04-03", dateWeekday: "金", endDateWeekday: "" });
    assert.equal("dateWeekday" in s.fixed, false);
    assert.equal("endDateWeekday" in s.fixed, false);
  });
});
