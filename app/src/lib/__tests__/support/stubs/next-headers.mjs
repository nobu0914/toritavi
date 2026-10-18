// `next/headers` のスタブ。到達したときに黙って空を返すのではなく、明確に落とす。
export function cookies() {
  throw new Error("next/headers の cookies() はテストでは使えない（スタブ）");
}

/**
 * `headers()` のスタブ。テストが `globalThis.__toritaviTestHeaders` に
 * 値（オブジェクト）を置いたときだけ返す。置いていなければ落とす ——
 * 本物もリクエストの外では投げる。
 */
export async function headers() {
  const h = globalThis.__toritaviTestHeaders;
  if (!h) {
    throw new Error("next/headers の headers() が注入されていない（スタブ）");
  }
  return new Headers(h);
}
