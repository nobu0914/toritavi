// `next/server` の最小スタブ。route.ts / ai-guard / moderation が使うのは
// `NextResponse.json()` と `instanceof NextResponse`、それに `after()`。
// 🔴 単一モジュールとして解決されるので、ルートとライブラリの間で
// `instanceof` が本物と同じように成立する。
export class NextResponse {
  constructor(body = null, init = {}) {
    this.status = init.status ?? 200;
    this.headers = new Map(Object.entries(init.headers ?? {}));
    this._json = undefined;
    this.body = body;
  }

  static json(data, init = {}) {
    const r = new NextResponse(null, init);
    r._json = data;
    return r;
  }

  async json() {
    return this._json;
  }
}

// 型としてしか使われない（ハンドラの引数型）。実行時は素のオブジェクトで足りる。
export class NextRequest {}

/**
 * `after()` のスタブ。本物は「応答を返したあと」に走らせる（Vercel の waitUntil）。
 *
 * ここでは**すぐ後ろ（マイクロタスク）で走らせ、その Promise を
 * `globalThis.__toritaviAfterTasks` に積む。** テストはそれを見て
 * 「応答を待たせずに予約された」ことと「実際に走った」ことの両方を確かめられる。
 *
 * 🔴 **黙って捨てない。** 捨てると、after に回した書き込みが
 * 本当に呼ばれているかをどのテストも見られなくなる。
 */
export function after(task) {
  const list = (globalThis.__toritaviAfterTasks ??= []);
  const p = Promise.resolve().then(() => (typeof task === "function" ? task() : task));
  // 失敗は本物と同じく応答に影響させない（テストは積まれた Promise で見る）。
  p.catch(() => {});
  list.push(p);
}
