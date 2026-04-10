export type StepStatus = "未開始" | "進行中" | "完了" | "遅延" | "キャンセル";

export type StepCategory =
  | "列車"
  | "飛行機"
  | "バス"
  | "車"
  | "徒歩"
  | "宿泊"
  | "商談"
  | "食事"
  | "観光"
  | "その他";

export type Information = {
  id: string;
  label: string;
  value: string;
};

export type StepSource = "撮影" | "アップロード" | "メール" | "手入力";

export type Step = {
  id: string;
  category: StepCategory;
  title: string;
  time: string;
  detail?: string;
  confNumber?: string;
  memo?: string;
  source?: StepSource;
  status: StepStatus;
  information: Information[];
};

export type Journey = {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  memo?: string;
  steps: Step[];
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
};

export type JourneyState = "準備中" | "進行中" | "完了";

export type JourneyDraftItem = {
  id: string;
  registered: boolean;
  source?: StepSource;
  step?: Step;
};

export type JourneyDraft = {
  title: string;
  memo: string;
  startDate: string;
  endDate: string;
  items: JourneyDraftItem[];
  savedAt: string;
};
