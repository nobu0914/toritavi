/**
 * ゲスト（未登録）の枠を決める。**判定だけ**を持ち、HTTP も DB も触らない。
 *
 * 設計は `toritavi_app/docs/guest-mode-spec.md` §11・§15。
 *
 * ## 関門は 2 つ。**両方通らないと使えない。**
 *
 * | 関門 | 何を数えるか | 破られ方 |
 * |---|---|---|
 * | 利用者（DB） | この**匿名 user_id** が使った件数 | 再インストールで新しい user_id |
 * | 端末（DeviceCheck） | この**端末**が使った件数（Apple 側に残る） | —— ここが最後の砦 |
 *
 * 利用者側は既存の予約 RPC（`toritavi_ocr_begin_request`）が見る。
 * **この module が決めるのは端末側**と、App Attest の結果で決まる上限。
 *
 * ## 🔴 App Attest は「まだ無い」。差し込み口だけ用意してある
 *
 * `attested` を受け取る形にしてあるので、検証を実装したらそこへ繋ぐだけ。
 * **いまは常に false** が渡る＝ゲストは 1 件。ゲスト自体がフラグで閉じている
 * うちに実装するので、**中途半端な値が世に出ることはない**。
 *
 * 全部入りの上限（3 件）を出すには、App Attest の検証が要る。
 * **「DeviceCheck だけで 3 件」にしない** —— 偽クライアントを排除できない
 * まま端末カウンタだけ信じると、カウンタごと偽装される。
 */
import { SPEC_GUEST_REQUESTS } from "./ocr-plan-spec.ts";

/** App Attest が通らない端末（シミュレータ・古い OS・検証失敗）に出す上限。 */
export const GUEST_UNATTESTED_LIMIT = 1;

export type GuestAttestState =
  /** App Attest を検証できた。正規アプリ・正規端末。 */
  | "attested"
  /** 端末が App Attest に対応していない（シミュレータ等）。 */
  | "unsupported"
  /** 検証に失敗した／サーバ都合で確かめられなかった。 */
  | "failed";

/** DeviceCheck から得た端末の状態。`unknown` は「聞けなかった」。 */
export type GuestDeviceState =
  | { kind: "known"; used: number }
  /** 記録が無い＝初回。**異常ではない。** */
  | { kind: "fresh" }
  /** 聞けなかった（未設定・401・通信不能）。 */
  | { kind: "unknown"; reason: string };

export type GuestDecision = {
  /** この要求を通してよいか。 */
  allow: boolean;
  /** この端末に許す総件数（attest の結果で 1 か 3）。 */
  limit: number;
  /** この端末が使った件数（聞けなければ 0 とみなす）。 */
  used: number;
  /** 残り。表示にも使う。 */
  remaining: number;
  /** 断るときの理由（ログ・レスポンス用。**利用者向け文言ではない**）。 */
  reason?: "device_exhausted";
  /**
   * 成功後に DeviceCheck へ書き戻すか。
   * **聞けなかったときは書かない** —— 読めていない値に +1 すると、
   * 3 件使った端末を 1 件に戻しうる（**枠を増やす方向の事故**）。
   */
  writeBack: boolean;
};

/**
 * 端末側の関門。
 *
 * 🔴 **「聞けなかった」を「0 件使用」と同じに扱う。** ただし**書き戻さない**。
 * 全面拒否にしないのは、失敗の大半が攻撃ではなく設定ミスと端末差だから
 * （§15）。**無制限にはならない** —— 利用者側（DB）の 3 件が必ず残る。
 */
export function decideGuest(
  attest: GuestAttestState,
  device: GuestDeviceState,
): GuestDecision {
  const limit = attest === "attested" ? SPEC_GUEST_REQUESTS : GUEST_UNATTESTED_LIMIT;

  if (device.kind === "unknown") {
    // 読めていないので書き戻さない。利用者側の関門に委ねる。
    return { allow: true, limit, used: 0, remaining: limit, writeBack: false };
  }

  const used = device.kind === "known" ? device.used : 0;
  const remaining = Math.max(0, limit - used);
  if (remaining <= 0) {
    return {
      allow: false,
      limit,
      used,
      remaining: 0,
      reason: "device_exhausted",
      writeBack: false,
    };
  }
  return { allow: true, limit, used, remaining, writeBack: true };
}

/**
 * 書き戻す値。**上限で頭打ちにする**（2 bit は 3 までしか持てない）。
 * 頭打ちにしないと 4 が 0 に巻き戻り、**枠が復活する**。
 */
export function nextDeviceUsed(used: number, units: number): 0 | 1 | 2 | 3 {
  const n = used + units;
  return (n < 0 ? 0 : n > 3 ? 3 : n) as 0 | 1 | 2 | 3;
}

/// 残数表示に、端末側の関門を反映させる。
///
/// 🔴 **画面の上下で違うことを言わせない。** 実機で、上の帯が
///    「上限に達しました」（端末の関門）、下のピルが「残り 3 件」（DB の件数）
///    になった（2026-08-31）。**どちらも個別には正しい**が、
///    利用者には意味が分からない。**判定を 1 か所に寄せる。**
///
/// 使用数は **DB と端末の多い方**を採る。片方だけを見ると
/// 「残っているのに弾かれる」形が残る。
export function capGuestUsage<T extends { limitRequests: number; usedRequests: number }>(
  usage: T,
  decision: Pick<GuestDecision, "limit" | "used">,
): T {
  return {
    ...usage,
    limitRequests: Math.min(usage.limitRequests, decision.limit),
    usedRequests: Math.max(usage.usedRequests, decision.used),
  };
}
