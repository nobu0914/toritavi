import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AuthUnavailableError, userFromGetUser } from "@/lib/auth-unavailable";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components cannot set cookies; middleware handles refresh.
        }
      },
    },
  });
}

/**
 * Authenticate an API request from either the web (cookie session) or a native
 * client (Authorization: Bearer <supabase access token>). Returns a Supabase
 * client scoped to that user (RLS applies) plus the userId, or null if
 * unauthenticated.
 *
 * Native apps (Flutter) can't send the SSR auth cookies, so they pass the
 * session JWT in the Authorization header instead. The Bearer-header client
 * runs DB queries as that user, so per-user RLS / usage tables keep working.
 *
 * 🔴 **認証基盤が答えられないときは null を返さず `AuthUnavailableError` を投げる**
 * （2026-10-24・夜間検査 5-3）。auth-js は GoTrue の 5xx や通信断を投げずに
 * `{ user: null, error }` で返すので、`error` を見ないと 401（＝「この人は通らない」）
 * に化ける。呼び出し側は `authenticateRequest(request).catch(authUnavailableTo503)`
 * で 503 に読み替える（`auth-unavailable.ts`）。
 */
export async function authenticateRequest(
  request: Request
): Promise<{
  sb: SupabaseClient;
  userId: string;
  isAnonymous: boolean;
  /**
   * 検証済みユーザーの `user_metadata`。
   *
   * 🔴 **トークンの中身ではなく `getUser` が返した現在値。** 許諾は
   * ここに入っており（`ai-consent.ts`）、**古いトークンでも最新が読める。**
   */
  userMetadata: Record<string, unknown>;
} | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    const sb = createServerClient(supabaseUrl, supabaseKey, {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const user = userFromGetUser(await getUserOrUnavailable(() => sb.auth.getUser(token)));
    if (!user) return null;
    // 匿名（ゲスト）かどうかは **JWT を検証したあとのユーザー**から取る。
    // クライアントの申告を信じない（Phase 3 でゲスト枠の分岐に使う）。
    return {
      sb: sb as unknown as SupabaseClient,
      userId: user.id,
      isAnonymous: user.is_anonymous === true,
      userMetadata: (user.user_metadata ?? {}) as Record<string, unknown>,
    };
  }
  const sb = await createClient();
  const user = userFromGetUser(await getUserOrUnavailable(() => sb.auth.getUser()));
  if (!user) return null;
  return {
    sb: sb as unknown as SupabaseClient,
    userId: user.id,
    isAnonymous: user.is_anonymous === true,
    userMetadata: (user.user_metadata ?? {}) as Record<string, unknown>,
  };
}

/**
 * `getUser` が**投げた**ときも、答えが得られなかった側（503）に倒す。
 * auth-js は認証系のエラーを返り値で返し、それ以外（想定外の例外）だけを投げる。
 * どちらにしても「この人は通らない」とは言えない。
 */
async function getUserOrUnavailable<R>(call: () => Promise<R>): Promise<R> {
  try {
    return await call();
  } catch (e) {
    throw new AuthUnavailableError(e instanceof Error ? e.message : String(e), null);
  }
}
