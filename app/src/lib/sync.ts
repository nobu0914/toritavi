/**
 * 同期レイヤー: IndexedDB ↔ Supabase
 * オンライン時にdirtyデータをSupabaseへ同期。
 * オフライン時はIndexedDBのみで動作。
 */
import { db, getDeviceId } from "./db";
import type { DBJourney, DBStep } from "./db";
import { supabase } from "./supabase";

/** dirty なデータをSupabaseに同期 */
export async function syncToCloud(): Promise<{ synced: number; errors: number }> {
  if (typeof window === "undefined") return { synced: 0, errors: 0 };
  if (!navigator.onLine) return { synced: 0, errors: 0 };
  if (!supabase) return { synced: 0, errors: 0 };

  let synced = 0;
  let errors = 0;
  const deviceId = getDeviceId();

  // dirty Journeys を同期
  const allJourneys = await db.journeys.toArray();
  const dirtyJourneys = allJourneys.filter((j) => j.dirty);
  for (const j of dirtyJourneys) {
    try {
      const { dirty, syncedAt, ...data } = j;
      const { error } = await supabase.from("toritavi_journeys").upsert({
        id: data.id,
        title: data.title,
        start_date: data.startDate,
        end_date: data.endDate,
        memo: data.memo || null,
        created_at: data.createdAt,
        updated_at: data.updatedAt,
        device_id: deviceId,
      });
      if (error) throw error;
      await db.journeys.update(j.id, { dirty: false, syncedAt: new Date().toISOString() });
      synced++;
    } catch {
      errors++;
    }
  }

  // dirty Steps を同期
  const allSteps = await db.steps.toArray();
  const dirtySteps = allSteps.filter((s) => s.dirty);
  for (const s of dirtySteps) {
    try {
      const { error } = await supabase.from("toritavi_steps").upsert({
        id: s.id,
        journey_id: s.journeyId,
        category: s.category,
        title: s.title,
        date: s.date || null,
        end_date: s.endDate || null,
        time: s.time,
        end_time: s.endTime || null,
        from: s.from || null,
        to: s.to || null,
        detail: s.detail || null,
        conf_number: s.confNumber || null,
        memo: s.memo || null,
        source: s.source || null,
        // 画像は大きいのでSupabaseには保存しない（IndexedDBのみ）
        timezone: s.timezone || null,
        status: s.status,
        inferred: s.inferred || null,
        needs_review: s.needsReview || false,
        information: s.information || [],
        sort_order: s.sortOrder,
      });
      if (error) throw error;
      await db.steps.update(s.id, { dirty: false, syncedAt: new Date().toISOString() });
      synced++;
    } catch {
      errors++;
    }
  }

  return { synced, errors };
}

/** Supabaseからデータを復元（キャッシュクリア後の復旧） */
export async function restoreFromCloud(): Promise<number> {
  if (typeof window === "undefined") return 0;
  if (!navigator.onLine) return 0;
  if (!supabase) return 0;

  const deviceId = getDeviceId();
  let restored = 0;

  // 既にローカルにデータがあれば復元しない
  const localCount = await db.journeys.count();
  if (localCount > 0) return 0;

  try {
    const { data: journeys, error: jError } = await supabase
      .from("toritavi_journeys")
      .select("*")
      .eq("device_id", deviceId);

    if (jError || !journeys) return 0;

    for (const j of journeys) {
      const journey: DBJourney = {
        id: j.id,
        title: j.title,
        startDate: j.start_date,
        endDate: j.end_date,
        memo: j.memo,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
        dirty: false,
        syncedAt: new Date().toISOString(),
      };
      await db.journeys.put(journey);
      restored++;
    }

    const { data: steps, error: sError } = await supabase
      .from("toritavi_steps")
      .select("*")
      .in("journey_id", journeys.map((j: { id: string }) => j.id));

    if (!sError && steps) {
      for (const s of steps) {
        const step: DBStep = {
          id: s.id,
          journeyId: s.journey_id,
          category: s.category,
          title: s.title,
          date: s.date,
          endDate: s.end_date,
          time: s.time,
          endTime: s.end_time,
          from: s.from,
          to: s.to,
          detail: s.detail,
          confNumber: s.conf_number,
          memo: s.memo,
          source: s.source,
          timezone: s.timezone,
          status: s.status,
          inferred: s.inferred,
          needsReview: s.needs_review,
          information: s.information || [],
          sortOrder: s.sort_order,
          dirty: false,
          syncedAt: new Date().toISOString(),
        };
        await db.steps.put(step);
      }
    }
  } catch {
    // オフラインまたはエラー時は何もしない
  }

  return restored;
}

/** オンライン復帰時の自動同期を設定 */
export function setupAutoSync(): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = () => {
    syncToCloud();
  };

  window.addEventListener("online", handleOnline);

  // 初回同期
  if (navigator.onLine) {
    syncToCloud();
  }

  return () => window.removeEventListener("online", handleOnline);
}
