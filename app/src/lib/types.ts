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
  | "病院"
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
  date?: string;         // YYYY-MM-DD（開始日）
  endDate?: string;      // YYYY-MM-DD（終了日、宿泊checkout等）
  time: string;          // 開始時刻 HH:MM
  endTime?: string;      // 終了時刻 HH:MM
  timezone?: string;     // タイムゾーン（例: JST, CET）
  from?: string;         // 出発地・場所
  to?: string;           // 到着地
  airline?: string;      // 運行航空会社（飛行機のみ。コードシェア時の実運航キャリア名 例: "Air New Zealand"）
  detail?: string;       // 旧互換用
  confNumber?: string;
  memo?: string;
  source?: StepSource;
  sourceImageUrl?: string;
  sourceImageUrls?: string[];
  status: StepStatus;
  information: Information[];
  inferred?: string[];      // 推定値のフィールド名リスト
  needsReview?: boolean;    // 要確認フラグ
  /**
   * §16 Step マージ用: 直前世代のスナップショット（1 世代のみ保持）。
   * マージ後の Toast「元に戻す」でここに復元する。
   * 2 回目のマージで上書きされる。
   */
  previous?: Omit<Step, "previous">;
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
