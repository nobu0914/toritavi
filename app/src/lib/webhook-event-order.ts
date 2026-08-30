/**
 * webhook イベントの順序づけ。**`next/server` に依存しない**ので、
 * 素の node テストから検査できる（`webhook-event-order.test.ts`）。
 * route.ts に置いたままだと `next/server` が解決できず落ちる。
 */

/**
 * イベントの発生時刻。**受信時刻を使わない。**
 *
 * 配送は順序を保証しない。失敗した EXPIRATION が再送で遅れて届き、
 * その後の RENEWAL の**後ろに並ぶ**ことがある。受信時刻で上書きすると、
 * 契約中の人が黙って free に落ちる（`docs/monetization-spec.md` §2 の
 * 「6 件目で 429」がそのまま起きる）。**復旧する経路は無い。**
 *
 * 時刻が無い / 壊れているイベントは、順序を判断できないので**現在時刻**に
 * 倒す。捨てるより反映する方に倒すのは、`EXPIRATION` を取りこぼすと
 * 解約済みの人に Pro を配り続けることになるため。
 */
export function eventAtIso(
  event: { event_timestamp_ms?: number },
  now: number,
): string {
  const ms = event.event_timestamp_ms;
  return new Date(
    typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : now,
  ).toISOString();
}
