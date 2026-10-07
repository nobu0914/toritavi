/**
 * route.ts をテストから呼ぶための最小の偽リクエスト。
 * ルートが使うのは `headers.get()` / `text()` / `json()` / `arrayBuffer()` だけ。
 * `bodyBytes` を渡すと `arrayBuffer()` はそのバイト列を返す（生の MIME 用）。
 */
export function makeRequest(
  opts: { headers?: Record<string, string>; body?: string; bodyBytes?: Uint8Array } = {},
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
    arrayBuffer: async () => {
      const b = opts.bodyBytes ?? new TextEncoder().encode(body);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  };
}
