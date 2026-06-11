import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

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

export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseKey);
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
 */
export async function authenticateRequest(
  request: Request
): Promise<{ sb: SupabaseClient; userId: string } | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    const sb = createServerClient(supabaseUrl, supabaseKey, {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data } = await sb.auth.getUser(token);
    if (!data.user) return null;
    return { sb: sb as unknown as SupabaseClient, userId: data.user.id };
  }
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  return { sb: sb as unknown as SupabaseClient, userId: data.user.id };
}
