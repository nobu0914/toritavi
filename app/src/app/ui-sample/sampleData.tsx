import {
  IconCalendarEvent,
  IconCamera,
  IconClock,
  IconMail,
  IconMapPin,
  IconPlane,
  IconReceipt2,
  IconTicket,
  IconTrain,
  IconTypography,
  IconUpload,
} from "@tabler/icons-react";

export const attentionCards = [
  {
    title: "確認番号が未設定",
    detail: "名古屋 営業訪問のホテル予約",
    icon: IconReceipt2,
  },
  {
    title: "書類の取り込み待ち",
    detail: "沖縄 リフレッシュ旅のレンタカー",
    icon: IconUpload,
  },
];

export const journeyCards = [
  {
    eyebrow: "2日後に出発",
    title: "京都 日帰り旅",
    detail: "列車 1 / 観光 1 / 食事 1",
    meta: "次: 新幹線で京都へ 08:30",
    badge: "準備中",
  },
  {
    eyebrow: "今日",
    title: "木更津 アウトレット",
    detail: "車 1 / 観光 1 / 食事 1",
    meta: "次: アクアライン経由で移動 11:00",
    badge: "進行中",
  },
  {
    eyebrow: "完了済み",
    title: "別府 温泉旅",
    detail: "飛行機 1 / バス 1 / 宿泊 1",
    meta: "温泉旅館に宿泊",
    badge: "完了",
  },
];

export const plans = [
  {
    time: "11:00",
    title: "アクアライン経由で移動",
    detail: "都内 → 木更津",
    info: "車",
    icon: IconPlane,
    state: "next",
  },
  {
    time: "13:00",
    title: "アウトレットで買い物",
    detail: "三井アウトレットパーク 木更津",
    info: "観光",
    icon: IconTicket,
    state: "normal",
  },
  {
    time: "18:00",
    title: "海沿いで夕食",
    detail: "木更津港周辺",
    info: "食事",
    icon: IconCalendarEvent,
    state: "normal",
  },
];

export const captureQueue = [
  {
    title: "搭乗券を撮影",
    detail: "札幌 週末旅行",
    icon: IconCamera,
  },
  {
    title: "ホテル予約PDFを追加",
    detail: "金沢 1泊旅",
    icon: IconUpload,
  },
  {
    title: "集合場所を入力",
    detail: "神戸 家族おでかけ",
    icon: IconMapPin,
  },
];

export const createSteps = [
  {
    number: 1,
    category: "列車",
    title: "のぞみ 225号",
    rows: [
      { icon: IconClock, label: "時間", value: "10:00 → 12:30" },
      { icon: IconMapPin, label: "区間", value: "東京 → 新大阪" },
      { icon: IconReceipt2, label: "確認番号", value: "TK-882541", accent: true },
    ],
    source: "撮影 → OCR",
    thumbs: ["camera"],
  },
  {
    number: 2,
    category: "宿泊",
    title: "ホテル大阪ベイ",
    rows: [
      { icon: IconClock, label: "時間", value: "Check-in 18:00 / Check-out 11:00" },
      { icon: IconReceipt2, label: "確認番号", value: "H-283901", accent: true },
    ],
    source: "PDFアップロード",
    thumbs: ["upload", "upload"],
  },
];

export const createActions = [
  { icon: IconCamera, label: "撮影" },
  { icon: IconUpload, label: "アップロード" },
  { icon: IconMail, label: "メール" },
  { icon: IconTypography, label: "手入力" },
];
