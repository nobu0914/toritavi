/**
 * ゲスト（未登録）での利用。**2026-09-04 に閉じ直した**（利用者判断）。
 *
 * 09-03 に一度開けたが、**翌日の外部監査 2 件で P0 が新たに 2 件出た**ので
 * 戻した。**開けておく利益がゼロだった**のが決め手 —— アプリ側の
 * `kGuestModeEnabled` は false のままだったので、**製品としては誰も
 * ゲストになれず、入口だけが開いている**状態だった。
 *
 * 🔴 **「誰もゲストになれない」は誤りだった。** アプリに導線が無いだけで、
 *    公開 API からは匿名アカウントを作れる（実際に検証で 7 個作った）。
 *
 * 09-04 に見つかった P0:
 *   - Storage の上限を**同名上書きで迂回できた**（遮断スイッチごと）。
 *     件数を増やさずに容量だけ増やせる。→ `tool/storage_quota_cap.sql` 段階 4 で修正
 *   - DeviceCheck の「生涯 3 件」が**並行要求で破れる**（read-modify-write の
 *     lost update）。Apple の API は加算も CAS も無い。**未修正**
 *
 * 再開の条件は `toritavi_app/docs/guest-mode-spec.md` §23。
 *
 * ---
 *
 * 2026-08-31 にも一度閉じた。外部レビューで P0 3 件・P1 4 件が出たため。
 * **下の表はすべて塞いである。**
 *
 * 🔴 **開ける順番には理由がある。** ここを先に `true` にしても何も起きない
 * —— 匿名ユーザーがまだ存在できないので、この分岐に誰も到達しない。
 * **Supabase の匿名サインインを最後に開ける**ことで、露出が始まるのは
 * 全部が整った瞬間だけになる。逆にすると「匿名は作れるがサーバは受けない」
 * という中途半端な窓ができる。
 *
 * **アプリ側のフラグ（`kGuestModeEnabled`）ではサーバは閉じない。**
 * サーバは匿名 JWT を受けるので、Supabase の匿名サインインが有効な限り
 * 外部から使えてしまう。**ダッシュボードの設定だけに頼らない。**
 *
 * 外部レビュー（2026-08-31）で見つかったもの:
 *
 * | | 指摘 | どうしたか |
 * |---|---|---|
 * | **P0** | 端末トークンが無い／読めないと `decideGuest` が `allow` を返す | ✅ 09-03 `device_unreadable` で拒否 |
 * | **P0** | `setGuestUsed` の失敗を無視して続行する | ✅ 09-03 書けなければ 503 |
 * | **P0** | `remaining` と実際の `units` を比較していない | ✅ 09-03 `guestUnitsExceedRemaining` |
 * | **P1** | 匿名は `authenticated` ロール。RLS が匿名を区別しない | ✅ 09-03 実測すると**分離は効いていた**（届くのは自分の行だけ）。残っていたのは量の問題で、行数トリガ（4 表）と Storage の上限で塞いだ |
 * | **P1** | assertion を要求ごとに検証していない | ✅ 09-03 `guest-assertion.ts` ＋ 単調カウンタ。⏳ **実機での通し確認だけ残る** |
 * | **P1** | `environment` を検証結果ではなく `ALLOW_DEV` から記録 | ✅ 09-03 検証結果から記録。**`APPLE_APPATTEST_ALLOW_DEV` は Vercel から削除済み** |
 * | **P1** | 匿名の `auth.users` を誰も消さない | ✅ 09-03 `/api/cron/purge-anonymous`（90 日無活動） |
 *
 * **費用の天井**（`toritavi_ai_budget_limits` を 09-03 に実測）——
 * guest は **日 $3 / 月 $30**。財布は受け手ごとに分かれているので、
 * **ゲストが使い切っても Pro の読み取りは止まらない。**
 *
 * 🔴 **閉じるときは、ここを `false` にするだけでは足りない。**
 * Supabase の匿名サインインも切ること。開いている限り匿名 JWT は
 * 発行され続け、PostgREST と Storage には直接届く。
 *
 * 詳細と経緯は `docs/guest-mode-spec.md` §23。
 *
 * ## 2026-09-04 に開けた（利用者判断）
 *
 * 開けた順番は **Supabase → サーバ → アプリ**。逆にするとアプリだけが
 * 開き、**画面には入れるのに `/api/ocr` が 403** ——中核機能だけ動かない
 * 状態になる。順番が効いていることは実測した（Supabase を開けた直後、
 * サーバはまだ ocr 403 / attest 404 を返していた）。
 *
 * 🔴 **残っている穴が 1 つある —— 匿名サインインに captcha が無い。**
 * 会員には確認メールという関門があるが（custom SMTP 30 通/時・
 * Resend 100 通/日）、**匿名にはそれに当たるものがない。** 行数トリガも
 * App Attest も「作られたあと」にしか効かず、**アカウントを何個作れるか**は
 * 誰も止めていない。被害の形は DB の膨張と **MAU の消費**。
 *
 * いまはストアのアプリにゲスト導線が入っていない（`kGuestModeEnabled`
 * が false のままビルドされている）ので、押せるのは手元の検証ビルドだけ。
 * **ゲストをストアに出す前に captcha か同等のものが要る。**
 */
