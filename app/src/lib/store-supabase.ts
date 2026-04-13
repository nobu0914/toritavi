/**
 * Supabase直接データストア
 * localStorage/IndexedDB不要。Supabaseが唯一のデータソース。
 */
import { supabase } from "./supabase";
import type { Journey, Step, JourneyDraft } from "./types";

/* ====== Journey CRUD ====== */

// 一覧用: 画像データを除外して軽量取得
const STEP_COLUMNS_LIGHT = "id,journey_id,category,title,date,end_date,time,end_time,from,to,detail,conf_number,memo,source,timezone,status,inferred,needs_review,information,sort_order";

export async function getJourneys(): Promise<Journey[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
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

export async function getJourney(id: string): Promise<Journey | undefined> {
  if (!supabase) return undefined;
  const { data: j } = await supabase
    .from("toritavi_journeys")
    .select(`*, toritavi_steps(${STEP_COLUMNS_LIGHT})`)
    .eq("id", id)
    .single();

  if (!j) return undefined;

  const steps = ((j.toritavi_steps as Record<string, unknown>[]) || [])
    .sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
  return rowToJourney(j, steps);
}

/** ステップの画像データだけを取得（ドロワー表示時に使用） */
export async function getStepImages(stepId: string): Promise<{ sourceImageUrl?: string; sourceImageUrls?: string[] }> {
  if (!supabase) return {};
  const { data } = await supabase
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

export async function addJourney(journey: Journey): Promise<void> {
  if (!supabase) return;
  const { steps, ...rest } = journey;

  await supabase.from("toritavi_journeys").upsert({
    id: rest.id,
    title: rest.title,
    start_date: rest.startDate,
    end_date: rest.endDate,
    memo: rest.memo || null,
    created_at: rest.createdAt,
    updated_at: rest.updatedAt,
    device_id: getDeviceId(),
  });

  if (steps.length > 0) {
    await supabase.from("toritavi_steps").upsert(
      steps.map((s, i) => stepToRow(s, journey.id, i))
    );
  }
}

export async function updateJourney(id: string, updates: Partial<Journey>): Promise<void> {
  if (!supabase) return;
  const { steps, ...rest } = updates;

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (rest.title !== undefined) updateData.title = rest.title;
  if (rest.startDate !== undefined) updateData.start_date = rest.startDate;
  if (rest.endDate !== undefined) updateData.end_date = rest.endDate;
  if (rest.memo !== undefined) updateData.memo = rest.memo;

  await supabase.from("toritavi_journeys").update(updateData).eq("id", id);

  if (steps) {
    await supabase.from("toritavi_steps").delete().eq("journey_id", id);
    if (steps.length > 0) {
      await supabase.from("toritavi_steps").upsert(
        steps.map((s, i) => stepToRow(s, id, i))
      );
    }
  }
}

export async function deleteJourney(id: string): Promise<void> {
  if (!supabase) return;
  // steps are cascade deleted
  await supabase.from("toritavi_journeys").delete().eq("id", id);
}

export function generateId(): string {
  return crypto.randomUUID();
}

/* ====== Draft (localStorage — 一時データなので残す) ====== */

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

/* ====== ヘルパー ====== */

function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem("toritavi_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("toritavi_device_id", id);
  }
  return id;
}

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

function stepToRow(step: Step, journeyId: string, sortOrder: number): Record<string, unknown> {
  return {
    id: step.id,
    journey_id: journeyId,
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
    source_image_url: step.sourceImageUrl || null,
    source_image_urls: step.sourceImageUrls || null,
    timezone: step.timezone || null,
    status: step.status,
    inferred: step.inferred || null,
    needs_review: step.needsReview || false,
    information: step.information || [],
    sort_order: sortOrder,
  };
}
