/**
 * Supabase data layer (core).
 * Accepts a SupabaseClient + userId. Caller is responsible for passing
 * the right client (server vs browser) and resolving the current user.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Journey, Step, JourneyDraft } from "./types";

/* ====== Journey CRUD ====== */

const STEP_COLUMNS_LIGHT = "id,journey_id,category,title,date,end_date,time,end_time,from,to,detail,conf_number,memo,source,timezone,status,inferred,needs_review,information,sort_order";

export async function getJourneys(sb: SupabaseClient): Promise<Journey[]> {
  const { data, error } = await sb
    .from("toritavi_journeys")
    .select(`*, toritavi_steps(${STEP_COLUMNS_LIGHT})`)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map((j: Record<string, unknown>) => {
    const steps = ((j.toritavi_steps as Record<string, unknown>[]) || [])
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
    return rowToJourney(j, steps);
  });
}

export async function getJourney(sb: SupabaseClient, id: string): Promise<Journey | undefined> {
  const { data: j } = await sb
    .from("toritavi_journeys")
    .select(`*, toritavi_steps(${STEP_COLUMNS_LIGHT})`)
    .eq("id", id)
    .single();

  if (!j) return undefined;

  const steps = ((j.toritavi_steps as Record<string, unknown>[]) || [])
    .sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
  return rowToJourney(j, steps);
}

export async function getStepImages(
  sb: SupabaseClient,
  stepId: string
): Promise<{ sourceImageUrl?: string; sourceImageUrls?: string[] }> {
  const { data } = await sb
    .from("toritavi_steps")
    .select("source_image_url, source_image_urls")
    .eq("id", stepId)
    .single();
  if (!data) return {};
  return {
    sourceImageUrl: data.source_image_url || undefined,
    sourceImageUrls: data.source_image_urls || undefined,
  };
}

export async function addJourney(sb: SupabaseClient, userId: string, journey: Journey): Promise<void> {
  const { steps, ...rest } = journey;

  const { error: jErr } = await sb.from("toritavi_journeys").upsert({
    id: rest.id,
    user_id: userId,
    title: rest.title,
    start_date: rest.startDate,
    end_date: rest.endDate,
    memo: rest.memo || null,
    created_at: rest.createdAt,
    updated_at: rest.updatedAt,
  });
  if (jErr) throw new Error(`Journey保存に失敗: ${jErr.message}`);

  if (steps.length > 0) {
    const { error: sErr } = await sb.from("toritavi_steps").upsert(
      steps.map((s, i) => stepToRow(s, journey.id, userId, i))
    );
    if (sErr) throw new Error(`ステップ保存に失敗: ${sErr.message}`);
  }
}

export async function updateJourney(
  sb: SupabaseClient,
  userId: string,
  id: string,
  updates: Partial<Journey>
): Promise<void> {
  const { steps, ...rest } = updates;

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (rest.title !== undefined) updateData.title = rest.title;
  if (rest.startDate !== undefined) updateData.start_date = rest.startDate;
  if (rest.endDate !== undefined) updateData.end_date = rest.endDate;
  if (rest.memo !== undefined) updateData.memo = rest.memo;

  const { error: uErr } = await sb.from("toritavi_journeys").update(updateData).eq("id", id);
  if (uErr) throw new Error(`Journey更新に失敗: ${uErr.message}`);

  if (steps) {
    // Fetch existing step IDs so we can diff and preserve image columns.
    // Using light select (id only) — avoids shipping image blobs we don't need.
    const { data: existingRows } = await sb
      .from("toritavi_steps")
      .select("id")
      .eq("journey_id", id);
    const existingIds = new Set((existingRows ?? []).map((r: { id: string }) => r.id));
    const nextIds = new Set(steps.map((s) => s.id));
    const removedIds = [...existingIds].filter((eid) => !nextIds.has(eid));

    if (removedIds.length > 0) {
      const { error: dErr } = await sb
        .from("toritavi_steps")
        .delete()
        .in("id", removedIds);
      if (dErr) throw new Error(`ステップ削除に失敗: ${dErr.message}`);
    }

    if (steps.length > 0) {
      const { error: sErr } = await sb.from("toritavi_steps").upsert(
        steps.map((s, i) => stepToRow(s, id, userId, i))
      );
      if (sErr) throw new Error(`ステップ更新に失敗: ${sErr.message}`);
    }
  }
}

export async function deleteJourney(sb: SupabaseClient, id: string): Promise<void> {
  await sb.from("toritavi_journeys").delete().eq("id", id);
}

export function generateId(): string {
  return crypto.randomUUID();
}

/* ====== Draft (localStorage — 一時データ) ====== */

const DRAFT_KEY = "toritavi_journey_draft";

export function getJourneyDraft(): JourneyDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveJourneyDraft(draft: JourneyDraft): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearJourneyDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_KEY);
}

/* ====== row <-> object 変換 ====== */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJourney(row: any, stepRows: any[]): Journey {
  return {
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: stepRows.map(rowToStep),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToStep(row: any): Step {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    date: row.date || undefined,
    endDate: row.end_date || undefined,
    time: row.time || "",
    endTime: row.end_time || undefined,
    from: row.from || undefined,
    to: row.to || undefined,
    detail: row.detail || undefined,
    confNumber: row.conf_number || undefined,
    memo: row.memo || undefined,
    source: row.source || undefined,
    sourceImageUrl: row.source_image_url || undefined,
    sourceImageUrls: row.source_image_urls || undefined,
    timezone: row.timezone || undefined,
    status: row.status || "未開始",
    inferred: row.inferred || undefined,
    needsReview: row.needs_review || undefined,
    information: row.information || [],
  };
}

function stepToRow(step: Step, journeyId: string, userId: string, sortOrder: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: step.id,
    journey_id: journeyId,
    user_id: userId,
    category: step.category,
    title: step.title,
    date: step.date || null,
    end_date: step.endDate || null,
    time: step.time || "",
    end_time: step.endTime || null,
    from: step.from || null,
    to: step.to || null,
    detail: step.detail || null,
    conf_number: step.confNumber || null,
    memo: step.memo || null,
    source: step.source || null,
    timezone: step.timezone || null,
    status: step.status,
    inferred: step.inferred || null,
    needs_review: step.needsReview || false,
    information: step.information || [],
    sort_order: sortOrder,
  };
  // Omit image fields when undefined so upsert preserves existing DB values
  // (the calling layer loads steps via STEP_COLUMNS_LIGHT which excludes images for perf).
  // Pass an explicit null/empty string to clear.
  if (step.sourceImageUrl !== undefined) {
    row.source_image_url = step.sourceImageUrl || null;
  }
  if (step.sourceImageUrls !== undefined) {
    row.source_image_urls = step.sourceImageUrls || null;
  }
  return row;
}
