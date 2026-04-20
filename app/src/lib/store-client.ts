"use client";

import { createClient } from "./supabase-browser";
import * as core from "./store-supabase";
import * as guestStore from "./store-guest";
import { disableGuestMode, isGuestMode } from "./guest";
import type { Journey, Step } from "./types";

/**
 * Authenticated user が localStorage に残ったゲストフラグを持ち越している場合
 * （/auth/callback 経由のサインアップ → 共有端末の旧ユーザーの残留 guest 等）に
 * ゲストモードを無効化してゲストの localStorage データを掃除する。
 * 認証チェックを先に通すことで、ログイン済みユーザーが誤ってゲストデータを
 * 参照しないことを保証する。
 */
function reconcileGuestMode(): void {
  if (isGuestMode()) {
    disableGuestMode();
    guestStore.clearGuestData();
  }
}

async function getAuthContext(): Promise<{ sb: ReturnType<typeof createClient>; userId: string | null }> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}

export async function getJourneys(): Promise<Journey[]> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.getJourneys(sb);
  }
  if (isGuestMode()) return guestStore.getJourneys();
  return [];
}

export async function getJourney(id: string): Promise<Journey | undefined> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.getJourney(sb, id);
  }
  if (isGuestMode()) return guestStore.getJourney(id);
  return undefined;
}

export async function addJourney(journey: Journey): Promise<void> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.addJourney(sb, userId, journey);
  }
  if (isGuestMode()) return guestStore.addJourney(journey);
  throw new Error("ログインが必要です");
}

export async function updateJourney(id: string, updates: Partial<Journey>): Promise<void> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.updateJourney(sb, userId, id, updates);
  }
  if (isGuestMode()) return guestStore.updateJourney(id, updates);
  throw new Error("ログインが必要です");
}

export async function deleteJourney(id: string): Promise<void> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.deleteJourney(sb, id);
  }
  if (isGuestMode()) return guestStore.deleteJourney(id);
  throw new Error("ログインが必要です");
}

export async function getStepImages(
  stepId: string,
): Promise<{ sourceImageUrl?: string; sourceImageUrls?: string[] }> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.getStepImages(sb, stepId);
  }
  return {};
}

export function generateId(): string {
  return core.generateId();
}

/* ====== Unfiled (Flow A: NULL-journey bucket) ====== */

export async function getUnfiledSteps(): Promise<Step[]> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.getUnfiledSteps(sb);
  }
  if (isGuestMode()) return guestStore.getUnfiledSteps();
  return [];
}

export async function addUnfiledSteps(steps: Step[]): Promise<void> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.addUnfiledSteps(sb, userId, steps);
  }
  if (isGuestMode()) return guestStore.addUnfiledSteps(steps);
  throw new Error("ログインが必要です");
}

export async function promoteUnfiledSteps(
  stepIds: string[],
  journeyId: string
): Promise<void> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.promoteUnfiledSteps(sb, stepIds, journeyId);
  }
  if (isGuestMode()) return guestStore.promoteUnfiledSteps(stepIds, journeyId);
  throw new Error("ログインが必要です");
}

export async function deleteUnfiledStep(stepId: string): Promise<void> {
  const { sb, userId } = await getAuthContext();
  if (userId) {
    reconcileGuestMode();
    return core.deleteUnfiledStep(sb, stepId);
  }
  if (isGuestMode()) return guestStore.deleteUnfiledStep(stepId);
  throw new Error("ログインが必要です");
}

/* ====== Draft: local only (同じキーを使うので mode 問わず共通) ====== */
export { getJourneyDraft, saveJourneyDraft, clearJourneyDraft } from "./store-supabase";
