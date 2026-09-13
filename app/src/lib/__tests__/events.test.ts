/**
 * 利用解析のイベントに、**中身が入らないこと**。
 *
 * 🔴 これが緩むと、解析のために PII を貯める表になる。旅程の中身
 * （便名・確認番号・地名・氏名・メール・自由入力）は 1 バイトも入れない。
 * 「入れない約束」ではなく「入らない構造」で守る（`CLAUDE.md` §5）。
 *
 * もう 1 つ守るのは **弾いた件数を数えること**。黙って捨てると、
 * アプリ側の配線ミスに永久に気づけない ——「イベントが来ていない」と
 * 「イベントが弾かれている」は、集計の画面では同じに見える（§6-1）。
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  sanitizeEvent,
  sanitizeEvents,
  sanitizeContext,
  isUuid,
  MAX_BATCH,
  EVENT_NAMES,
} from "../events";

test("陽性対照: 許可された名前は通る", () => {
  const e = sanitizeEvent({ name: "screen.view", screen: "scan", props: { ms: 1200 } });
  assert.equal(e?.name, "screen.view");
  assert.equal(e?.screen, "scan");
  assert.deepEqual(e?.props, { ms: 1200 });
});

test("🔴 許可一覧に無い名前は通らない", () => {
  assert.equal(sanitizeEvent({ name: "custom.anything" }), null);
  assert.equal(sanitizeEvent({ name: "" }), null);
  // @ts-expect-error 形が違うものも落ちる
  assert.equal(sanitizeEvent({ name: 123 }), null);
});

test("🔴 許可していない鍵は落とす（自由な欄を作らない）", () => {
  const e = sanitizeEvent({
    name: "tap",
    props: { target: "scan_button", memo: "羽田→パリ NH215", note: "x" },
  });
  assert.deepEqual(e?.props, { target: "scan_button" });
});

/**
 * 🔴 **この検査は、書いた直後に本物の穴を見つけた**（2026-09-13）。
 * 最初は「48 文字まで」で守っていたが、下の予約メールの断片は **41 文字**で
 * そのまま通った。**本文は短いこともある —— 長さは中身の代わりにならない。**
 * いまは「英小文字で始まる識別子」だけを通す形にしてある。
 */
test("🔴 本文は、短くても通さない", () => {
  const long = "ご予約ありがとうございます。確認番号 SKR-6620 / NH215 羽田";
  assert.equal(long.length < 48, true, "前提: 昔の長さ制限は素通りした");
  const e = sanitizeEvent({ name: "tap", props: { target: long } });
  assert.deepEqual(e?.props, {}, "🔴 本文が入っている");
});

test("🔴 大文字・記号・空白・数字始まりは、短くても通さない", () => {
  const ng = ["SKR-6620", "NH215", "a@b.com", "scan button", "2nd_tap", "羽田"];
  for (const v of ng) {
    assert.deepEqual(
      sanitizeEvent({ name: "tap", props: { target: v } })?.props,
      {},
      `🔴 "${v}" が通っている`,
    );
  }
});

test("陽性対照: アプリが決めた語は通る", () => {
  for (const v of ["scan_button", "journey_detail", "network_timeout", "pdf"]) {
    assert.deepEqual(
      sanitizeEvent({ name: "tap", props: { target: v } })?.props,
      { target: v },
      `陽性対照が落ちている: ${v}`,
    );
  }
});

test("🔴 実在しそうな値でも、鍵が許可されていなければ入らない", () => {
  const e = sanitizeEvent({
    name: "scan.succeeded",
    props: {
      confNumber: "SKR-6620",
      email: "riku@example.com",
      title: "西麻布 十々",
      n: 3,
    },
  });
  assert.deepEqual(e?.props, { n: 3 });
});

test("🔴 負と桁あふれの数は入らない（平均が壊れる）", () => {
  assert.deepEqual(sanitizeEvent({ name: "screen.view", props: { ms: -1 } })?.props, {});
  assert.deepEqual(
    sanitizeEvent({ name: "screen.view", props: { ms: 1e12 } })?.props,
    {},
  );
  assert.deepEqual(
    sanitizeEvent({ name: "screen.view", props: { ms: Number.NaN } })?.props,
    {},
  );
});

test("画面名も識別子の形だけ", () => {
  assert.equal(sanitizeEvent({ name: "tap", screen: "x".repeat(65) })?.screen, null);
  assert.equal(sanitizeEvent({ name: "tap", screen: "パリ旅行" })?.screen, null);
  assert.equal(sanitizeEvent({ name: "tap", screen: "journey_detail" })?.screen,
    "journey_detail");
});

test("🔴 弾いた件数を数える（黙って捨てない）", () => {
  const { events, dropped } = sanitizeEvents([
    { name: "tap", props: { target: "a" } },
    { name: "nope" },
    { name: "also.nope" },
  ]);
  assert.equal(events.length, 1);
  assert.equal(dropped, 2, "🔴 落とした件数が出ていない。配線ミスに気づけない");
});

test(`まとめ送りは ${MAX_BATCH} 件まで`, () => {
  const list = Array.from({ length: MAX_BATCH + 10 }, () => ({ name: "tap" }));
  const { events } = sanitizeEvents(list);
  assert.equal(events.length, MAX_BATCH);
});

test("配列でなければ 0 件（例外にしない）", () => {
  assert.deepEqual(sanitizeEvents("x"), { events: [], dropped: 0 });
  assert.deepEqual(sanitizeEvents(null), { events: [], dropped: 0 });
});

test("🔴 文脈の欄に、知らない値を入れない", () => {
  const ctx = sanitizeContext({
    appVersion: "1.3.0",
    osVersion: "26.3",
    locale: "ja-JP",
    plan: "enterprise",
    email: "x@example.com",
  });
  assert.deepEqual(ctx, {
    app_version: "1.3.0",
    os_version: "26.3",
    locale: "ja-JP",
    plan: null,
  });
  assert.equal("email" in ctx, false);
});

test("session_id は UUID の形だけ通す", () => {
  assert.equal(isUuid("3f8a92c1-4b2e-4d1a-9f3c-1a2b3c4d5e6f"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid(undefined), false);
});

/**
 * 🔴 **名前を足すときに、ここも見ること。** 一覧に足しただけで
 * アプリが送らなければ何も起きないし、アプリが送っても一覧に無ければ
 * 黙って捨てられる。**両方が揃って初めて動く。**
 */
test("陰性対照: 名前の一覧が空になっていない", () => {
  assert.ok(EVENT_NAMES.length >= 10);
  assert.ok(EVENT_NAMES.includes("paywall.shown"));
  assert.ok(EVENT_NAMES.includes("scan.failed"));
});
