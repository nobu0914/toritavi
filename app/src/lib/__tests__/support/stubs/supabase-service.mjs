// `@/lib/supabase-service` のスタブ。テストが `globalThis.__toritaviTestAdmin`
// に偽クライアント（またはそれを返す関数）を置いて注入する。
// 未設定なら throw ——本物の「SUPABASE_SERVICE_ROLE_KEY が無い」と同じ振る舞い。
export function createServiceClient() {
  const c = globalThis.__toritaviTestAdmin;
  if (!c) {
    throw new Error("service client not injected (test stub)");
  }
  return typeof c === "function" ? c() : c;
}
