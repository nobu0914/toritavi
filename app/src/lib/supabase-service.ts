/**
 * Service-role Supabase client — server-only. Never import from a
 * "use client" file; the service role key bypasses RLS and must never
 * reach the browser.
 *
 * Used by privileged flows such as /api/account/delete that need to
 * call `auth.admin.*` on behalf of the authenticated user.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — add it to .env.local and to the Vercel project env for production."
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
