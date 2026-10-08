// AI の出力を信用せずに受ける。**文書に書かれた文字列がそのまま出てくる前提。**
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeOcrResult, MAX_STEPS, MAX_VALUE_CHARS } from "../ocr-output.ts";

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
    assert.deepEqual(Object.keys(r.steps[0]).sort(), ["category", "fixed", "variable"]);
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

  test("飛行機以外には触らない（列車番号・バスの便名）", () => {
    assert.equal(title("列車", "AB12"), "AB12");
    assert.equal(title("バス", "KB101"), "KB101");
  });
});
