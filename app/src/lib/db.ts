/**
 * IndexedDB (Dexie.js) — ローカルファーストDB
 * localStorageの代わりにIndexedDBを使用。
 * キャッシュクリアでも消えにくく、大容量データに対応。
 */
import Dexie, { type EntityTable } from "dexie";
import type { Journey, Step } from "./types";

// IndexedDB用のJourney型（stepsはリレーションで管理）
export type DBJourney = Omit<Journey, "steps"> & {
  syncedAt?: string;
  dirty?: boolean; // 未同期フラグ
};

export type DBStep = Step & {
  journeyId: string;
  sortOrder: number;
  syncedAt?: string;
  dirty?: boolean;
};

class ToritaviDB extends Dexie {
  journeys!: EntityTable<DBJourney, "id">;
  steps!: EntityTable<DBStep, "id">;

  constructor() {
    super("toritavi");
    this.version(1).stores({
      journeys: "id, dirty",
      steps: "id, journeyId, dirty",
    });
  }
}

export const db = new ToritaviDB();

/** デバイスIDを取得（なければ生成） */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem("toritavi_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("toritavi_device_id", id);
  }
  return id;
}

/* ====== CRUD操作 ====== */

/** 全Journey取得（steps込み） */
export async function getJourneys(): Promise<Journey[]> {
  const journeys = await db.journeys.toArray();
  const steps = await db.steps.toArray();

  return journeys.map((j) => ({
    ...j,
    steps: steps
      .filter((s) => s.journeyId === j.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ journeyId, sortOrder, syncedAt, dirty, ...step }) => step),
  }));
}

/** Journey 1件取得 */
export async function getJourney(id: string): Promise<Journey | undefined> {
  const j = await db.journeys.get(id);
  if (!j) return undefined;
  const steps = await db.steps.where("journeyId").equals(id).sortBy("sortOrder");
  return {
    ...j,
    steps: steps.map(({ journeyId, sortOrder, syncedAt, dirty, ...step }) => step),
  };
}

/** Journey追加 */
export async function addJourney(journey: Journey): Promise<void> {
  const { steps, ...rest } = journey;
  await db.journeys.put({ ...rest, dirty: true });
  if (steps.length > 0) {
    await db.steps.bulkPut(
      steps.map((s, i) => ({ ...s, journeyId: journey.id, sortOrder: i, dirty: true }))
    );
  }
}

/** Journey更新 */
export async function updateJourney(id: string, updates: Partial<Journey>): Promise<void> {
  const { steps, ...rest } = updates;
  await db.journeys.update(id, { ...rest, updatedAt: new Date().toISOString(), dirty: true });
  if (steps) {
    // 既存steps削除→再挿入
    await db.steps.where("journeyId").equals(id).delete();
    await db.steps.bulkPut(
      steps.map((s, i) => ({ ...s, journeyId: id, sortOrder: i, dirty: true }))
    );
  }
}

/** Journey削除 */
export async function deleteJourney(id: string): Promise<void> {
  await db.steps.where("journeyId").equals(id).delete();
  await db.journeys.delete(id);
}

/** IDを生成 */
export function generateId(): string {
  return crypto.randomUUID();
}

/* ====== localStorage からの移行 ====== */

/** localStorageのデータをIndexedDBに移行（初回のみ） */
export async function migrateFromLocalStorage(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const migrated = localStorage.getItem("toritavi_migrated_to_idb");
  if (migrated) return false;

  const raw = localStorage.getItem("toritavi_journeys");
  if (!raw) {
    localStorage.setItem("toritavi_migrated_to_idb", "true");
    return false;
  }

  try {
    const journeys: Journey[] = JSON.parse(raw);
    for (const journey of journeys) {
      const { steps, ...rest } = journey;
      await db.journeys.put({ ...rest, dirty: true });
      if (steps.length > 0) {
        await db.steps.bulkPut(
          steps.map((s, i) => ({ ...s, journeyId: journey.id, sortOrder: i, dirty: true }))
        );
      }
    }
    localStorage.setItem("toritavi_migrated_to_idb", "true");
    return true;
  } catch {
    return false;
  }
}
