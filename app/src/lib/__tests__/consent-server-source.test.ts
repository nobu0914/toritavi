// ============================================================================
// 🔴 **同意の判定が、クライアントから書き換えられない場所を見ていること**（§5.1）。
//
// 直す前は `raw_user_meta_data` を見ていた。そこは利用者自身が
// `supabase.auth.updateUser(data:)` で書ける。`ai-consent.ts` 自身が
// 「🔴 これは悪意ある利用者を止めない」と書いていた。
//
// ここで見るのは **経路**（何を材料にしているか）と **フェイルクローズ**。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AI_CONSENT_ENFORCE } from "../ai-consent.ts";
import { CONSENT_TABLE } from "../consent-store.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const OCR = "src/app/api/ocr/route.ts";
const STORE = "src/lib/consent-store.ts";

test("陰性対照: コメントを落とせている", () => {
  assert.ok(readFileSync(OCR, "utf8").includes("// 🔴"));
  assert.ok(!code(OCR).includes("// 🔴"), "🔴 コメントを落とせていない");
});

test("🔴 /api/ocr がサーバ側の記録で決めている", () => {
  const c = code(OCR);
  assert.ok(
    c.includes("decideAiConsentFromServer("),
    "🔴 サーバ側の記録を見ていない",
  );
  assert.ok(
    !c.includes("decideAiConsent(userMetadata"),
    "🔴 まだ raw_user_meta_data を材料にしている。利用者が書き換えられる",
  );
});

test("🔴 クライアントの申告を材料にしていない", () => {
  const c = code(OCR);
  // 本文から consent を読んでいたら、そこが穴になる。
  assert.ok(
    !/body\s*\.\s*consent|body\[["']consent|consent\s*[:=]\s*(true|body)/.test(c),
    "🔴 リクエストボディの consent を見ている",
  );
});

test("🔴 読めないときに ok にしない（フェイルクローズ）", () => {
  const c = code(STORE);
  assert.ok(c.includes('state: "unavailable"'), "🔴 unavailable の状態が無い");
  // 🔴 **型の宣言を数えない**（最初そうしていて、常に 2 になった）。
  //    読む関数の本体だけを見る。ok を返すのは 1 か所だけであること。
  const body = c.slice(c.indexOf("export async function readAiConsent"));
  const fn = body.slice(0, body.indexOf("\nexport "));
  const okReturns = (fn.match(/state:\s*"ok"/g) ?? []).length;
  assert.equal(
    okReturns,
    1,
    `🔴 readAiConsent が ok を返す箇所が ${okReturns} 個ある。` +
      "分岐が増えると、どれかが版や撤回を見ていない可能性がある",
  );
  assert.ok(
    c.includes("!== AI_CONSENT_VERSION"),
    "🔴 版の一致を見ていない",
  );
});

test("🔴 撤回済みは通さない／行を消していない", () => {
  const c = code(STORE);
  assert.ok(c.includes('state: "withdrawn"'), "🔴 撤回の状態が無い");
  assert.ok(
    c.includes('.update({ withdrawn_at') || c.includes("withdrawn_at:"),
    "🔴 撤回が update ではない",
  );
  assert.ok(
    !/\.delete\(\)/.test(c),
    "🔴 撤回で行を消している。いつ撤回したかが残らない",
  );
});

test("🔴 版はサーバの定数を書き込む（クライアントから受け取らない）", () => {
  const c = code(STORE);
  assert.ok(
    c.includes("document_version: AI_CONSENT_VERSION"),
    "🔴 版をクライアントから受け取っている。専用表にした意味が消える",
  );
});

test("🔴 IP・端末識別子を書いていない", () => {
  const c = code(STORE);
  assert.ok(
    !/ip_address|user_agent|device_id|idfa/i.test(c),
    "🔴 要らない識別子を記録している",
  );
});

test("陰性対照: 表の名前と、閉めるフラグが在る", () => {
  assert.equal(CONSENT_TABLE, "toritavi_consent_records");
  // 🔴 **値は固定しない。** 閉める・開けるは判断であって誤りではない。
  assert.equal(typeof AI_CONSENT_ENFORCE, "boolean");
});

test("🔴 いまはまだ閉めていない（表が未適用のため）", () => {
  // 表が本番に無いあいだに true にすると、全利用者が 403 になる。
  // ここは「閉めるな」ではなく **「閉めるなら順番を踏んだか」** の注意喚起。
  if (AI_CONSENT_ENFORCE) {
    console.log(
      "  注意: AI_CONSENT_ENFORCE = true。" +
        "consent_records.sql の適用と、記録が貯まったことの確認は済んでいるか",
    );
  }
});
