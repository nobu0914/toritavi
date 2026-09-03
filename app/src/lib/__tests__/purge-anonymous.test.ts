// ============================================================================
// 🔴 **匿名ユーザーの掃除。順序と「失敗したら消さない」を固定する。**
//
// 2026-08-31 の外部レビュー P1 ——「匿名の `auth.users` を誰も消さない」。
//
// ## ここで守るもの
//
// 1. **Storage → user の順。** 逆にすると**画像が誰のものか引けなくなる**
//    （`toritavi_app/docs/guest-mode-spec.md` §23）
// 2. **失敗したら user を消さない。** 消すと辿れない孤児が残る
// 3. **秘密が無ければ動かさない。** これは消す処理
//
// ## なぜソース検査か
//
// Supabase の service role も Storage も、テストから叩けない。
// **順序は実行しないと分からない**ように見えるが、
// 「どちらの呼び出しが先に書かれているか」は位置で測れる。
// ⚠️ **書き方を変えられればすり抜ける。** それでも置くのは、無いより強いから。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/cron/purge-anonymous/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons: Array<{ path: string; schedule: string }>;
};

test("検査の土台：ルートを読めている", () => {
  assert.ok(route.length > 2000, "route を読めていない（パスが変わった？）");
  assert.ok(route.includes("removeUserObjects"), "削除処理が見当たらない");
});

test("🔴 Storage の削除が、user の削除より前にある", () => {
  const storageAt = route.indexOf("removeUserObjects(admin, spec, userId)");
  const userAt = route.indexOf("auth.admin.deleteUser(userId)");
  assert.ok(storageAt > 0 && userAt > 0, "位置を測れない。検査を直すこと");
  assert.ok(
    storageAt < userAt,
    "🔴 user を先に消している。**画像が誰のものか引けなくなる。**",
  );
});

test("🔴 失敗したら user を消さない（次回に回す）", () => {
  // `/api/account/delete` は記録したうえで消す —— **本人が求めた削除**なので
  // 完了させる必要がある。cron は誰も求めていないので、消さずに回す。
  assert.ok(
    /if \(failed\) \{[\s\S]{0,200}continue;/.test(route),
    "🔴 失敗しても先へ進んでいる。辿れない孤児が残る。",
  );
  const failedAt = route.indexOf("if (failed) {");
  const userAt = route.indexOf("auth.admin.deleteUser(userId)");
  assert.ok(
    failedAt > 0 && failedAt < userAt,
    "🔴 失敗の判定が user 削除より後ろにある。判定が効かない。",
  );
});

test("🔴 CRON_SECRET が無ければ動かさない", () => {
  // keepalive は無くても動く（読み取りだけで、止まる方がまずい）。
  // **こちらは消す。** 設定漏れで消えるのは、設定漏れで止まるより桁違いに悪い。
  assert.ok(
    /if \(!secret\) \{[\s\S]{0,300}status: 503/.test(route),
    "🔴 秘密が無くても動く形になっている。",
  );
});

test("一度に消す件数に上限がある", () => {
  // 途中で失敗したとき、どこまで進んだか分からなくなるのを避ける。
  assert.ok(/MAX_PER_RUN\s*=\s*\d+/.test(route), "上限が無い");
  assert.ok(/p_limit: MAX_PER_RUN/.test(route), "上限を関数へ渡していない");
});

test("🔴 匿名だけを対象にする関数を呼んでいる", () => {
  // 条件の緩みがそのまま事故になる場所。**会員を巻き込まない。**
  assert.ok(
    route.includes("toritavi_anonymous_purge_candidates"),
    "対象を出す関数が違う。会員が入りうる",
  );
});

test("🔴 cron が登録されている（作ったのに走らない、を塞ぐ）", () => {
  const paths = vercel.crons.map((c) => c.path);
  assert.ok(
    paths.includes("/api/cron/purge-anonymous"),
    "🔴 vercel.json に登録されていない。**実装しても一度も走らない。**",
  );
  // keepalive を消していないこと（同じファイルを触るので巻き添えを見る）。
  assert.ok(paths.includes("/api/cron/keepalive"), "keepalive が消えている");
});
