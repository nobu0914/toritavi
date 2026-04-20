"use client";

/**
 * User settings dispatcher. Same guest/auth routing pattern as
 * store-client.ts. Callers don't need to know whether the current
 * user is guest or authenticated.
 */
import { createClient } from "./supabase-browser";
import * as core from "./store-settings-core";
import * as guestStore from "./store-settings-guest";
import { isGuestMode } from "./guest";
import type { UserSettings } from "./types";

async function getAuthContext(): Promise<{
  sb: ReturnType<typeof createClient>;
  userId: string | null;
}> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}

export async function getSettings(): Promise<UserSettings> {
  const { sb, userId } = await getAuthContext();
  if (userId) return core.getUserSettings(sb, userId);
  if (isGuestMode()) return guestStore.getGuestSettings();
  return {};
}

export async function updateSettings(patch: Partial<UserSettings>): Promise<void> {
  const { sb, userId } = await getAuthContext();
  if (userId) return core.upsertUserSettings(sb, userId, patch);
  if (isGuestMode()) return guestStore.updateGuestSettings(patch);
  throw new Error("ログインが必要です");
}

/**
 * Clear guest-only settings. Safe to call on logout / account deletion
 * flows to avoid leaving prior guest state on the device for the next
 * user of a shared machine.
 */
export function clearGuestSettings(): void {
  guestStore.clearGuestSettings();
}
