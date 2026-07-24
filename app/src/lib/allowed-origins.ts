/** Origins permitted to call the API routes directly (mobile app, previews, local dev). */
export const ALLOWED_ORIGINS = new Set([
  "https://junros.coyoteandpowell.com",
  // 旧ドメイン。JUNROS への改名中は**消さない**。配布済みのアプリと、
  // 旧ドメインで開かれている Web がここを見ている。
  // 両方が junros へ移り切ったことを確認してから外す。
  "https://curlew.coyoteandpowell.com",
  "https://toritavi.com",
  "https://app-lime-seven-80.vercel.app",
  "http://localhost:3000",
]);
