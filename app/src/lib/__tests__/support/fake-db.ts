/**
 * Supabase の client の**形だけ**を真似る偽物（route.ts を動かす検査用）。
 *
 * `from(table).select().eq()...` の鎖をどこまで伸ばしても同じ物を返し、
 * **`await` された瞬間（＝本物なら通信が始まる瞬間）に 1 回だけ** `handler` を呼ぶ。
 * `rpc(fn, args)` も同じく `handler` へ渡る。
 *
 * 🔴 **「始まった順」を `calls` に残す。** 直列か並列かは、結果ではなく
 *    「前の読み取りが終わる前に、次が始まっていたか」でしか見分けられない。
 *    handler が返す Promise を検査側で止めておけば、止めている間に
 *    何が始まったかを数えられる。
 */
export type DbOp = { op: string; args: unknown[] };
export type DbCall =
  | { kind: "query"; table: string; ops: DbOp[] }
  | { kind: "rpc"; fn: string; args: unknown };
export type DbResult = { data?: unknown; error?: unknown; count?: number | null };
export type DbHandler = (call: DbCall) => DbResult | Promise<DbResult>;

export function fakeDb(handler: DbHandler) {
  const calls: DbCall[] = [];

  function from(table: string): unknown {
    const call: DbCall = { kind: "query", table, ops: [] };
    let started: Promise<DbResult> | null = null;
    const run = () => {
      if (!started) {
        calls.push(call);
        started = Promise.resolve().then(() => handler(call));
      }
      return started;
    };
    const chain: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === "symbol") return undefined;
          if (prop === "then") {
            return (res: (v: DbResult) => unknown, rej: (e: unknown) => unknown) =>
              run().then(res, rej);
          }
          if (prop === "maybeSingle" || prop === "single") {
            return () => {
              call.ops.push({ op: prop, args: [] });
              return run();
            };
          }
          return (...args: unknown[]) => {
            call.ops.push({ op: prop, args });
            return chain;
          };
        },
      },
    );
    return chain;
  }

  const client = {
    from,
    rpc(fn: string, args?: unknown) {
      const call: DbCall = { kind: "rpc", fn, args };
      calls.push(call);
      return Promise.resolve().then(() => handler(call));
    },
  };
  return { client, calls };
}

/** 鎖の中に `op` があるか（例: insert / update / upsert / delete）。 */
export function hasOp(call: DbCall, op: string): boolean {
  return call.kind === "query" && call.ops.some((o) => o.op === op);
}

/** 呼び出しを短い名前にする（並列の検査の失敗文を読みやすくする）。 */
export function label(call: DbCall): string {
  if (call.kind === "rpc") return `rpc:${call.fn}`;
  const write = call.ops.find((o) => ["insert", "update", "upsert", "delete"].includes(o.op));
  return `${call.table}${write ? `.${write.op}` : ""}`;
}

/** 手で開ける門。開けるまで `wait()` は返らない。 */
export function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { wait: () => p, open };
}

/** マクロタスクを何周か回す（始まるべきものが始まりきるのを待つ）。 */
export async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
}

/** テスト間で globalThis に置いた注入物を片づける。 */
export function resetInjections(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__toritaviTestAuth;
  delete g.__toritaviTestAdmin;
  delete g.__toritaviTestSessionClient;
  delete g.__toritaviTestHeaders;
  delete g.__toritaviTestCookies;
  g.__toritaviAfterTasks = [];
}
