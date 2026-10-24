// オフライン用の控え（public/sw.js）に、管理画面の HTML を入れない（Cloudflare 検査 run-2・2026-10-24）。
// 控えは利用者・ログインの状態に縛られておらず、ログアウト・退会のあとも圏外で開くと
// 最後に見た管理画面が出えた。ブラウザの Service Worker は node で動かせないので原文を見る。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sw = readFileSync("public/sw.js", "utf8");

test("🔴 ナビゲーションの控えは /admin を入れない", () => {
  const i = sw.indexOf('if (request.mode === "navigate")');
  assert.ok(i > 0);
  const block = sw.slice(i, sw.indexOf("return;", i));
  assert.match(block, /response\.ok && !url\.pathname\.startsWith\("\/admin"\)/,
    "🔴 管理画面の HTML を控えに入れている");
});

test("古い控え（管理画面の HTML が入っているかもしれない）を捨てるため、版が v9 ではない", () => {
  assert.doesNotMatch(sw, /CACHE_VERSION = "toritavi-v9"/);
  assert.match(sw, /keys\.filter\(\(k\) => !k\.startsWith\(CACHE_VERSION\)\)/);
});

// Codex の二次検査（2026-10-24）: /auth/callback?next=/admin… のように転送されて管理画面に
// 着いた応答は、要求の URL が /admin で始まらないので、控えに入っていた。
test("🔴 転送で管理画面に着いた応答（response.url が /admin）も控えに入れない", () => {
  const i = sw.indexOf('if (request.mode === "navigate")');
  const block = sw.slice(i, sw.indexOf("return;", i));
  assert.match(block, /new URL\(response\.url\)\.pathname/);
  assert.match(block, /!landed\.startsWith\("\/admin"\)/, "🔴 着いた先で管理画面かを見ていない");
  assert.doesNotMatch(sw, /CACHE_VERSION = "toritavi-v10"/, "入っていた控えを捨てるため版を上げる");
});
