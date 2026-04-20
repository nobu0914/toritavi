/**
 * User settings for guest mode — localStorage-backed.
 * Guest fields are restricted (no email, no emergency contact, no avatar upload).
 */
import type { UserSettings } from "./types";

const KEY = "toritavi_user_settings_guest";

export function getGuestSettings(): UserSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as UserSettings;
  } catch {
    return {};
  }
}

export function updateGuestSettings(patch: Partial<UserSettings>): void {
  if (typeof window === "undefined") return;
  const current = getGuestSettings();
  // Guest variant: avatarUrl is never persisted (no Storage bucket for guests).
  // emergencyContact is also gated to discourage PII-in-localStorage.
  const { avatarUrl: _avatar, emergencyContact: _ec, ...allowed } = patch;
  void _avatar;
  void _ec;
  const next: UserSettings = { ...current, ...allowed };
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

export function clearGuestSettings(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
