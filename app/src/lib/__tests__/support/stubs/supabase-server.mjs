// `@/lib/supabase-server` のスタブ。認証そのものはテスト対象ではないので、
// テストが `globalThis.__toritaviTestAuth` に関数を置いて注入する。
// 未設定なら未認証（null）——本物の「トークンが無い」と同じ振る舞い。
export async function authenticateRequest(request) {
  const fn = globalThis.__toritaviTestAuth;
  return fn ? fn(request) : null;
}

/**
 * セッション Cookie から作る client（管理画面の `requireAdmin` が使う）。
 * テストが `globalThis.__toritaviTestSessionClient` に偽クライアント
 * （またはそれを返す関数）を置いて注入する。未設定なら投げる ——
 * 本物もリクエストの外では `cookies()` が投げる。
 */
export async function createClient() {
  const c = globalThis.__toritaviTestSessionClient;
  if (!c) {
    throw new Error("session client not injected (test stub)");
  }
  return typeof c === "function" ? c() : c;
}
