/**
 * 認証基盤（Supabase Auth / GoTrue）が**答えられなかった**ことを、
 * 「この人は認証されていない」と区別する（2026-10-24・夜間検査 5-3）。
 *
 * ## 🔴 なぜ要るか
 *
 * `authenticateRequest` は以前 `if (!data.user) return null;` だけで、
 * `getUser` の `error` を見ていなかった。@supabase/auth-js 2.103.0 は、
 * 通信の失敗や GoTrue の 502/503/504 を**投げずに**
 * `{ data: { user: null }, error: AuthRetryableFetchError }` で返す
 * （`GoTrueClient._getUser` の catch と `lib/fetch.js` の `handleError`）。
 *
 * だから GoTrue が落ちている間、すべての API が 401 を返していた。
 * 中でも `/api/account/delete` が致命的で、アプリは「新しいトークンで 401」を
 * **「もう消えている」**と読み（`auth_repository.dart` の `decideDelete`）、
 * **アカウントが残ったまま端末の控えを消して「削除しました」と出す。**
 *
 * ## 読み分け
 *
 * | getUser の結果 | 扱い |
 * |---|---|
 * | 利用者がいる | 通す |
 * | GoTrue が「この資格情報は通らない」と**はっきり答えた**（4xx・セッション無し） | null → 401（従来どおり） |
 * | それ以外（通信断・5xx・429・応答が読めない・想定外の例外） | `AuthUnavailableError` → 503 |
 *
 * **分からないときは 401 に倒さない。** 401 は「この人は通らない」という断定で、
 * 受け取った側（アプリ）はそれを根拠に端末を掃除する。503 なら「後でもう一度」で済む。
 */
import { NextResponse } from "next/server";
import {
  isAuthApiError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";

/** 認証基盤が答えられなかった。**未認証ではない。** */
export class AuthUnavailableError extends Error {
  /** GoTrue が返した HTTP 状態（通信が届かなかったときは 0、分からなければ null）。 */
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "AuthUnavailableError";
    this.status = status;
  }
}

/**
 * GoTrue が「この資格情報は通らない」と**はっきり答えた**か。
 *
 * - `AuthSessionMissingError` … セッションが無い／JWT の session が消えている
 * - `AuthApiError` の 4xx … JWT が壊れている（403 bad_jwt）・利用者がいない など
 *
 * 🔴 **408（時間切れ）と 429（混んでいる）は断りではない。** 同じトークンで
 *    後から通りうるので、未認証と言い切れない。
 */
export function isDefiniteAuthRejection(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  if (isAuthApiError(error)) {
    const s = error.status;
    return s >= 400 && s < 500 && s !== 408 && s !== 429;
  }
  return false;
}

/**
 * `sb.auth.getUser()` の結果から利用者を取り出す。
 *
 * - 利用者がいる → 返す
 * - はっきり断られた → null（呼び出し側が 401）
 * - 答えが得られなかった → `AuthUnavailableError` を投げる（呼び出し側が 503）
 *
 * `error` も利用者も無い形は auth-js では起きないが、従来どおり null にする。
 */
export function userFromGetUser<U>(result: {
  data: { user: U | null } | null;
  error: unknown;
}): U | null {
  const user = result.data?.user ?? null;
  if (user) return user;
  const { error } = result;
  if (!error) return null;
  if (isDefiniteAuthRejection(error)) return null;
  const e = error as { message?: unknown; status?: unknown };
  throw new AuthUnavailableError(
    typeof e.message === "string" ? e.message : "auth unavailable",
    typeof e.status === "number" ? e.status : null,
  );
}

/**
 * `authenticateRequest(request).catch(authUnavailableTo503)` の形で使う。
 *
 * `AuthUnavailableError` だけを 503 の応答に変え、**それ以外は投げ直す**
 * （別の不具合を「認証基盤の障害」に見せかけない）。
 *
 * 🔴 **読み替えを忘れた入口は 500 になる**（401 にはならない）。
 *    安全側には倒れるが、`auth-unavailable.test.ts` が全入口を見張る。
 */
export function authUnavailableTo503(e: unknown): NextResponse {
  if (e instanceof AuthUnavailableError) {
    // 障害の間は全入口から出るので、検索できる印にしておく。本文やトークンは載せない。
    console.error(`[auth] AUTH_UNAVAILABLE status=${e.status ?? "unknown"}: ${e.message}`);
    return NextResponse.json(
      { error: "auth_unavailable" },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
  throw e;
}
