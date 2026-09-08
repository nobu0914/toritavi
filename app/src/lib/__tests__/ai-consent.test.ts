// サーバ側の許諾検査（JR000206）。
//
// 🔴 **いまは観測だけ。** 実測で 20 人中 14 人が記録を持っていないので、
// 拒否にすると課金中の利用者の OCR が止まる。**先に広げて、後で締める。**
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import {
  AI_CONSENT_ENFORCE,
  AI_CONSENT_VERSION,
  classifyAiConsent,
  decideAiConsent,
  hasAiConsent,
  observeAiConsent,
} from "../ai-consent.ts";

describe("許諾の判定", () => {
  test("いまの版を持っていれば許諾済み", () => {
    assert.equal(hasAiConsent({ ai_consent_version: AI_CONSENT_VERSION }), true);
  });

  test("🔴 記録が無ければ未許諾（null / 空 / 別の型）", () => {
    assert.equal(hasAiConsent(null), false);
    assert.equal(hasAiConsent(undefined), false);
    assert.equal(hasAiConsent({}), false);
    assert.equal(hasAiConsent({ ai_consent_version: "" }), false);
    assert.equal(hasAiConsent({ ai_consent_version: 20260818 }), false);
  });

  test("🔴 古い版は未許諾（版を上げたら取り直す）", () => {
    assert.equal(hasAiConsent({ ai_consent_version: "2020-01-01" }), false);
    const o = classifyAiConsent({ ai_consent_version: "2020-01-01" });
    assert.equal(o.state, "stale");
  });

  test("分類が 3 つに分かれる", () => {
    assert.equal(classifyAiConsent({}).state, "missing");
    assert.equal(
      classifyAiConsent({ ai_consent_version: AI_CONSENT_VERSION }).state,
      "ok"
    );
  });
});

describe("観測は通す・通さないを変えない", () => {
  test("🔴 記録が無くても投げない（いまは拒否しない）", () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => warns.push(a.join(" "));
    try {
      const o = observeAiConsent({}, "/api/ocr");
      assert.equal(o.state, "missing");
      assert.equal(warns.length, 1, "記録が無いことを黙らない");
      assert.ok(!warns[0].includes("@"), "ログに宛先や PII を出さない");
    } finally {
      console.warn = orig;
    }
  });

  test("許諾済みなら何も言わない（黄を常駐させない）", () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => warns.push(a.join(" "));
    try {
      observeAiConsent({ ai_consent_version: AI_CONSENT_VERSION }, "/api/ocr");
      assert.equal(warns.length, 0);
    } finally {
      console.warn = orig;
    }
  });
});

describe("アプリ側と版が一致している", () => {
  // 🔴 **ずれると、アプリは「許諾済み」と思っているのにサーバは未許諾と数える。**
  //    観測の段階では実害が無いが、拒否へ切り替えた日に**全員が弾かれる。**
  test("🔴 kAiConsentVersion と同じ値", () => {
    const p = `${os.homedir()}/Dev/toritavi_app/lib/features/scan/domain/ai_consent.dart`;
    if (!fs.existsSync(p)) {
      assert.fail(
        `🔴 ${p} が無い。アプリ側の版を読めないと突き合わせできない ——\n` +
          "  「読めなかった」を合格にしない。リポジトリを取得すること"
      );
    }
    const m = fs.readFileSync(p, "utf8").match(/kAiConsentVersion\s*=\s*'([^']+)'/);
    assert.ok(m, "kAiConsentVersion を読み取れない（書き方が変わった？）");
    assert.equal(
      AI_CONSENT_VERSION,
      m![1],
      "🔴 サーバとアプリで許諾の版がずれている"
    );
  });
});

// ============================================================================
// 🔴 2 段目の門（JR000206）
//
// `AI_CONSENT_ENFORCE` が false のあいだは**観測だけ**。
// ここで固定するのは「閉めていないあいだ、挙動が変わらないこと」と、
// 「閉めたときに正しく拒否すること」の**両方**。
//
// 片方だけだと、閉める日に初めて動く経路ができる ——
// そこにだけ穴があると、閉めた瞬間に落ちる。
// ============================================================================
test("🔴 閉めていないあいだは、許諾が無くても通す", () => {
  // ここが false でなくなったら、それは意図的な変更のはず。
  // **黙って true になっていたら、課金中の利用者の OCR が止まる。**
  assert.equal(
    AI_CONSENT_ENFORCE,
    false,
    "AI_CONSENT_ENFORCE を true にした。\n" +
      "  🔴 Vercel のログで [ai-consent] が 0 件になったことを確かめたか？\n" +
      "  残っているうちに閉めると、課金中の利用者の OCR が止まる。\n" +
      "  意図した変更なら、この検査も一緒に直すこと",
  );
  for (const meta of [null, {}, { ai_consent_version: "1999-01-01" }]) {
    assert.equal(decideAiConsent(meta, "/api/ocr").allow, true);
  }
});

test("🔴 許諾済みなら、閉めていても通る", () => {
  const meta = { ai_consent_version: AI_CONSENT_VERSION };
  const d = decideAiConsent(meta, "/api/ocr");
  assert.equal(d.allow, true);
  assert.equal(d.observation.state, "ok");
});

test("陰性対照: 判定そのものは、閉めていなくても走っている", () => {
  // 「閉めるまで何も見ない」実装だと、閉めた日に初めて動く経路になる。
  assert.equal(decideAiConsent(null, "/api/ocr").observation.state, "missing");
  assert.equal(
    decideAiConsent({ ai_consent_version: "1999-01-01" }, "/api/ocr").observation
      .state,
    "stale",
  );
});
