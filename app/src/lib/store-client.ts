"use client";

import { createClient } from "./supabase-browser";
import * as core from "./store-supabase";
import * as guestStore from "./store-guest";
import { isGuestMode } from "./guest";
import type { Journey } from "./types";

async function getUserId(): Promise<string | null> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user?.id ?? null;
}

export async function getJourneys(): Promise<Journey[]> {
  if (isGuestMode()) return guestStore.getJourneys();
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  return core.getJourneys(sb);
}

export async function getJourney(id: string): Promise<Journey | undefined> {
  if (isGuestMode()) return guestStore.getJourney(id);
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return undefined;
  return core.getJourney(sb, id);
}

export async function addJourney(journey: Journey): Promise<void> {
  if (isGuestMode()) return guestStore.addJourney(journey);
  const sb = createClient();
  const userId = await getUserId();
  if (!userId) throw new Error("ログインが必要です");
  return core.addJourney(sb, userId, journey);
}

export async function updateJourney(id: string, updates: Partial<Journey>): Promise<void> {
  if (isGuestMode()) return guestStore.updateJourney(id, updates);
  const sb = createClient();
  const userId = await getUserId();
  if (!userId) throw new Error("ログインが必要です");
  return core.updateJourney(sb, userId, id, updates);
}

export async function deleteJourney(id: string): Promise<void> {
  if (isGuestMode()) return guestStore.deleteJourney(id);
  const sb = createClient();
  return core.deleteJourney(sb, id);
}

export function generateId(): string {
  return core.generateId();
}

/* ====== Draft: local only (同じキーを使うので mode 問わず共通) ====== */
export { getJourneyDraft, saveJourneyDraft, clearJourneyDraft } from "./store-supabase";
