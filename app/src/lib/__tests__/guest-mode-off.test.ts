import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { GUEST_MODE_ENABLED } from "../guest-quota";

// 🔴 **ゲスト（未登録）での利用は提供しない**（2026-08-31 の決定）。
//
// アプリのフラグ `kGuestModeEnabled` では**サーバは閉じない**。
// サーバは匿名 JWT を受けるので、Supabase の匿名サインインが有効なら
// 外部から使える。**実際に本番で匿名 OCR が 200 を返していた。**
//
// 戻すときは、この定数を true にする前に `guest-quota.ts` の
// 一覧（P0 3 件・P1 4 件）を塞ぐこと。

const code = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

test("🔴 サーバ側でゲストが閉じている", () => {
  assert.equal(GUEST_MODE_ENABLED, false,
    "🔴 開けるなら、guest-quota.ts の一覧を先に塞ぐこと");
});

test("🔴 OCR が匿名を断る", () => {
  const src = code(readFileSync("src/app/api/ocr/route.ts", "utf8"));
  assert.ok(src.includes("isAnonymous && !GUEST_MODE_ENABLED"),
    "🔴 匿名を断っていない。**アプリのフラグではサーバは閉じない**");
  // 断る位置が、費用の出る処理より前にあること。
  assert.ok(src.indexOf("isAnonymous && !GUEST_MODE_ENABLED") <
            src.indexOf("client.messages.create("),
    "🔴 断るのが Claude 呼び出しより後ろ");
});

test("🔴 attest の受け口が閉じている", () => {
  const src = code(readFileSync("src/app/api/guest/attest/route.ts", "utf8"));
  const hits = (src.match(/if \(!GUEST_MODE_ENABLED\)/g) ?? []).length;
  assert.equal(hits, 2, `🔴 GET と POST の両方を閉じること（いま ${hits} 箇所）`);
});
