// `@/lib/supabase-server` のスタブ。認証そのものはテスト対象ではないので、
// テストが `globalThis.__toritaviTestAuth` に関数を置いて注入する。
// 未設定なら未認証（null）——本物の「トークンが無い」と同じ振る舞い。
export async function authenticateRequest(request) {
  const fn = globalThis.__toritaviTestAuth;
  return fn ? fn(request) : null;
}
