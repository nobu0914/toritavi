// 🔴 **古いイベントで新しい状態を踏み潰さない。**
//
// 2026-08-30 のレーン 3。webhook は受信時刻で無条件に upsert していた。
// RevenueCat の配送順は保証されず、5xx で失敗したイベントは指数バック
// オフで何時間も再送される。**再送で遅れた EXPIRATION が RENEWAL の
// 後ろに並ぶ**と、契約中の人の plan が free に落ちる。復旧経路は無い
// （利用者から見れば 6 件目で 429「今月の上限」）。
//
// 順序の正本を「受信時刻」から「イベント発生時刻」へ移し、
// 既存行は `.lt("updated_at", eventAt)` のときだけ進めるようにした。
// ここではその時刻を作る側だけを見る（WHERE 句は Postgres の担当）。

import assert from "node:assert/strict";
import { test } from "node:test";
import { eventAtIso, revokedUserIds } from "../webhook-event-order.ts";

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

test("イベント発生時刻を使う（受信時刻ではない）", () => {
  const at = Date.UTC(2026, 7, 30, 3, 21, 45);
  assert.equal(eventAtIso({ event_timestamp_ms: at }, NOW), new Date(at).toISOString());
});

test("時刻が無ければ現在時刻に倒す", () => {
  // 🔴 捨てない。EXPIRATION を取りこぼすと、解約済みの人に Pro を配り続ける。
  assert.equal(eventAtIso({}, NOW), new Date(NOW).toISOString());
});

test("壊れた時刻も現在時刻に倒す", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.equal(
      eventAtIso({ event_timestamp_ms: bad }, NOW),
      new Date(NOW).toISOString(),
      `event_timestamp_ms=${bad}`,
    );
  }
});

test("古いイベントは新しいイベントより前に並ぶ", () => {
  // `.lt("updated_at", eventAt)` が効くのは、この順序が文字列比較でも
  // 保たれるから（ISO 8601・UTC・固定桁）。
  const older = eventAtIso({ event_timestamp_ms: NOW - 60_000 }, NOW);
  const newer = eventAtIso({ event_timestamp_ms: NOW }, NOW);
  assert.ok(older < newer, `${older} < ${newer}`);
});

// ─────────── TRANSFER: 渡した側を落とす ───────────
//
// 同じ Apple ID を別アカウントで復元すると権利は移る。付与側だけ見ていると
// **元の持ち主は pro のまま残り、払わずに Pro が続く**（2026-08-30 のレーン 3）。

test("TRANSFER は transferred_from を失効対象にする", () => {
  const a = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(
    revokedUserIds({ type: "TRANSFER", transferred_from: [a] }),
    [a],
  );
});

test("🔴 entitlement_ids が無くても、複数の transferred_from を全員失効させる", () => {
  // 失効に証拠を要求するとフェイルオープンになる。手放した事実は
  // transferred_from に載っている。
  // （以前は 1 件目のテストと**入力が同一**で、何も追加検証していなかった。
  //   ここでは「複数人でも全員・順序どおり」を見る。）
  const a = "11111111-2222-3333-4444-555555555555";
  const b = "66666666-7777-4888-9999-aaaaaaaaaaaa";
  assert.deepEqual(
    revokedUserIds({ type: "TRANSFER", transferred_from: [a, b] }),
    [a, b],
  );
});

test("匿名 ID や壊れた値は混ぜない", () => {
  const a = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(
    revokedUserIds({
      type: "TRANSFER",
      transferred_from: ["$RCAnonymousID:abc", "", "not-a-uuid", a],
    }),
    [a],
  );
});

test("TRANSFER 以外では誰も落とさない", () => {
  const a = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(revokedUserIds({ type: "RENEWAL", transferred_from: [a] }), []);
  assert.deepEqual(revokedUserIds({ type: "TRANSFER" }), []);
});
