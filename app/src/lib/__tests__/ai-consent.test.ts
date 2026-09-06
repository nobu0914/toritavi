// サーバ側の許諾検査（JR000206）。
//
// 🔴 **いまは観測だけ。** 実測で 20 人中 14 人が記録を持っていないので、
// 拒否にすると課金中の利用者の OCR が止まる。**先に広げて、後で締める。**
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import {
  AI_CONSENT_VERSION,
  classifyAiConsent,
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
