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

/** UUID（Supabase の user_id）以外を `toritavi_user_plan` へ入れない。 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `TRANSFER` で**権利を手放した側**の user_id。ここを free に落とす。
 *
 * 🔴 同じ Apple ID を別アカウントで復元すると権利は移る。付与側だけ
 * 見ていると**元の持ち主は `pro` のまま残り、払わずに Pro が続く**。
 *
 * 失効は付与と違って**証拠（`entitlement_ids`）を要求しない**。手放した
 * ことは `transferred_from` に載っている事実で、権利 ID の有無に
 * 依存させるとフェイルオープンになる。
 */
export function revokedUserIds(event: {
  type?: string;
  transferred_from?: string[];
}): string[] {
  if (event.type !== "TRANSFER") return [];
  return (event.transferred_from ?? []).filter((id) => UUID_RE.test(id));
}

/**
 * 上限の期間の起点日（JST の YYYY-MM-DD）。`toritavi_user_plan.period_anchor`。
 *
 * 🔴 **JST で切る。** `ocr_period_start()` が
 * `(now() AT TIME ZONE 'Asia/Tokyo')::DATE` と比べるので、ここで UTC の
 * 日付を書くと**日付が 1 日ずれる期間ができる**（`CLAUDE.md` §6 の
 * 「JST 修正が複製先に入っていなかった」と同じ型）。
 *
 * `purchased_at_ms` が無い / 壊れているイベントでは **null を返す**。
 * null は「暦月で集計する」を意味し、**既存の挙動と同じ**。
 * ここで現在時刻を入れると、**再送のたびに起点がずれて上限が実質
 * リセットされる**ので、入れてはいけない。
 */
export function periodAnchorDate(event: {
  purchased_at_ms?: number;
}): string | null {
  const ms = event.purchased_at_ms;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const JST = 9 * 60 * 60 * 1000;
  return new Date(ms + JST).toISOString().slice(0, 10);
}
