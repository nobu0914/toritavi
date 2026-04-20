/**
 * User settings data layer (Supabase core).
 * Accepts a SupabaseClient + userId. Caller resolves the current user.
 * Schema lives in `supabase_migrations/007_user_settings.sql`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSettings, NotificationPrefs } from "./types";

const TABLE = "toritavi_user_settings";

function rowToSettings(row: Record<string, unknown>): UserSettings {
  return {
    displayName: (row.display_name as string) ?? undefined,
    timezone: (row.timezone as string) ?? undefined,
    defaultOrigin: (row.default_origin as string) ?? undefined,
    emergencyContact: (row.emergency_contact as string) ?? undefined,
    avatarUrl: (row.avatar_url as string) ?? undefined,
    notificationPrefs: (row.notification_prefs as NotificationPrefs) ?? {},
  };
}

export async function getUserSettings(
  sb: SupabaseClient,
  userId: string
): Promise<UserSettings> {
  const { data } = await sb
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return {};
  return rowToSettings(data as Record<string, unknown>);
}

export async function upsertUserSettings(
  sb: SupabaseClient,
  userId: string,
  patch: Partial<UserSettings>
): Promise<void> {
  // maybeSingle() above can return null for users who have never saved
  // settings; upsert handles both first-save and update.
  const row: Record<string, unknown> = { user_id: userId };
  if (patch.displayName !== undefined) row.display_name = patch.displayName || null;
  if (patch.timezone !== undefined) row.timezone = patch.timezone || null;
  if (patch.defaultOrigin !== undefined) row.default_origin = patch.defaultOrigin || null;
  if (patch.emergencyContact !== undefined) row.emergency_contact = patch.emergencyContact || null;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl || null;
  if (patch.notificationPrefs !== undefined) row.notification_prefs = patch.notificationPrefs;

  const { error } = await sb
    .from(TABLE)
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}
