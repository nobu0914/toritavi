/**
 * route.ts をテストから呼ぶための最小の偽リクエスト。
 * ルートが使うのは `headers.get()` / `text()` / `json()` だけ。
 */
export function makeRequest(
  opts: { headers?: Record<string, string>; body?: string } = {},
): unknown {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    lower[k.toLowerCase()] = v;
  }
  const body = opts.body ?? "";
  return {
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
}
