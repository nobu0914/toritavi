/** Origins permitted to call the API routes directly (mobile app, previews, local dev). */
export const ALLOWED_ORIGINS = new Set([
  "https://junros.coyoteandpowell.com",
  // `https://curlew.coyoteandpowell.com` は 2026-07-27 に外した。
  // 「両方が junros へ移り切ったことを確認してから」の確認が取れたため:
  //   - アプリの API base（`env.dart`）= junros
  //   - Supabase の Site URL = junros（認証メールのリンクもこちらへ出る）
  //   - Resend の送信ドメイン = junros のみ Verified
  //   - 未リリースのため、curlew を向いた配布済みビルドは存在しない
  // **許可リスト → Vercel のドメイン割り当て → DNS の順**で外すこと。
  // 逆順にすると「許可はされているのに到達できない」という、いちばん
  // 診断しにくい壊れ方をする。
  "https://toritavi.com",
  "https://app-lime-seven-80.vercel.app",
  // 🔴 **本番では localhost を許可しない。** 検査 L-3。開発機からの直叩きを
  //    通す必要は本番に無く、残っていると「許可された origin」の面が
  //    広いままなのに誰も気づけない。
  ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
]);

/**
 * **ブラウザからしか呼ばれない面**（管理コンソール・push）の書き込みで使う。
 *
 * 🔴 **Origin が無いリクエストを通さない。** 各 route は
 * `if (origin && !ALLOWED_ORIGINS.has(origin))` と書いていたので、
 * **ヘッダを付けなければ素通り**した（2026-08-16 の検査 L-3）。
 *
 * アプリ（ネイティブ）は Origin を送らないので、アプリが叩く
 * `/api/ocr` `/api/concierge` `/api/ai-usage` `/api/account/delete` には
 * この緩さが要る。**管理コンソールにネイティブの呼び出し元は無い。**
 *
 * ブラウザは **GET/HEAD 以外**なら同一オリジンでも Origin を送るので、
 * 書き込み（POST / DELETE）に限ればこの検査は成立する。
 * GET に使うと、同一オリジンの GET が Origin 無しで来て壊れる。
 *
 * @returns 拒否すべきなら true
 */
export function rejectWriteOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || !ALLOWED_ORIGINS.has(origin);
}
