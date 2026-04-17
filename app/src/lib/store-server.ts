import "server-only";
import { createClient } from "./supabase-server";
import * as core from "./store-supabase";
import type { Journey } from "./types";

export async function getJourneys(): Promise<Journey[]> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  return core.getJourneys(sb);
}

export async function getJourney(id: string): Promise<Journey | undefined> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return undefined;
  return core.getJourney(sb, id);
}
