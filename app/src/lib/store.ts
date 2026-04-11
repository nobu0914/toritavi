import { Journey, JourneyDraft, Step, StepCategory, StepSource, StepStatus } from "./types";

const STORAGE_KEY = "toritavi_journeys";
const DRAFT_STORAGE_KEY = "toritavi_journey_draft";
const SAMPLE_ID_PREFIX = "sample-";

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

type SampleStepInput = {
  id: string;
  category: StepCategory;
  title: string;
  time: string;
  detail?: string;
  confNumber?: string;
  source?: StepSource;
  status: StepStatus;
};

type SampleJourneyInput = {
  id: string;
  title: string;
  startOffset: number;
  endOffset: number;
  memo?: string;
  steps: SampleStepInput[];
};

function buildSampleStep(input: SampleStepInput): Step {
  return {
    ...input,
    information: [],
  };
}

function createSampleJourneys(): Journey[] {
  const now = new Date().toISOString();
  const samples: SampleJourneyInput[] = [
    {
      id: "sample-kyoto-daytrip",
      title: "京都 日帰り旅",
      startOffset: 2,
      endOffset: 2,
      memo: "紅葉を見つつ、昼は錦市場で軽く食べ歩き。",
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
        },
        {
          id: "sample-kyoto-step-2",
          category: "観光",
          title: "清水寺エリア散策",
          time: "11:00",
          detail: "清水坂周辺",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-kyoto-step-3",
          category: "食事",
          title: "錦市場で昼食",
          time: "13:00",
          detail: "錦市場",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-osaka-business",
      title: "大阪 出張",
      startOffset: 6,
      endOffset: 7,
      memo: "初日は商談、翌朝にクライアント訪問。",
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
        },
        {
          id: "sample-osaka-step-2",
          category: "商談",
          title: "梅田で商談",
          time: "13:30",
          detail: "グランフロント大阪",
          source: "手入力",
          status: "未開始",
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
        },
      ],
    },
    {
      id: "sample-fukuoka-completed",
      title: "福岡 出張",
      startOffset: -5,
      endOffset: -4,
      memo: "移動と打ち合わせを完了済み。",
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
        },
        {
          id: "sample-fukuoka-step-2",
          category: "商談",
          title: "博多で打ち合わせ",
          time: "11:00",
          detail: "博多駅前",
          source: "手入力",
          status: "完了",
        },
      ],
    },
    {
      id: "sample-sendai-conference",
      title: "仙台 カンファレンス",
      startOffset: 1,
      endOffset: 2,
      memo: "初日は前泊、朝からイベント参加。",
      steps: [
        {
          id: "sample-sendai-step-1",
          category: "列車",
          title: "はやぶさで仙台へ",
          time: "17:20",
          detail: "東京 → 仙台",
          confNumber: "SND-3011",
          source: "アップロード",
          status: "未開始",
        },
        {
          id: "sample-sendai-step-2",
          category: "宿泊",
          title: "駅前ホテルにチェックイン",
          time: "20:00",
          detail: "仙台駅 西口",
          confNumber: "HOTEL-222",
          source: "メール",
          status: "未開始",
        },
        {
          id: "sample-sendai-step-3",
          category: "商談",
          title: "カンファレンス参加",
          time: "10:00",
          detail: "仙台国際センター",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-kobe-family",
      title: "神戸 家族おでかけ",
      startOffset: 4,
      endOffset: 4,
      memo: "南京町と港エリアをゆっくり回る。",
      steps: [
        {
          id: "sample-kobe-step-1",
          category: "列車",
          title: "新快速で三ノ宮へ",
          time: "09:10",
          detail: "大阪 → 三ノ宮",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-kobe-step-2",
          category: "観光",
          title: "メリケンパーク散策",
          time: "11:30",
          detail: "BE KOBE モニュメント周辺",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-kobe-step-3",
          category: "食事",
          title: "南京町でランチ",
          time: "13:00",
          detail: "元町エリア",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-nagoya-sales",
      title: "名古屋 営業訪問",
      startOffset: 8,
      endOffset: 8,
      memo: "午後に2社訪問、帰りは遅め。",
      steps: [
        {
          id: "sample-nagoya-step-1",
          category: "列車",
          title: "のぞみで名古屋へ",
          time: "10:00",
          detail: "東京 → 名古屋",
          confNumber: "NGY-8421",
          source: "アップロード",
          status: "未開始",
        },
        {
          id: "sample-nagoya-step-2",
          category: "商談",
          title: "栄で営業訪問",
          time: "14:00",
          detail: "久屋大通",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-nagoya-step-3",
          category: "食事",
          title: "帰り前に味噌カツ",
          time: "18:30",
          detail: "名駅地下街",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-sapporo-winter",
      title: "札幌 週末旅行",
      startOffset: 10,
      endOffset: 12,
      memo: "雪まつり前に下見も兼ねて滞在。",
      steps: [
        {
          id: "sample-sapporo-step-1",
          category: "飛行機",
          title: "新千歳便に搭乗",
          time: "08:15",
          detail: "羽田 → 新千歳",
          confNumber: "CTS-1188",
          source: "メール",
          status: "未開始",
        },
        {
          id: "sample-sapporo-step-2",
          category: "列車",
          title: "快速エアポートで札幌駅へ",
          time: "10:10",
          detail: "新千歳空港 → 札幌",
          source: "アップロード",
          status: "未開始",
        },
        {
          id: "sample-sapporo-step-3",
          category: "宿泊",
          title: "大通公園近くのホテル",
          time: "15:30",
          detail: "札幌市中央区",
          confNumber: "SNOW-440",
          source: "メール",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-hiroshima-visit",
      title: "広島 日帰り訪問",
      startOffset: 12,
      endOffset: 12,
      memo: "午前に現地確認、夕方には戻る。",
      steps: [
        {
          id: "sample-hiroshima-step-1",
          category: "飛行機",
          title: "広島便で移動",
          time: "07:10",
          detail: "羽田 → 広島",
          confNumber: "HIJ-6041",
          source: "アップロード",
          status: "未開始",
        },
        {
          id: "sample-hiroshima-step-2",
          category: "車",
          title: "レンタカーで現地へ",
          time: "09:30",
          detail: "広島空港 → 東広島",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-hiroshima-step-3",
          category: "商談",
          title: "現地パートナー訪問",
          time: "11:00",
          detail: "東広島オフィス",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-yokohama-date",
      title: "横浜 週末デート",
      startOffset: 3,
      endOffset: 3,
      memo: "海沿い中心でゆっくり回る予定。",
      steps: [
        {
          id: "sample-yokohama-step-1",
          category: "列車",
          title: "みなとみらいへ移動",
          time: "10:30",
          detail: "渋谷 → みなとみらい",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-yokohama-step-2",
          category: "観光",
          title: "赤レンガ倉庫を散策",
          time: "12:00",
          detail: "横浜赤レンガ倉庫",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-yokohama-step-3",
          category: "食事",
          title: "夜景を見ながらディナー",
          time: "18:30",
          detail: "山下公園周辺",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-kanazawa-stay",
      title: "金沢 1泊旅",
      startOffset: 14,
      endOffset: 15,
      memo: "近江町市場と兼六園を回る定番コース。",
      steps: [
        {
          id: "sample-kanazawa-step-1",
          category: "列車",
          title: "かがやきで金沢へ",
          time: "09:05",
          detail: "東京 → 金沢",
          confNumber: "KNZ-5110",
          source: "アップロード",
          status: "未開始",
        },
        {
          id: "sample-kanazawa-step-2",
          category: "宿泊",
          title: "武家屋敷近くの宿にチェックイン",
          time: "15:00",
          detail: "香林坊",
          confNumber: "RYOKAN-09",
          source: "メール",
          status: "未開始",
        },
        {
          id: "sample-kanazawa-step-3",
          category: "観光",
          title: "兼六園を散策",
          time: "16:30",
          detail: "兼六園",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-okinawa-resort",
      title: "沖縄 リフレッシュ旅",
      startOffset: 20,
      endOffset: 22,
      memo: "那覇到着後は北谷方面へ。",
      steps: [
        {
          id: "sample-okinawa-step-1",
          category: "飛行機",
          title: "那覇便で出発",
          time: "06:55",
          detail: "羽田 → 那覇",
          confNumber: "OKA-9212",
          source: "メール",
          status: "未開始",
        },
        {
          id: "sample-okinawa-step-2",
          category: "車",
          title: "レンタカー受け取り",
          time: "10:00",
          detail: "那覇空港営業所",
          source: "アップロード",
          status: "未開始",
        },
        {
          id: "sample-okinawa-step-3",
          category: "宿泊",
          title: "北谷のホテルへ",
          time: "16:00",
          detail: "アメリカンビレッジ周辺",
          confNumber: "SEA-208",
          source: "メール",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-shizuoka-drive",
      title: "静岡 ドライブ",
      startOffset: 5,
      endOffset: 5,
      memo: "海沿いを走って温泉まで。",
      steps: [
        {
          id: "sample-shizuoka-step-1",
          category: "車",
          title: "レンタカーで出発",
          time: "08:00",
          detail: "品川駅周辺",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-shizuoka-step-2",
          category: "観光",
          title: "三保の松原へ立ち寄り",
          time: "11:30",
          detail: "静岡市清水区",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-shizuoka-step-3",
          category: "食事",
          title: "海鮮ランチ",
          time: "13:00",
          detail: "清水港周辺",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-nara-walk",
      title: "奈良 のんびり散策",
      startOffset: -2,
      endOffset: -2,
      memo: "鹿と大仏を見て早めに帰宅。",
      steps: [
        {
          id: "sample-nara-step-1",
          category: "列車",
          title: "奈良へ移動",
          time: "09:00",
          detail: "京都 → 奈良",
          source: "手入力",
          status: "完了",
        },
        {
          id: "sample-nara-step-2",
          category: "徒歩",
          title: "奈良公園を散策",
          time: "11:00",
          detail: "東大寺周辺",
          source: "手入力",
          status: "完了",
        },
        {
          id: "sample-nara-step-3",
          category: "食事",
          title: "ならまちで昼食",
          time: "13:00",
          detail: "ならまち",
          source: "手入力",
          status: "完了",
        },
      ],
    },
    {
      id: "sample-toyama-inspection",
      title: "富山 現地確認",
      startOffset: 9,
      endOffset: 10,
      memo: "翌朝の現場入りに備えて前泊。",
      steps: [
        {
          id: "sample-toyama-step-1",
          category: "列車",
          title: "かがやきで富山へ",
          time: "16:10",
          detail: "東京 → 富山",
          confNumber: "TYM-700",
          source: "アップロード",
          status: "未開始",
        },
        {
          id: "sample-toyama-step-2",
          category: "宿泊",
          title: "駅前ホテル泊",
          time: "19:10",
          detail: "富山駅前",
          confNumber: "BIZ-330",
          source: "メール",
          status: "未開始",
        },
        {
          id: "sample-toyama-step-3",
          category: "商談",
          title: "朝の現地確認",
          time: "09:00",
          detail: "富山市内",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-kagoshima-trip",
      title: "鹿児島 帰省",
      startOffset: 16,
      endOffset: 18,
      memo: "家族との食事と墓参り。",
      steps: [
        {
          id: "sample-kagoshima-step-1",
          category: "飛行機",
          title: "鹿児島便に搭乗",
          time: "12:25",
          detail: "羽田 → 鹿児島",
          confNumber: "KOJ-314",
          source: "メール",
          status: "未開始",
        },
        {
          id: "sample-kagoshima-step-2",
          category: "車",
          title: "実家まで移動",
          time: "15:00",
          detail: "空港 → 市内",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-kagoshima-step-3",
          category: "食事",
          title: "家族で夕食",
          time: "19:00",
          detail: "天文館",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
    {
      id: "sample-oita-onsen",
      title: "別府 温泉旅",
      startOffset: -9,
      endOffset: -7,
      memo: "温泉メインでゆったり滞在。",
      steps: [
        {
          id: "sample-oita-step-1",
          category: "飛行機",
          title: "大分便で出発",
          time: "08:40",
          detail: "羽田 → 大分",
          confNumber: "OIT-501",
          source: "アップロード",
          status: "完了",
        },
        {
          id: "sample-oita-step-2",
          category: "バス",
          title: "空港バスで別府へ",
          time: "10:20",
          detail: "大分空港 → 別府北浜",
          source: "手入力",
          status: "完了",
        },
        {
          id: "sample-oita-step-3",
          category: "宿泊",
          title: "温泉旅館に宿泊",
          time: "15:00",
          detail: "鉄輪温泉",
          confNumber: "ONSEN-88",
          source: "メール",
          status: "完了",
        },
      ],
    },
    {
      id: "sample-chiba-outlet",
      title: "木更津 アウトレット",
      startOffset: 7,
      endOffset: 7,
      memo: "昼過ぎ出発の軽いおでかけ。",
      steps: [
        {
          id: "sample-chiba-step-1",
          category: "車",
          title: "アクアライン経由で移動",
          time: "11:00",
          detail: "都内 → 木更津",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-chiba-step-2",
          category: "観光",
          title: "アウトレットで買い物",
          time: "13:00",
          detail: "三井アウトレットパーク 木更津",
          source: "手入力",
          status: "未開始",
        },
        {
          id: "sample-chiba-step-3",
          category: "食事",
          title: "海沿いで夕食",
          time: "18:00",
          detail: "木更津港周辺",
          source: "手入力",
          status: "未開始",
        },
      ],
    },
  ];

  return samples.map((journey) => ({
    id: journey.id,
    title: journey.title,
    startDate: formatDateOffset(journey.startOffset),
    endDate: formatDateOffset(journey.endOffset),
    memo: journey.memo,
    createdAt: now,
    updatedAt: now,
    steps: journey.steps.map(buildSampleStep),
  }));
}

function isSampleJourney(journey: Journey): boolean {
  return journey.id.startsWith(SAMPLE_ID_PREFIX);
}

export function getJourneys(): Journey[] {
  return load();
}

export function seedSampleJourneys(): Journey[] {
  if (typeof window === "undefined") return [];

  const existing = load();
  const samples = createSampleJourneys();

  if (existing.length === 0) {
    save(samples);
    return samples;
  }

  const hasOnlySamples = existing.every(isSampleJourney);
  const existingSampleIds = new Set(
    existing.filter(isSampleJourney).map((journey) => journey.id)
  );
  const missingSamples = samples.filter((journey) => !existingSampleIds.has(journey.id));

  if (hasOnlySamples && missingSamples.length > 0) {
    const nextJourneys = [...existing, ...missingSamples];
    save(nextJourneys);
    return nextJourneys;
  }

  return existing;
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
