/**
 * Guest mode store: localStorage-backed journeys for unauthenticated preview.
 * Seeded with sample data on first access.
 */
import type { Journey, JourneyDraft } from "./types";

const KEY = "toritavi_guest_journeys";

function read(): Journey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const seeded = seedSampleJourneys();
  localStorage.setItem(KEY, JSON.stringify(seeded));
  return seeded;
}

function write(journeys: Journey[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(journeys));
}

export async function getJourneys(): Promise<Journey[]> {
  return read().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export async function getJourney(id: string): Promise<Journey | undefined> {
  return read().find((j) => j.id === id);
}

export async function addJourney(journey: Journey): Promise<void> {
  const journeys = read();
  journeys.push(journey);
  write(journeys);
}

export async function updateJourney(id: string, updates: Partial<Journey>): Promise<void> {
  const journeys = read();
  const idx = journeys.findIndex((j) => j.id === id);
  if (idx < 0) return;
  journeys[idx] = {
    ...journeys[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  write(journeys);
}

export async function deleteJourney(id: string): Promise<void> {
  write(read().filter((j) => j.id !== id));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function clearGuestData(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

/* ====== Draft ====== */

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

/* ====== Sample seed ====== */

function seedSampleJourneys(): Journey[] {
  const now = new Date();
  const addDays = (d: Date, n: number): string => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x.toISOString().split("T")[0];
  };
  const today = addDays(now, 0);
  const t1 = new Date().toISOString();

  return [
    {
      id: crypto.randomUUID(),
      title: "大阪出張",
      startDate: addDays(now, 3),
      endDate: addDays(now, 4),
      memo: "取引先訪問",
      createdAt: t1,
      updatedAt: t1,
      steps: [
        {
          id: crypto.randomUUID(),
          category: "列車",
          title: "のぞみ 15号",
          date: addDays(now, 3),
          time: "08:30",
          endTime: "11:00",
          from: "東京",
          to: "新大阪",
          confNumber: "TK-445123",
          status: "未開始",
          information: [],
        },
        {
          id: crypto.randomUUID(),
          category: "商談",
          title: "ABC株式会社",
          date: addDays(now, 3),
          time: "14:00",
          endTime: "15:30",
          detail: "グランフロント大阪タワーB",
          status: "未開始",
          information: [],
        },
        {
          id: crypto.randomUUID(),
          category: "宿泊",
          title: "ホテル大阪ベイ",
          date: addDays(now, 3),
          endDate: addDays(now, 4),
          time: "18:00",
          endTime: "11:00",
          confNumber: "H-283901",
          status: "未開始",
          information: [],
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      title: "家族旅行",
      startDate: addDays(now, 14),
      endDate: addDays(now, 16),
      createdAt: t1,
      updatedAt: t1,
      steps: [
        {
          id: crypto.randomUUID(),
          category: "飛行機",
          title: "NH 225",
          date: addDays(now, 14),
          time: "10:00",
          endTime: "12:00",
          from: "HND",
          to: "KIX",
          confNumber: "ABC123",
          status: "未開始",
          information: [],
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      title: "通院予定",
      startDate: today,
      endDate: today,
      createdAt: t1,
      updatedAt: t1,
      steps: [
        {
          id: crypto.randomUUID(),
          category: "病院",
          title: "◯◯内科クリニック",
          date: today,
          time: "10:30",
          detail: "定期健診",
          status: "未開始",
          information: [],
        },
      ],
    },
  ];
}
