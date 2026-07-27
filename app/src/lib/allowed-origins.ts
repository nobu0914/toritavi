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
  "http://localhost:3000",
]);
