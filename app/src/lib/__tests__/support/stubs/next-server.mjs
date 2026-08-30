// `next/server` の最小スタブ。route.ts / ai-guard / moderation が使うのは
// `NextResponse.json()` と `instanceof NextResponse` だけ。
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
