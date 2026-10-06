/*
 * /api/events の回数制限（2026-10-06・67 か国配信のセキュリティ検査で追加）。
 *
 * 🔴 **なぜ要るか。** /api/events はトークンを取らず（誰のものかを持たない設計）、
 *    service-role で `toritavi_events` に書く。制限が無いと、どこからでも
 *    ループで書き込めて、**Maptint と共用の DB を埋められる**。
 *    アプリが送るのは節目 4 つだけ（`analytics_wired_test.dart`）なので、
 *    正規の利用でこの上限に届くことは無い。
 *
 * 🔴 **これは最低限の歯止めで、完全ではない。** 数えるのはサーバの
 *    インスタンスごと（メモリ）なので、インスタンスが分かれれば別々に数える。
 *    本命は Vercel のファイアウォールの回数制限（ダッシュボードの設定）。
 *
 * 🔴 **IP は保存しない・ログに出さない。** メモリにハッシュを数十秒持つだけ。
 *    「サーバは誰のものかを知れない」という設計（route.ts の冒頭）を崩さない。
 */
import { createHash } from "node:crypto";

export const EVENTS_WINDOW_MS = 60_000;
/** 同じ送り元から 1 分に受ける回数。正規のアプリは起動 1 回で数回しか送らない。 */
export const EVENTS_PER_SOURCE = 20;
/** インスタンス全体で 1 分に受ける回数。 */
export const EVENTS_PER_INSTANCE = 1_200;
/** 覚えておく送り元の数の上限（メモリを食い潰されないため）。 */
const MAX_SOURCES = 10_000;

type Bucket = { start: number; count: number };

export class EventsRateLimiter {
  private sources = new Map<string, Bucket>();
  private all: Bucket = { start: 0, count: 0 };
  private readonly perSource: number;
  private readonly perInstance: number;
  private readonly windowMs: number;

  constructor(
    perSource = EVENTS_PER_SOURCE,
    perInstance = EVENTS_PER_INSTANCE,
    windowMs = EVENTS_WINDOW_MS,
  ) {
    this.perSource = perSource;
    this.perInstance = perInstance;
    this.windowMs = windowMs;
  }

  /** 受けてよければ true。数えるのは受けた分だけ。 */
  allow(source: string, now = Date.now()): boolean {
    if (now - this.all.start >= this.windowMs) this.all = { start: now, count: 0 };
    if (this.all.count >= this.perInstance) return false;

    const key = createHash("sha256").update(source).digest("base64url").slice(0, 16);
    let b = this.sources.get(key);
    if (!b || now - b.start >= this.windowMs) {
      if (!b && this.sources.size >= MAX_SOURCES) this.prune(now);
      // 掃除しても空かなければ、知らない送り元は受けない（フェイルクローズ）。
      if (!b && this.sources.size >= MAX_SOURCES) return false;
      b = { start: now, count: 0 };
      this.sources.set(key, b);
    }
    if (b.count >= this.perSource) return false;
    b.count += 1;
    this.all.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [k, b] of this.sources) {
      if (now - b.start >= this.windowMs) this.sources.delete(k);
    }
  }
}

/** 送り元。Vercel が付ける IP の見出しから取る。取れなければ 1 つの箱にまとめる。 */
export function eventsSourceOf(headers: Headers): string {
  const fwd = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
  const first = fwd?.split(",")[0]?.trim();
  return first || "unknown";
}

export const eventsRateLimiter = new EventsRateLimiter();