export const GUEST_MODE_ENABLED = true;

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
  reason?: "device_exhausted" | "device_unreadable";
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
    // 🔴 **2026-09-03 に fail-open から fail-close へ変えた（P0-1）。**
    //
    //    もとは `allow: true` で「利用者側（DB）の関門に委ねる」としていた。
    //    **その前提が誤りだった** —— 匿名 user_id は公開 API で作り直せる
    //    ので、DB 側の関門も一緒にリセットされる。端末側も DB 側も
    //    数えられない状態になり、**1 件ずつ無限に取れる。**
    //    2026-08-31 の外部レビュー P0（`docs/guest-mode-spec.md` §23）。
    //
    //    ⚠️ **正規の利用者を巻き込む。** DeviceCheck が読めない端末
    //    （設定ミス・通信断）は使えなくなる。**それでも通さない** ——
    //    通した場合の上限は「無い」に等しく、受け入れられない。
    //    理由を分けてあるので、画面は「上限に達した」ではなく
    //    「確認できなかった」と言える。
    //
    //    `used` / `remaining` は**分からない**ので触らない
    //    （0 と limit のまま）。allow が false なので数字は使われない。
    return {
      allow: false,
      limit,
      used: 0,
      remaining: limit,
      reason: "device_unreadable",
      writeBack: false,
    };
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
 * この要求の単位数が、端末側の残数を超えていないか（P0-3）。
 *
 * 🔴 **`decideGuest` は「1 件でも残っているか」しか見ていない。**
 * 残り 1 件の端末が 3 ページを 1 要求で投げると、判定は通り、
 * `nextDeviceUsed` が 3 で頭打ちにするので**書き戻しでも気づけない**。
 * 2026-08-31 の外部レビュー P0（`docs/guest-mode-spec.md` §23）。
 *
 * **判定と消費の単位を揃える。** 呼び出し側は `units` が確定してから、
 * かつ予約（`beginOcrRequest`）の**前**に呼ぶこと ——
 * 後だと予約だけ取って断ることになる。
 */
export function guestUnitsExceedRemaining(
  decision: Pick<GuestDecision, "remaining">,
  units: number,
): boolean {
  return units > decision.remaining;
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
  const limit = Math.min(usage.limitRequests, decision.limit);
  // 🔴 **上限を超えた使用数を出さない。** 端末が 3 件使ったあと、
  //    検証前（上限 1 件）の画面を開くと **`3 / 1`** になる。
  //    「使い切っている」ことは正しいが、**数字としては壊れている。**
  return {
    ...usage,
    limitRequests: limit,
    usedRequests: Math.min(limit, Math.max(usage.usedRequests, decision.used)),
  };
}
