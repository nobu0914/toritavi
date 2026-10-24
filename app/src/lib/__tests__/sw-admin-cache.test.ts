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
