// /api/events の回数制限（2026-10-06・67 か国配信のセキュリティ検査）。
// 🔴 「止まる」と「正規の量は通る」を両方固定する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EventsRateLimiter, eventsSourceOf } from "../events-rate-limit.ts";

test("🔴 同じ送り元は 1 分に上限まで・それを超えると止まる", () => {
  const l = new EventsRateLimiter(3, 100, 60_000);
  assert.deepEqual([1, 2, 3, 4].map(() => l.allow("1.2.3.4", 0)), [true, true, true, false]);
});

test("別の送り元は別に数える・1 分たてば戻る", () => {
  const l = new EventsRateLimiter(1, 100, 60_000);
  assert.ok(l.allow("a", 0));
  assert.ok(l.allow("b", 0));
  assert.ok(!l.allow("a", 1_000));
  assert.ok(l.allow("a", 60_000));
});

test("🔴 送り元を変えても、インスタンス全体の上限で止まる", () => {
  const l = new EventsRateLimiter(100, 5, 60_000);
  const r = Array.from({ length: 6 }, (_, i) => l.allow(`ip-${i}`, 0));
  assert.deepEqual(r, [true, true, true, true, true, false]);
});

test("送り元は IP の見出しの先頭から取る", () => {
  assert.equal(eventsSourceOf(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })), "9.9.9.9");
  assert.equal(eventsSourceOf(new Headers()), "unknown");
});

test("🔴 route: DB に書く前に回数制限を通し、IP をログに出さない", () => {
  const src = readFileSync(new URL("../../app/api/events/route.ts", import.meta.url), "utf8");
  const limit = src.indexOf("eventsRateLimiter.allow(");
  assert.ok(limit > 0 && limit < src.indexOf("toritavi_events"), "回数制限が書き込みより前に無い");
  assert.ok(!/console\.\w+\([^)]*eventsSourceOf/.test(src), "送り元をログに出している");
});
