import { Journey, JourneyDraft } from "./types";

const STORAGE_KEY = "toritavi_journeys";
const DRAFT_STORAGE_KEY = "toritavi_journey_draft";

function load(): Journey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(journeys: Journey[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(journeys));
}

function loadDraft(): JourneyDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: JourneyDraft) {
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function formatDateOffset(offsetDays: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createSampleJourneys(): Journey[] {
  const now = new Date().toISOString();

  return [
    {
      id: "sample-kyoto-daytrip",
      title: "京都 日帰り旅",
      startDate: formatDateOffset(2),
      endDate: formatDateOffset(2),
      memo: "紅葉を見つつ、昼は錦市場で軽く食べ歩き。",
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: "sample-kyoto-step-1",
          category: "列車",
          title: "新幹線で京都へ",
          time: "08:30",
          detail: "東京 → 京都",
          confNumber: "KY-2048",
          source: "手入力",
          status: "未開始",
          information: [],
        },
        {
          id: "sample-kyoto-step-2",
          category: "観光",
          title: "清水寺エリア散策",
          time: "11:00",
          detail: "清水坂周辺",
          source: "手入力",
          status: "未開始",
          information: [],
        },
        {
          id: "sample-kyoto-step-3",
          category: "食事",
          title: "錦市場で昼食",
          time: "13:00",
          detail: "錦市場",
          source: "手入力",
          status: "未開始",
          information: [],
        },
      ],
    },
    {
      id: "sample-osaka-business",
      title: "大阪 出張",
      startDate: formatDateOffset(6),
      endDate: formatDateOffset(7),
      memo: "初日は商談、翌朝にクライアント訪問。",
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: "sample-osaka-step-1",
          category: "飛行機",
          title: "伊丹便に搭乗",
          time: "09:20",
          detail: "羽田 → 伊丹",
          confNumber: "ITM-8821",
          source: "アップロード",
          status: "未開始",
          information: [],
        },
        {
          id: "sample-osaka-step-2",
          category: "商談",
          title: "梅田で商談",
          time: "13:30",
          detail: "グランフロント大阪",
          source: "手入力",
          status: "未開始",
          information: [],
        },
        {
          id: "sample-osaka-step-3",
          category: "宿泊",
          title: "ホテルチェックイン",
          time: "18:00",
          detail: "中之島",
          confNumber: "HOTEL-512",
          source: "メール",
          status: "未開始",
          information: [],
        },
      ],
    },
    {
      id: "sample-fukuoka-completed",
      title: "福岡 出張",
      startDate: formatDateOffset(-5),
      endDate: formatDateOffset(-4),
      memo: "移動と打ち合わせを完了済み。",
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: "sample-fukuoka-step-1",
          category: "飛行機",
          title: "福岡便で移動",
          time: "07:45",
          detail: "羽田 → 福岡",
          confNumber: "FUK-1102",
          source: "アップロード",
          status: "完了",
          information: [],
        },
        {
          id: "sample-fukuoka-step-2",
          category: "商談",
          title: "博多で打ち合わせ",
          time: "11:00",
          detail: "博多駅前",
          source: "手入力",
          status: "完了",
          information: [],
        },
      ],
    },
  ];
}

export function getJourneys(): Journey[] {
  return load();
}

export function seedSampleJourneys(): Journey[] {
  if (typeof window === "undefined") return [];

  const existing = load();
  if (existing.length > 0) return existing;

  const samples = createSampleJourneys();
  save(samples);
  return samples;
}

export function getJourney(id: string): Journey | undefined {
  return load().find((j) => j.id === id);
}

export function addJourney(journey: Journey): void {
  const list = load();
  list.push(journey);
  save(list);
}

export function updateJourney(id: string, updates: Partial<Journey>): void {
  const list = load();
  const idx = list.findIndex((j) => j.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
  save(list);
}

export function deleteJourney(id: string): void {
  save(load().filter((j) => j.id !== id));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function getJourneyDraft(): JourneyDraft | null {
  return loadDraft();
}

export function saveJourneyDraft(draft: JourneyDraft): void {
  saveDraft(draft);
}

export function clearJourneyDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_STORAGE_KEY);
}
