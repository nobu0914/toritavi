// ============================================================================
// 🔴 **旧アドレスへの変更通知が、サーバ側でも閉じていること**（JR000255）。
//
// アプリ側は `kEmailChangeNoticeEnabled = false` で**呼ばないだけ。
// API は生きている**（2026-09-08 に本番で POST に 401 を実測）。
// **アプリのフラグはサーバを閉じない**（`CLAUDE.md` §5）。
//
// 🔴 **開けると 2 つが同時に破れる。**
//   ① Resend は**日本語 PP の委託先一覧に無い**（未稼働なので載せていない）。
//      開いた瞬間、公開文書に書いていない委託先へアドレスと本文が渡る
//   ② 文面が**日本語固定**。件名も本文も `lang` の分岐が無い
//
// だから「開けたら赤くなる」形にしてある。**注記だけでは読まれない。**
// ============================================================================
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { test } from "node:test";
import { EMAIL_CHANGE_NOTICE_ENABLED } from "../email-notice-flags.ts";

/** 行コメントを落とす。**注記に名前があるだけで通さない。** */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const ROUTE = "src/app/api/account/email-change-notice/route.ts";

test("🔴 通知はサーバ側でも閉じたまま", () => {
  assert.equal(
    EMAIL_CHANGE_NOTICE_ENABLED,
    false,
    "EMAIL_CHANGE_NOTICE_ENABLED を true にした。\n" +
      "  🔴 開けるときは 5 つ同時に動かす —— アプリの kEmailChangeNoticeEnabled ／\n" +
      "  ここ ／ 通知の文面を日英に分ける ／ 日英の PP に Resend を委託先として\n" +
      "  載せる ／ Supabase の Secure email change を OFF（最後）",
  );
});

test("🔴 POST がフラグで落ちる（配線されている）", () => {
  const c = code(ROUTE);
  assert.ok(
    c.includes("if (!EMAIL_CHANGE_NOTICE_ENABLED)"),
    "🔴 ルートにフラグの門が無い。定数があっても API は開いたまま",
  );
});

test("🔴 門が、認証や DB の読み取りより前にある", () => {
  // 閉じている機能のために利用者を引き直す理由が無い。
  // 🔴 **import 行を数えない**（concierge の検査で一度掴んだ）。呼び出し側を見る。
  const c = code(ROUTE);
  const gate = c.indexOf("if (!EMAIL_CHANGE_NOTICE_ENABLED)");
  const auth = c.indexOf("await authenticateRequest(");
  const db = c.indexOf("createServiceClient()");
  assert.ok(gate > -1, "門が無い");
  assert.ok(gate < auth, `🔴 門(${gate}) が認証(${auth}) より後ろ`);
  assert.ok(gate < db, `🔴 門(${gate}) が DB 読み取り(${db}) より後ろ`);
});

test("🔴 環境変数で開けられる形になっていない", () => {
  // 環境変数だとコードに痕跡が残らず、git で戻せない（CLAUDE.md §4）。
  const flags = code("src/lib/email-notice-flags.ts");
  assert.ok(
    !/process\.env/.test(flags),
    "🔴 環境変数を読んでいる。いつ誰が開けたかが git から追えなくなる",
  );
});

// ---------------------------------------------------------------------------
// 🔴 開けたときに、公開文書と文面が追いついているか
// ---------------------------------------------------------------------------

const SITE = `${homedir()}/Dev/company-site`;
const PP_JA = `${SITE}/legal-drafts/shared-privacy.ja.md`;
const PP_EN = `${SITE}/legal-drafts/junros-privacy.en.md`;

test("🔴 有効にするなら、日英の PP に Resend が委託先として載っている", () => {
  if (!EMAIL_CHANGE_NOTICE_ENABLED) {
    // 閉じているあいだは載せない方が正しい（未稼働の委託先を書かない）。
    // **黙って緑にせず、見ていないと言う。**
    return void console.log(
      "  skip: EMAIL_CHANGE_NOTICE_ENABLED = false（未稼働なので PP に載せない）",
    );
  }
  if (!existsSync(PP_JA)) {
    return void console.log(`  skip: ${SITE} が無い端末`);
  }
  for (const [name, path] of [
    ["日本語 PP", PP_JA],
    ["英語 PP", PP_EN],
  ] as const) {
    assert.ok(
      readFileSync(path, "utf8").includes("Resend"),
      `🔴 ${name} に Resend が無いのに送信を有効にした。\n` +
        "  **公開文書に書いていない委託先へ、利用者のアドレスと本文が渡る。**",
    );
  }
});

test("🔴 有効にするなら、通知の文面が日英に分かれている", () => {
  if (!EMAIL_CHANGE_NOTICE_ENABLED) {
    return void console.log("  skip: EMAIL_CHANGE_NOTICE_ENABLED = false");
  }
  const c = code(ROUTE);
  assert.ok(
    c.includes("lang"),
    "🔴 件名も本文も日本語固定のまま有効にした。\n" +
      "  **旧アドレスへ送る「心当たりがない場合はパスワードを変えて」という\n" +
      "  セキュリティ通知が、英語利用者にも日本語で飛ぶ。**\n" +
      "  認証メール 4 本（email-templates.ts）は .Data.lang で分けてある",
  );
});

test("陰性対照: 見ている対象が実在し、コメントを落とせている", () => {
  const raw = readFileSync(ROUTE, "utf8");
  assert.ok(raw.includes("sendMail("), "送信の本体が消えている");
  assert.ok(raw.includes("// "), "前提（コメントがある）が崩れた");
  assert.ok(!code(ROUTE).includes("// "), "🔴 コメントを落とせていない");
});
