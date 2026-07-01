"use client";

import { Box, Text, Loader, TextInput, Checkbox, Textarea, Modal, Button, Group, Anchor } from "@mantine/core";
import {
  IconCamera,
  IconUpload,
  IconPlane,
  IconTrain,
  IconBed,
  IconToolsKitchen2,
  IconBus,
  IconCar,
  IconShip,
  IconTicket,
  IconCalendarEvent,
  IconDots,
  IconScan,
  IconCheck,
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDragDrop,
  IconClipboardText,
  IconFlask,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { DestinationSelector } from "./DestinationSelector";
import { JourneyPicker } from "./JourneyPicker";
import { addJourney, getJourney, getJourneys, updateJourney, generateId, addUnfiledSteps } from "@/lib/store-client";
import type { Step, StepCategory } from "@/lib/types";
import { getFixedFields } from "@/lib/ocr-rules";
import classes from "@/app/scan/page.module.css";

export type ScanFlowProps = {
  /** standalone: AppHeader + TabBar を自前描画（/scan ページ用） / embedded: chrome 描画なし（AddStepDrawer 用） */
  chrome?: "standalone" | "embedded";
  /** 追加先 Journey。embedded 時は必須、standalone 時は searchParams の ?target= にフォールバック。 */
  target?: { id: string; title: string };
  /** 登録完了コールバック。embedded では Sheet 閉じ、standalone では router.push がデフォルト動作。 */
  onComplete?: (journeyId: string) => void;
};

/* ====== カテゴリ定義 ====== */

type CategoryDef = {
  key: StepCategory;
  label: string;
  icon: typeof IconPlane;
  color: string;
};

const categoryDefs: CategoryDef[] = [
  { key: "飛行機", label: "フライト", icon: IconPlane, color: "blue" },
  { key: "列車", label: "鉄道", icon: IconTrain, color: "blue" },
  { key: "バス", label: "バス", icon: IconBus, color: "green" },
  { key: "車", label: "車", icon: IconCar, color: "green" },
  { key: "船", label: "フェリー・船", icon: IconShip, color: "green" },
  { key: "宿泊", label: "ホテル", icon: IconBed, color: "teal" },
  { key: "観光", label: "チケット・体験", icon: IconTicket, color: "violet" },
  { key: "食事", label: "食事", icon: IconToolsKitchen2, color: "orange" },
  { key: "アポ", label: "予約・アポ", icon: IconCalendarEvent, color: "indigo" },
  { key: "その他", label: "その他", icon: IconDots, color: "gray" },
];

function getCategoryDef(key: StepCategory): CategoryDef {
  return categoryDefs.find((c) => c.key === key) ?? categoryDefs[categoryDefs.length - 1];
}

/* Mantine color name → DS token (bg / fg) */
function categoryColorBg(color: string): string {
  const map: Record<string, string> = {
    blue: "var(--info-50)",
    teal: "var(--success-50)",
    violet: "var(--test-bg)",
    indigo: "var(--info-50)",
    orange: "var(--accent-50)",
    green: "var(--success-50)",
    red: "var(--danger-50)",
    gray: "var(--n-100)",
  };
  return map[color] ?? "var(--n-100)";
}
function categoryColorFg(color: string): string {
  const map: Record<string, string> = {
    blue: "var(--info-700)",
    teal: "var(--success-700)",
    violet: "var(--test-fg)",
    indigo: "var(--info-700)",
    orange: "var(--accent-700)",
    green: "var(--success-700)",
    red: "var(--danger-700)",
    gray: "var(--n-700)",
  };
  return map[color] ?? "var(--n-700)";
}

/* ====== カテゴリ自動判定 ====== */

function detectCategory(text: string): StepCategory {
  const t = text.toLowerCase();
  // 判定順が肝。共通語（JR/号車/ホテル/入場 等）で別カテゴリに奪われないよう、
  // 具体的で誤爆の少ないカテゴリを先に評価する。Flutter scan_text_extract.dart と完全一致。

  // 1) 船 — 飛行機より先に。フェリー券の "Boarding Voucher" が飛行機の boarding に奪われるのを防ぐ。
  if (/フェリー|ferry|乗船券|乗船日|客船|船便|汽船|高速船|ジェットフォイル|出航|入港|フェリーターミナル|船中泊|乗船/i.test(t)) return "船";
  // 2) 飛行機 — "Tanaka" の ana 等、人名に含まれる航空コードの誤爆を防ぐため語境界(\b)付き。boarding は券種(pass)に限定。
  if (/搭乗|boarding\s?pass|航空券|便名|フライト|欠航|搭乗口|搭乗券|国際線|国内線|受託手荷物|手荷物|機内|搭乗時刻|航空便|\b(ana|jal|nh|jl|ua|dl|aa|sq|cx|mm|gk|bc|sky|ek|zg)\b|emirates|zipair|全日空|日本航空|スターフライヤー|スカイマーク|peach|jetstar|gate\s?\d/i.test(t)) return "飛行機";
  // 2) 食事（強い語）— ホテル内レストランや予約番号 "JR-…" に奪われる前に確定。
  if (/食べログ|tablecheck|ぐるなび|ホットペッパー|一休.?com|居酒屋|焼肉|焼鳥|鮨|寿司|割烹|料亭|京料理|懐石|ビストロ|トラットリア|オステリア|オーベルジュ|auberge|もつ鍋|鍋料理|しゃぶしゃぶ|すき焼き|ステーキ|串揚げ|レストラン|ダイニング|カフェ|cafe|coffee|コース料理|飲み放題|ドレスコード|dress\s?code|\bchef\b|tasting|食事処|食堂|シェフ|omakase|お任せコース|席種/i.test(t)) return "食事";
  // 3) バス — 号車/乗車券が列車と重なるため列車より先に。
  if (/高速バス|路線バス|シャトルバス|空港バス|送迎バス|夜行バス|リムジンバス|バス|\bbus\b|シャトル|shuttle/i.test(t)) return "バス";
  // 4) アポ（会議・商談・ビジネスイベント。医療は対象外）— "入場/パス" 等が観光と衝突するため観光より先に。
  if (/会議|商談|打ち合わせ|打合せ|ミーティング|meeting|アポイント|会議室|訪問|取引先|来訪|カンファレンス|conference|セミナー|seminar|サミット|summit|フォーラム|forum|出展|見本市|研修|training|受講|登壇|入場証|入館証|名刺|business\s?card/i.test(t)) return "アポ";
  // 5) 列車 — 予約番号 "JR-1234" を誤検出しないよう jr は数字直前を除外。
  if (/新幹線|のぞみ|ひかり|こだま|みずほ|さくら|はやぶさ|かがやき|つばさ|やまびこ|とき|あさま|ロマンスカー|特急|急行|号車|乗車券|きっぷ|jr[東西九北四]|jr(?![-\s]?\d)|私鉄|電鉄|列車|鉄道/i.test(t)) return "列車";
  // 6) 宿泊
  if (/hotel|ホテル|check.?in|check.?out|チェックイン|チェックアウト|宿泊|ご宿泊|連泊|旅館|inn|ゲストハウス|ヴィラ|リゾート/i.test(t)) return "宿泊";
  // 8) 車
  if (/レンタカー|rent.?a.?car|カーシェア|car\s?rental|タイムズカー/i.test(t)) return "車";
  // 9) 観光（広め・フォールバック手前）
  if (/チケット|ticket|入場|座席|アリーナ|ホール|劇場|シアター|開演|開場|ツアー|tour|アクティビティ|バウチャー|voucher|美術館|博物館|水族館|動物園|遊園地|テーマパーク|ディズニー|ユニバーサル|usj|デーパスポート|フリーパス|コンサート|ライブ|公演|観劇|試合|入園|招待券|前売券/i.test(t)) return "観光";
  return "その他";
}

/* ====== カテゴリ別フィールド定義 ====== */

type FormField = {
  key: string;
  label: string;
  placeholder: string;
};

const categoryFields: Record<string, FormField[]> = {
  飛行機: [
    { key: "flightNo", label: "便名", placeholder: "NH225" },
    { key: "departure", label: "出発空港", placeholder: "NRT" },
    { key: "departureTime", label: "出発時刻", placeholder: "10:00" },
    { key: "arrival", label: "到着空港", placeholder: "KIX" },
    { key: "arrivalTime", label: "到着時刻", placeholder: "12:00" },
    { key: "gate", label: "ゲート", placeholder: "A12" },
    { key: "seat", label: "座席", placeholder: "32A" },
    { key: "confNumber", label: "確認番号", placeholder: "ABC123" },
  ],
  列車: [
    { key: "trainName", label: "列車名", placeholder: "のぞみ 225号" },
    { key: "fromStation", label: "乗車駅", placeholder: "東京" },
    { key: "departureTime", label: "発車時刻", placeholder: "10:00" },
    { key: "toStation", label: "降車駅", placeholder: "新大阪" },
    { key: "arrivalTime", label: "到着時刻", placeholder: "12:30" },
    { key: "car", label: "号車", placeholder: "7号車" },
    { key: "seat", label: "座席", placeholder: "A席" },
    { key: "confNumber", label: "確認番号", placeholder: "TK-882541" },
  ],
  宿泊: [
    { key: "hotelName", label: "施設名", placeholder: "ホテル大阪ベイ" },
    { key: "checkin", label: "チェックイン", placeholder: "18:00" },
    { key: "checkout", label: "チェックアウト", placeholder: "11:00" },
    { key: "roomType", label: "部屋タイプ", placeholder: "シングル 禁煙" },
    { key: "confNumber", label: "確認番号", placeholder: "H-283901" },
  ],
  アポ: [
    { key: "title", label: "タイトル", placeholder: "ABC社 打合せ" },
    { key: "location", label: "場所", placeholder: "グランフロント大阪" },
    { key: "startTime", label: "開始時刻", placeholder: "14:00" },
    { key: "endTime", label: "終了時刻", placeholder: "15:00" },
    { key: "confNumber", label: "確認番号", placeholder: "" },
  ],
  食事: [
    { key: "shopName", label: "店名", placeholder: "レストラン◯◯" },
    { key: "time", label: "予約時刻", placeholder: "19:00" },
    { key: "guests", label: "人数", placeholder: "2名" },
    { key: "confNumber", label: "確認番号", placeholder: "" },
  ],
  バス: [
    { key: "routeName", label: "路線名", placeholder: "◯◯バス" },
    { key: "departureTime", label: "発車時刻", placeholder: "10:00" },
    { key: "arrivalTime", label: "到着時刻", placeholder: "12:00" },
    { key: "confNumber", label: "確認番号", placeholder: "" },
  ],
  車: [
    { key: "company", label: "レンタカー会社・車種", placeholder: "トヨタレンタカー" },
    { key: "from", label: "出発地", placeholder: "関西空港店" },
    { key: "to", label: "到着地", placeholder: "京都駅前店" },
    { key: "time", label: "出発時刻", placeholder: "9:00" },
    { key: "confNumber", label: "予約番号", placeholder: "" },
  ],
  船: [
    { key: "routeName", label: "航路・便名", placeholder: "さんふらわあ" },
    { key: "from", label: "出発港", placeholder: "大阪南港" },
    { key: "to", label: "到着港", placeholder: "別府港" },
    { key: "time", label: "出発時刻", placeholder: "19:00" },
    { key: "confNumber", label: "予約番号", placeholder: "" },
  ],
  観光: [
    { key: "eventName", label: "イベント名", placeholder: "◯◯コンサート" },
    { key: "venue", label: "会場", placeholder: "東京ドーム" },
    { key: "date", label: "日付", placeholder: "4月15日" },
    { key: "time", label: "開演時刻", placeholder: "18:00" },
    { key: "seat", label: "座席", placeholder: "A列 12番" },
    { key: "confNumber", label: "確認番号", placeholder: "" },
  ],
  その他: [
    { key: "title", label: "タイトル", placeholder: "内容" },
    { key: "time", label: "時刻", placeholder: "10:00" },
    { key: "detail", label: "詳細", placeholder: "" },
    { key: "confNumber", label: "確認番号", placeholder: "" },
  ],
};

/* ====== OCRテキストからフィールド値を自動抽出 ====== */

function extractFields(text: string, category: StepCategory): Record<string, string> {
  const values: Record<string, string> = {};
  const allText = text.replace(/\n/g, " ");

  const times = allText.match(/(\d{1,2}:\d{2})/g) || [];
  const confMatch = allText.match(/([A-Z]{1,6}[-]?\d{3,})/i);

  switch (category) {
    case "飛行機": {
      const flight = allText.match(/(NH|JL|ANA|JAL|UA|DL|AA|SQ|CX|MM|GK|BC|SKY)[\s-]?(\d{1,4})/i);
      if (flight) values.flightNo = `${flight[1].toUpperCase()} ${flight[2]}`;
      const airports = allText.match(/\b([A-Z]{3})\b/g);
      if (airports?.[0]) values.departure = airports[0];
      if (airports?.[1]) values.arrival = airports[1];
      if (times[0]) values.departureTime = times[0];
      if (times[1]) values.arrivalTime = times[1];
      const gate = allText.match(/gate[\s:]*([A-Z]?\d{1,3})/i);
      if (gate) values.gate = gate[1];
      const seat = allText.match(/(\d{1,3}[A-K])\b/);
      if (seat) values.seat = seat[1];
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "列車": {
      const train = allText.match(/(のぞみ|ひかり|こだま|みずほ|さくら|はやぶさ|かがやき|つばさ|やまびこ|とき|あさま)\s*(\d{1,4})\s*号?/);
      if (train) values.trainName = `${train[1]} ${train[2]}号`;
      const stations = allText.match(/(東京|品川|新横浜|名古屋|京都|新大阪|博多|広島|仙台|金沢|新潟|大宮|上野|岡山|新神戸)/g);
      if (stations?.[0]) values.fromStation = stations[0];
      if (stations?.[1]) values.toStation = stations[1];
      if (times[0]) values.departureTime = times[0];
      if (times[1]) values.arrivalTime = times[1];
      const car = allText.match(/(\d{1,2})\s*号車/);
      if (car) values.car = `${car[1]}号車`;
      const seat = allText.match(/(\d{1,2})\s*番?\s*([A-E])\s*席?/);
      if (seat) values.seat = `${seat[1]}番${seat[2]}席`;
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "宿泊": {
      const hotel = allText.match(/(ホテル[^\s,、。]{2,15}|[^\s,、。]{2,10}(ホテル|inn|hotel|旅館))/i);
      if (hotel) values.hotelName = hotel[0];
      const ci = allText.match(/(?:check.?in|チェックイン)[:\s]*(\d{1,2}:\d{2})/i);
      if (ci) values.checkin = ci[1];
      const co = allText.match(/(?:check.?out|チェックアウト)[:\s]*(\d{1,2}:\d{2})/i);
      if (co) values.checkout = co[1];
      const room = allText.match(/(シングル|ダブル|ツイン|スイート|デラックス|禁煙|喫煙)/);
      if (room) values.roomType = room[0];
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "アポ": {
      // 会議・商談。会社名をタイトル、場所を場所に。※医療は対象外。
      const name = allText.match(/([^\s]{2,10}(株式会社|（株）|社))/);
      if (name) values.title = name[0];
      const loc = allText.match(/([\u4e00-\u9faf]{2,6}(ビル|センター|ホール|会議室))/);
      if (loc) values.location = loc[0];
      if (times[0]) values.startTime = times[0];
      if (times[1]) values.endTime = times[1];
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "船": {
      const sh = allText.match(/([^\s]{2,12}(フェリー|汽船))/i);
      if (sh) values.routeName = sh[0];
      if (times[0]) values.time = times[0];
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "車": {
      const co = allText.match(/([^\s]{2,12}(レンタカー))/i);
      if (co) values.company = co[0];
      if (times[0]) values.time = times[0];
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "食事": {
      const shop = allText.match(/(レストラン[^\s,]{2,10}|[^\s,]{2,10}(レストラン|食堂|カフェ|ダイニング))/i);
      if (shop) values.shopName = shop[0];
      if (times[0]) values.time = times[0];
      const guests = allText.match(/(\d{1,2})\s*名/);
      if (guests) values.guests = `${guests[1]}名`;
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "バス": {
      const bus = allText.match(/([\u4e00-\u9faf]{2,8}(バス|交通|ライナー))/);
      if (bus) values.routeName = bus[0];
      if (times[0]) values.departureTime = times[0];
      if (times[1]) values.arrivalTime = times[1];
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
    case "観光": {
      const venue = allText.match(/([\u4e00-\u9faf]{2,10}(ホール|アリーナ|スタジアム|ドーム|劇場|シアター|会場))/);
      if (venue) values.venue = venue[0];
      const dateM = allText.match(/(\d{1,2}月\d{1,2}日)/);
      if (dateM) values.date = dateM[1];
      if (times[0]) values.time = times[0];
      const seat = allText.match(/([A-Z]?\d{1,3}\s*列\s*\d{1,3}\s*番|\d{1,3}\s*番)/);
      if (seat) values.seat = seat[0];
      if (confMatch) values.confNumber = confMatch[1];
      // タイトルは最初の日本語テキスト
      const ev = allText.match(/([\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]{3,20})/);
      if (ev) values.eventName = ev[0];
      break;
    }
    default: {
      const lines = text.split("\n").filter(Boolean);
      if (lines[0]) values.title = lines[0].substring(0, 30);
      if (times[0]) values.time = times[0];
      if (lines.length > 1) values.detail = lines.slice(1).join(" ").substring(0, 60);
      if (confMatch) values.confNumber = confMatch[1];
      break;
    }
  }

  return values;
}

/* ====== フォーム値 → Step変換 ====== */

function formToStep(category: StepCategory, values: Record<string, string>): { title: string; time: string; detail: string; confNumber: string } {
  switch (category) {
    case "飛行機":
      return {
        title: values.flightNo || "フライト",
        time: values.departureTime || "",
        detail: [values.departure, values.arrival].filter(Boolean).join(" → "),
        confNumber: values.confNumber || "",
      };
    case "列車":
      return {
        title: values.trainName || "列車",
        time: values.departureTime || "",
        detail: [values.fromStation, values.toStation].filter(Boolean).join(" → "),
        confNumber: values.confNumber || "",
      };
    case "宿泊":
      return {
        title: values.hotelName || "宿泊",
        time: values.checkin ? `Check-in ${values.checkin}` : "",
        detail: values.roomType || "",
        confNumber: values.confNumber || "",
      };
    case "アポ":
      return {
        title: values.title || "予約",
        time: [values.startTime, values.endTime].filter(Boolean).join(" - "),
        detail: values.location || "",
        confNumber: values.confNumber || "",
      };
    case "車":
    case "船":
      return {
        title: values.company || values.routeName || "移動",
        time: values.time || "",
        detail: [values.from, values.to].filter(Boolean).join(" → "),
        confNumber: values.confNumber || "",
      };
    case "徒歩":
      return {
        title: values.title || "徒歩",
        time: values.time || "",
        detail: [values.from, values.to].filter(Boolean).join(" → "),
        confNumber: "",
      };
    case "食事":
      return {
        title: values.shopName || "食事",
        time: values.time || "",
        detail: values.guests || "",
        confNumber: values.confNumber || "",
      };
    case "バス":
      return {
        title: values.routeName || "バス",
        time: values.departureTime || "",
        detail: "",
        confNumber: values.confNumber || "",
      };
    case "観光":
      return {
        title: values.eventName || "チケット",
        time: values.time || "",
        detail: values.venue || "",
        confNumber: values.confNumber || "",
      };
    default:
      return {
        title: values.title || "スキャンデータ",
        time: values.time || "",
        detail: values.detail || "",
        confNumber: values.confNumber || "",
      };
  }
}

/* ====== 固定フィールド定義（AI OCR用） ====== */

/* ====== コンポーネント ====== */

type ScanStatus = "idle" | "processing" | "done" | "error";

export function ScanFlow({ chrome = "standalone", target, onComplete }: ScanFlowProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Target resolution:
  //   embedded → props.target がそのまま使われる
  //   standalone → props.target か URL ?target= のどちらか
  const targetJourneyId = target?.id ?? searchParams.get("target") ?? null;
  const [targetJourney, setTargetJourney] = useState<{
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    stepCount: number;
  } | null>(null);
  useEffect(() => {
    if (!targetJourneyId) { setTargetJourney(null); return; }
    let cancelled = false;
    getJourney(targetJourneyId).then((j) => {
      if (!cancelled && j) {
        setTargetJourney({
          id: j.id,
          title: j.title,
          startDate: j.startDate,
          endDate: j.endDate,
          stepCount: j.steps.length,
        });
      }
    });
    return () => { cancelled = true; };
  }, [targetJourneyId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [detectedCategory, setDetectedCategory] = useState<StepCategory>("その他");
  // 往復など複数ステップOCR時に、レビュー画面で表示中のステップ番号。
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [ocrText, setOcrText] = useState("");
  const [progress, setProgress] = useState(0);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [addToExisting, setAddToExisting] = useState(true);
  const [showTextInput, setShowTextInput] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [inputSource, setInputSource] = useState<"撮影" | "アップロード" | "メール">("撮影");
  const [aiMode, setAiMode] = useState(true);
  const [fixedValues, setFixedValues] = useState<Record<string, string>>({});
  const [variableFields, setVariableFields] = useState<{ label: string; value: string }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [aiSteps, setAiSteps] = useState<any[]>([]);
  const [inferredFields, setInferredFields] = useState<string[]>([]);
  const [needsReview, setNeedsReview] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [errorDetail, setErrorDetail] = useState("");

  // Flow A: OCR 完了後に「新規 / 既存 / 未整理」を選ばせるために保留する
  // stepsToRegister。target 指定が無い通常導線でのみ使用する。
  const [pendingCommit, setPendingCommit] = useState<{
    stepsToRegister: Step[];
    now: string;
    todayStr: string;
  } | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // プレビュー用 object URL を追跡し reset/アンマウントでまとめて revoke（リーク防止）。
  const objectUrlsRef = useRef<string[]>([]);
  // 要配慮個人情報を含みうる書類のスキャン前同意（初回のみ・localStorage記録）。
  const [showScanConsent, setShowScanConsent] = useState(false);
  const pendingFileRef = useRef<File | null>(null);
  const releaseObjectUrls = () => {
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    objectUrlsRef.current = [];
  };
  useEffect(() => {
    return () => {
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    };
  }, []);

  const pdfToImages = async (file: File): Promise<Blob[]> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: "/cmaps/",
      cMapPacked: true,
    }).promise;
    const blobs: Blob[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const scale = 2;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85)
      );
      blobs.push(blob);
    }
    return blobs;
  };

  const resizeImage = async (file: File | Blob, maxDim = 1600, quality = 0.8): Promise<Blob> => {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
        image.src = objectUrl;
      });
      const longest = Math.max(img.width, img.height);
      const scale = longest > maxDim ? maxDim / longest : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("圧縮に失敗しました"))),
          "image/jpeg",
          quality
        );
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const handleFile = async (file: File) => {
    setStatus("processing");
    setProgress(0);
    setCurrentPage(0);
    releaseObjectUrls();

    try {
      let ocrTargets: (File | Blob)[] = [];

      if (file.type === "application/pdf") {
        const imageBlobs = await pdfToImages(file);
        const urls = imageBlobs.map((b) => URL.createObjectURL(b));
        objectUrlsRef.current.push(...urls);
        setPageUrls(urls);
        setImageUrl(urls[0]);
        ocrTargets = imageBlobs;
      } else {
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.push(url);
        setImageUrl(url);
        setPageUrls([url]);
        ocrTargets = [file];
      }

      const Tesseract = await import("tesseract.js");
      const allTexts: string[] = [];

      for (let i = 0; i < ocrTargets.length; i++) {
        const result = await Tesseract.recognize(ocrTargets[i], "jpn+eng", {
          logger: (m) => {
            if (m.status === "recognizing text" && typeof m.progress === "number") {
              const pageProgress = (i + m.progress) / ocrTargets.length;
              setProgress(Math.round(pageProgress * 100));
            }
          },
        });
        allTexts.push(result.data.text);
      }

      const text = allTexts.join("\n");
      setOcrText(text);
      const cat = detectCategory(text);
      setDetectedCategory(cat);
      setFormValues(extractFields(text, cat));
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const handleFileAI = async (file: File) => {
    setStatus("processing");
    setProgress(0);
    setCurrentPage(0);
    setErrorDetail("");
    releaseObjectUrls();

    try {
      // 画像化（PDFはページ毎にJPEG化、画像はリサイズ＋JPEG圧縮）
      let imageBlobs: Blob[];
      if (file.type === "application/pdf") {
        imageBlobs = await pdfToImages(file);
        const urls = imageBlobs.map((b) => URL.createObjectURL(b));
        objectUrlsRef.current.push(...urls);
        setPageUrls(urls);
        setImageUrl(urls[0]);
      } else {
        const resized = await resizeImage(file);
        const url = URL.createObjectURL(resized);
        objectUrlsRef.current.push(url);
        setImageUrl(url);
        setPageUrls([url]);
        imageBlobs = [resized];
      }

      setProgress(30);

      const totalBytes = imageBlobs.reduce((sum, b) => sum + b.size, 0);
      console.log(`[OCR] ${imageBlobs.length} image(s), total ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);

      // base64変換
      const base64Images: string[] = [];
      for (const blob of imageBlobs) {
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        base64Images.push(b64);
      }

      setProgress(50);

      // Claude API呼び出し
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: base64Images }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.error("[OCR] API error:", res.status, errBody);
        const hint = res.status === 413
          ? "画像サイズが大きすぎます。別の画像をお試しください。"
          : res.status >= 500
            ? "サーバーエラーが発生しました。"
            : "";
        throw new Error(`${hint} (HTTP ${res.status}) ${errBody.slice(0, 200)}`);
      }

      const result = await res.json();
      console.log("[OCR] API result:", JSON.stringify(result, null, 2));
      setProgress(90);

      // steps配列から処理（往復など複数Stepはレビュー画面のページャで切替）
      const allSteps = result.steps || [result];
      setAiSteps(allSteps);
      setCurrentStepIdx(0);

      // 最初のStepを表示
      applyAiStep(allSteps[0]);
      setOcrText(`[AI OCR] ${JSON.stringify(result, null, 2)}`);
      setProgress(100);
      setStatus("done");
    } catch (err) {
      console.error("[OCR] Error:", err);
      setErrorDetail(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  // スキャン前同意ゲート。未同意なら同意モーダルを表示してファイルを保留し、
  // 同意後に処理する。要配慮個人情報の取得同意＋海外(米国)AI送信の開示（撮影・
  // ファイル選択・ドラッグ&ドロップの全経路をここで一元的にガードする）。
  const SCAN_CONSENT_KEY = "scan_sensitive_consent_v1";
  const processScanFile = (file: File) => {
    if (aiMode) handleFileAI(file);
    else handleFile(file);
  };
  const startScan = (file: File) => {
    const consented =
      typeof window !== "undefined" &&
      window.localStorage.getItem(SCAN_CONSENT_KEY) === "1";
    if (!consented) {
      pendingFileRef.current = file;
      setShowScanConsent(true);
      return;
    }
    processScanFile(file);
  };
  const confirmScanConsent = () => {
    try {
      window.localStorage.setItem(SCAN_CONSENT_KEY, "1");
    } catch {}
    setShowScanConsent(false);
    const file = pendingFileRef.current;
    pendingFileRef.current = null;
    if (file) processScanFile(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) startScan(file);
    e.target.value = "";
  };

  const updateField = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyAiStep = (stepData: any) => {
    const cat = (stepData.category || "その他") as StepCategory;
    setDetectedCategory(cat);

    const fixed: Record<string, string> = {};
    if (stepData.fixed) {
      for (const [k, v] of Object.entries(stepData.fixed)) {
        if (v != null) fixed[k] = String(v);
      }
    }
    setFixedValues(fixed);

    const vars: { label: string; value: string }[] = [];
    if (Array.isArray(stepData.variable)) {
      for (const item of stepData.variable) {
        if (item?.label && item?.value) {
          vars.push({ label: String(item.label), value: String(item.value) });
        }
      }
    }
    setVariableFields(vars);
    setFormValues({ ...fixed });
    setInferredFields(Array.isArray(stepData.inferred) ? stepData.inferred : []);
    setNeedsReview(!!stepData.needsReview);
  };

  // 表示中ステップの編集内容(fixedValues/variableFields等)を aiSteps に書き戻した
  // 配列を返す。ステップ切替・登録の直前に呼び、編集の取りこぼしを防ぐ。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flushStepsWithCurrentEdits = (): any[] => {
    if (aiSteps.length === 0) return aiSteps;
    const next = [...aiSteps];
    next[currentStepIdx] = {
      category: detectedCategory,
      fixed: { ...fixedValues },
      variable: variableFields.map((v) => ({ label: v.label, value: v.value })),
      inferred: inferredFields,
      needsReview,
    };
    return next;
  };

  // レビュー画面のページャでステップを切り替える。現在の編集を保持してから移動。
  const goToStep = (idx: number) => {
    if (idx < 0 || idx >= aiSteps.length || idx === currentStepIdx) return;
    const flushed = flushStepsWithCurrentEdits();
    setAiSteps(flushed);
    setCurrentStepIdx(idx);
    applyAiStep(flushed[idx]);
  };

  const handleTextSubmit = () => {
    if (!pasteText.trim()) return;
    setInputSource("メール");
    setStatus("processing");
    setProgress(0);
    setImageUrl(null);
    // テキストは直接解析（OCR不要）
    setTimeout(() => {
      const text = pasteText.trim();
      setOcrText(text);
      const cat = detectCategory(text);
      setDetectedCategory(cat);
      setFormValues(extractFields(text, cat));
      setProgress(100);
      setStatus("done");
    }, 300);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    setInputSource("アップロード");
    const file = e.dataTransfer.files?.[0];
    if (file) startScan(file);
  };

  const changeCategory = (cat: StepCategory) => {
    setDetectedCategory(cat);
    // AIモードは fixedValues を使う。ocrText は AI の JSON 文字列なので
    // 正規表現抽出しても無意味（誤値の元）。手入力/OCRテキスト時のみ抽出する。
    if (!aiMode) setFormValues(extractFields(ocrText, cat));
    setShowCategoryPicker(false);
  };


  const blobToBase64 = async (blobUrl: string): Promise<string> => {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  };

  const createStep = async () => {
    if (registering) return;
    setRegistering(true);
    try {
    let savedImageUrl: string | undefined;
    let savedImageUrls: string[] | undefined;
    if (imageUrl) {
      try {
        savedImageUrl = await blobToBase64(imageUrl);
      } catch (e) {
        console.error("[scan] blobToBase64(imageUrl) failed:", e);
      }
    }
    if (pageUrls.length > 1) {
      try {
        const urls: string[] = [];
        for (const u of pageUrls) {
          urls.push(await blobToBase64(u));
        }
        savedImageUrls = urls;
      } catch (e) {
        console.error("[scan] blobToBase64(pageUrls) failed:", e);
      }
    }

    const now = new Date().toISOString();
    const todayStr = new Date().toISOString().split("T")[0];

    let title: string, time: string, stepDate: string | undefined;
    let endTime: string | undefined, from: string | undefined, to: string | undefined;
    let confNumber: string | undefined, detail: string | undefined;

    // 登録するStep群を構築
    const stepsToRegister: Step[] = [];

    // AI往復対応: aiStepsが複数ある場合は全て登録
    if (aiMode && aiSteps.length > 1) {
      // 表示中ステップの編集を aiSteps に反映してから全ステップを登録する。
      const flushed = flushStepsWithCurrentEdits();
      for (let si = 0; si < flushed.length; si++) {
        const s = flushed[si];
        const f = s.fixed || {};
        stepsToRegister.push({
          id: generateId(),
          category: (s.category || "その他") as StepCategory,
          title: f.title || getCategoryDef(s.category || "その他").label,
          date: f.date || undefined,
          endDate: f.endDate || undefined,
          time: f.startTime || "",
          endTime: f.endTime || undefined,
          from: f.from || undefined,
          to: f.to || undefined,
          airline: f.airline || undefined,
          confNumber: f.confNumber || undefined,
          timezone: f.timezone || undefined,
          source: inputSource,
          sourceImageUrl: savedImageUrl, sourceImageUrls: savedImageUrls,
          status: "未開始",
          inferred: Array.isArray(s.inferred) ? s.inferred : undefined,
          needsReview: s.needsReview || undefined,
          information: (s.variable || [])
            .filter((v: { label?: string; value?: string }) => v?.label && v?.value)
            .map((v: { label: string; value: string }, i: number) => ({ id: `var-${si}-${i}`, label: v.label, value: v.value })),
        });
      }
    } else if (aiMode && Object.keys(fixedValues).length > 0) {
      title = fixedValues.title || getCategoryDef(detectedCategory).label;
      stepDate = fixedValues.date || undefined;
      time = fixedValues.startTime || "";
      endTime = fixedValues.endTime || undefined;
      from = fixedValues.from || undefined;
      to = fixedValues.to || undefined;
      confNumber = fixedValues.confNumber || undefined;
      stepsToRegister.push({
        id: generateId(),
        category: detectedCategory,
        title, date: stepDate, endDate: fixedValues.endDate || undefined,
        time, endTime, from, to, confNumber,
        airline: fixedValues.airline || undefined,
        timezone: fixedValues.timezone || undefined,
        source: inputSource, sourceImageUrl: savedImageUrl, sourceImageUrls: savedImageUrls,
        status: "未開始",
        inferred: inferredFields.length > 0 ? inferredFields : undefined,
        needsReview: needsReview || undefined,
        information: variableFields.map((v, i) => ({ id: `var-${i}`, label: v.label, value: v.value })),
      });
    } else {
      const stepData = formToStep(detectedCategory, formValues);
      title = stepData.title;
      time = stepData.time;
      detail = stepData.detail || undefined;
      confNumber = stepData.confNumber || undefined;
      stepsToRegister.push({
        id: generateId(),
        category: detectedCategory,
        title, time, detail, confNumber,
        source: inputSource, sourceImageUrl: savedImageUrl, sourceImageUrls: savedImageUrls,
        status: "未開始", information: [],
      });
    }

    // Flow A: target 指定無し (通常導線) のときは、自動で Journey を作らず
    // 「新規 / 既存 / 未整理」を Selector で選ばせる。target 指定あり
    // (AddStepDrawer / ?target=) はこれまで通り直行する。
    if (!targetJourneyId && stepsToRegister.length > 0) {
      setPendingCommit({ stepsToRegister, now, todayStr });
      setSelectorOpen(true);
      // registering は true のまま — Selector が閉じる/確定するまで UI ロック。
      return;
    }

    await finishRegister(stepsToRegister, now, todayStr);
  } catch (err) {
    console.error("[scan] register failed:", err);
    const msg = err instanceof Error ? err.message : "予定の登録に失敗しました";
    notifications.show({
      message: msg,
      color: "red",
      icon: <IconAlertCircle size={18} />,
      autoClose: 4000,
      withBorder: false,
      style: { background: "var(--danger-500)", color: "white" },
      styles: { icon: { color: "white", background: "transparent" } },
    });
    setRegistering(false);
  }
};

  /**
   * §16 マージ後 / 通常パスで Step 群を保存して画面遷移するヘルパ。
   * 元の createStep から切り出した（マージダイアログからも呼び出すため）。
   */
  const finishRegister = async (stepsToRegister: Step[], now: string, todayStr: string) => {
    let journeyId: string;
    const firstDate = stepsToRegister[0]?.date;
    const lastDate = stepsToRegister[stepsToRegister.length - 1]?.endDate
      || stepsToRegister[stepsToRegister.length - 1]?.date;

    // 1) target 指定あり: /trips/[id] から「+予定を追加」で来たケース。
    //    同日判定をスキップして、必ず指定 Journey に append する。
    if (targetJourneyId) {
      const target = await getJourney(targetJourneyId);
      if (!target) throw new Error("指定の Journey が見つかりません");
      await updateJourney(target.id, {
        steps: [...target.steps, ...stepsToRegister],
      });
      journeyId = target.id;
    } else {
    // 2) 通常導線: 同日 Journey に追加 or 新規作成
    const allJourneys = await getJourneys();
    const sameDayTarget = allJourneys.find((j) => j.startDate <= todayStr && j.endDate >= todayStr);

    if (addToExisting && sameDayTarget) {
      await updateJourney(sameDayTarget.id, {
        steps: [...sameDayTarget.steps, ...stepsToRegister],
      });
      journeyId = sameDayTarget.id;
    } else {
      journeyId = generateId();
      const cd = getCategoryDef(stepsToRegister[0]?.category || detectedCategory);
      const journeyStartDate = firstDate || todayStr;
      const journeyEndDate = lastDate || journeyStartDate;
      await addJourney({
        id: journeyId,
        title: `${cd.label} ${new Date(journeyStartDate).toLocaleDateString("ja-JP")}`,
        startDate: journeyStartDate,
        endDate: journeyEndDate,
        steps: stepsToRegister,
        createdAt: now,
        updatedAt: now,
      });
    }
    } // close else (target 無し分岐)

    sessionStorage.setItem("toritavi_toast", "journey_created");
    if (onComplete) {
      onComplete(journeyId);
    } else {
      router.push(`/trips/${journeyId}`);
    }
  };

  /* ===================================================================
   * Flow A bucket handlers
   * =================================================================== */

  /** Selector を閉じる共通処理。state を完全にリセット。 */
  const closeSelector = () => {
    setSelectorOpen(false);
    setPendingCommit(null);
    setRegistering(false);
  };

  /** DestinationSelector から「3 択のどれか」を受け取った時のハンドラ。 */
  const handleSelectorChoose = async (mode: "new" | "existing" | "unfiled") => {
    if (!pendingCommit) {
      closeSelector();
      return;
    }
    if (mode === "new") {
      // OCR 結果を sessionStorage に載せて /trips/new へ。/trips/new 側で
      // タイトル chip と期間プリセットを復元する。
      try {
        sessionStorage.setItem(
          "toritavi_scan_seed",
          JSON.stringify({ steps: pendingCommit.stepsToRegister, at: Date.now() })
        );
      } catch (e) {
        console.warn("[scan] seed stash failed", e);
      }
      setSelectorOpen(false);
      router.push("/trips/new?from=scan");
      return;
    }
    if (mode === "existing") {
      setSelectorOpen(false);
      setPickerOpen(true);
      return;
    }
    if (mode === "unfiled") {
      try {
        await addUnfiledSteps(pendingCommit.stepsToRegister);
      } catch (err) {
        console.error("[scan] unfiled save failed", err);
        notifications.show({
          message: "未整理への保存に失敗しました",
          color: "red",
          icon: <IconAlertCircle size={18} />,
          autoClose: 4000,
        });
        setRegistering(false);
        return;
      }
      setSelectorOpen(false);
      setPendingCommit(null);
      setRegistering(false);
      notifications.show({
        message: "未整理に保存しました",
        icon: <IconCheck size={18} />,
        autoClose: 4000,
        withBorder: false,
        style: { background: "var(--success-500)", color: "white" },
        styles: { icon: { color: "white", background: "transparent" } },
      });
      if (onComplete) onComplete("");
      else router.push("/unfiled");
    }
  };

  /** JourneyPicker で既存旅程を選んだ時。選ばれた journey に append する。 */
  const handlePickerPick = async (journeyId: string) => {
    if (!pendingCommit) {
      setPickerOpen(false);
      setRegistering(false);
      return;
    }
    try {
      const target = await getJourney(journeyId);
      if (!target) throw new Error("指定の Journey が見つかりません");
      await updateJourney(target.id, {
        steps: [...target.steps, ...pendingCommit.stepsToRegister],
      });
      sessionStorage.setItem("toritavi_toast", "journey_created");
      setPickerOpen(false);
      setPendingCommit(null);
      setRegistering(false);
      if (onComplete) onComplete(target.id);
      else router.push(`/trips/${target.id}`);
    } catch (err) {
      console.error("[scan] append to existing failed", err);
      notifications.show({
        message: err instanceof Error ? err.message : "追加に失敗しました",
        color: "red",
        icon: <IconAlertCircle size={18} />,
        autoClose: 4000,
      });
      setPickerOpen(false);
      setRegistering(false);
    }
  };

  const reset = () => {
    releaseObjectUrls();
    setImageUrl(null);
    setPageUrls([]);
    setCurrentPage(0);
    setStatus("idle");
    setOcrText("");
    setFormValues({});
    setProgress(0);
    setShowCategoryPicker(false);
    setShowTextInput(false);
    setPasteText("");
    setFixedValues({});
    setVariableFields([]);
    setAiSteps([]);
    setCurrentStepIdx(0);
    setInferredFields([]);
    setNeedsReview(false);
    setErrorDetail("");
  };

  const catDef = getCategoryDef(detectedCategory);
  const fields = categoryFields[detectedCategory] || categoryFields["その他"];

  const today = new Date().toISOString().split("T")[0];

  const isEmbedded = chrome === "embedded";

  return (
    <>
      {!isEmbedded && (
        <AppHeader
          title={targetJourney ? "旅程に予定を追加" : "予定登録"}
          back={Boolean(targetJourneyId)}
          backHref={targetJourneyId ? `/trips/${targetJourneyId}` : undefined}
        />
      )}

      <Box pb={isEmbedded ? 28 : 110} px="md" pt="md">
        {/* 追加先 Journey コンテキストカード
            embedded（Bottom Sheet）時は SheetHeader タイトルで既に Journey 名が
            明示されているので表示しない。standalone（/scan?target=id の古い
            導線）だけの保険。 */}
        {targetJourney && !isEmbedded && (
          <Box className={classes.addTargetCard}>
            <Box className={classes.addTargetLabel}>追加先の旅程</Box>
            <Box className={classes.addTargetTitle}>{targetJourney.title}</Box>
            <Box className={classes.addTargetMeta}>
              {targetJourney.startDate}
              {targetJourney.startDate !== targetJourney.endDate && ` 〜 ${targetJourney.endDate}`}
              <span className={classes.addTargetDot}>·</span>
              現在 {targetJourney.stepCount} ステップ
            </Box>
          </Box>
        )}

        {/* テストモード切替 (通常導線のみ) */}
        {status === "idle" && !targetJourney && (
          <Box
            className={`${classes.testModeBanner} ${!aiMode ? classes.testModeActive : ""}`}
            onClick={() => setAiMode((v) => !v)}
          >
            <IconFlask size={16} />
            <Text size="xs" fw={600}>
              {aiMode ? "テストモード：ブラウザOCRに切替" : "テストモード ON（ブラウザOCR）"}
            </Text>
          </Box>
        )}

        {/* 初期画面 */}
        {status === "idle" && (
          <>
            {!targetJourney && (
              <Box className={classes.captureArea}>
                <Box className={classes.iconWrap}>
                  <IconScan size={48} stroke={1.5} />
                </Box>
                <Text fw={700} size="lg" mt="md">
                  予定の自動登録
                </Text>
                <Text size="sm" c="dimmed" ta="center" mt={4} lh={1.6}>
                  種類を自動判定し、情報を読み取ります
                </Text>
              </Box>
            )}
            {targetJourney && (
              <Box className={classes.addInputHeading}>
                取り込み方法を選ぶ
              </Box>
            )}

            {/* 入力方法グリッド */}
            <Box className={classes.inputGrid}>
              <button
                className={classes.inputCard}
                onClick={() => { setInputSource("撮影"); cameraInputRef.current?.click(); }}
              >
                <IconCamera size={28} stroke={1.5} />
                <Text size="sm" fw={600}>撮影する</Text>
              </button>
              <button
                className={classes.inputCard}
                onClick={() => { setInputSource("アップロード"); fileInputRef.current?.click(); }}
              >
                <IconUpload size={28} stroke={1.5} />
                <Text size="sm" fw={600}>ファイル・画像</Text>
              </button>
              <button
                className={classes.inputCard}
                onClick={() => setShowTextInput(true)}
              >
                <IconClipboardText size={28} stroke={1.5} />
                <Text size="sm" fw={600}>テキスト入力</Text>
              </button>
            </Box>

            {/* ドラッグ&ドロップエリア */}
            <Box
              className={`${classes.dropZone} ${dragging ? classes.dropZoneActive : ""}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <IconDragDrop size={24} stroke={1.5} color="var(--text-dim)" />
              <Text size="xs" c="dimmed">ここにファイルをドロップ</Text>
            </Box>

            {/* テキスト入力エリア */}
            {showTextInput && (
              <Box className={classes.textInputArea}>
                <Textarea
                  placeholder="メールや予約確認の文面を貼り付け..."
                  autosize
                  minRows={4}
                  maxRows={10}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.currentTarget.value)}
                />
                <Box className={classes.buttons} style={{ marginTop: 12 }}>
                  <button
                    className={classes.captureButton}
                    onClick={handleTextSubmit}
                    disabled={!pasteText.trim()}
                  >
                    <IconScan size={18} />
                    読み取る
                  </button>
                  <button
                    className={classes.uploadButton}
                    onClick={() => { setShowTextInput(false); setPasteText(""); }}
                  >
                    キャンセル
                  </button>
                </Box>
              </Box>
            )}

            <Text size="xs" c="dimmed" ta="center" mt="md">
              対応: フライト・鉄道・ホテル・チケット・予約 他
            </Text>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={onFileChange}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: "none" }}
              onChange={onFileChange}
            />

            <Modal
              opened={showScanConsent}
              onClose={() => setShowScanConsent(false)}
              title="スキャン前のご確認"
              centered
            >
              <Text size="sm" style={{ lineHeight: 1.7 }}>
                スキャンする書類（搭乗券・予約票など）には、氏名・連絡先などの個人情報が含まれることがあります。
                <br />
                <br />
                読み取りのため、画像と抽出した文字は、海外（米国）のAI事業者（Anthropic）へ送信して処理されます。
                <br />
                <br />
                内容を理解し、これに同意したうえでスキャンを行ってください。
              </Text>
              <Anchor
                href="https://coyoteandpowell.com/curlew/privacy/"
                target="_blank"
                rel="noreferrer"
                size="sm"
                mt="xs"
                style={{ display: "inline-block" }}
              >
                プライバシーポリシー（詳細）を読む
              </Anchor>
              <Group justify="flex-end" mt="lg">
                <Button variant="default" onClick={() => setShowScanConsent(false)}>
                  キャンセル
                </Button>
                <Button onClick={confirmScanConsent}>同意して続ける</Button>
              </Group>
            </Modal>
          </>
        )}

        {/* OCR処理中 */}
        {status === "processing" && (
          <Box className={classes.processingArea}>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="スキャン中" className={classes.preview} />
            )}
            <Box className={classes.processingOverlay}>
              <Loader size="md" color="white" />
              <Text size="sm" fw={600} c="white" mt="sm">
                {aiMode ? "AI解析中" : "読み取り中"}... {progress}%
              </Text>
              <Box className={classes.progressBar}>
                <Box
                  className={classes.progressFill}
                  style={{ width: `${progress}%` }}
                />
              </Box>
            </Box>
          </Box>
        )}

        {/* 結果: カテゴリ別専用フォーム */}
        {status === "done" && (
          <>
            {/* スキャン元プレビュー */}
            {pageUrls.length > 0 && (
              <Box className={classes.previewCard}>
                <Box className={classes.previewSlider}>
                  {pageUrls.length > 1 && (
                    <button
                      className={classes.previewArrow}
                      onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                    >
                      <IconChevronLeft size={20} />
                    </button>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pageUrls[currentPage]}
                    alt={`ページ ${currentPage + 1}`}
                    className={classes.previewThumb}
                  />
                  {pageUrls.length > 1 && (
                    <button
                      className={classes.previewArrow}
                      onClick={() => setCurrentPage((p) => Math.min(pageUrls.length - 1, p + 1))}
                      disabled={currentPage === pageUrls.length - 1}
                    >
                      <IconChevronRight size={20} />
                    </button>
                  )}
                </Box>
                {pageUrls.length > 1 && (
                  <Text size="xs" c="dimmed" ta="center" mt={6}>
                    {currentPage + 1} / {pageUrls.length} ページ
                  </Text>
                )}
              </Box>
            )}

            {/* カテゴリ表示（タップで変更可能） */}
            <Box className={classes.categoryHeader}>
              <Box
                className={classes.categoryBadge}
                style={{
                  background: categoryColorBg(catDef.color),
                  color: categoryColorFg(catDef.color),
                  cursor: "pointer",
                }}
                onClick={() => setShowCategoryPicker((v) => !v)}
              >
                <catDef.icon size={14} />
                {catDef.label}
                <IconChevronDown size={12} style={{ marginLeft: 2 }} />
              </Box>
            </Box>

            {showCategoryPicker && (
              <Box className={classes.categoryPicker}>
                {categoryDefs.map((c) => (
                  <Box
                    key={c.key}
                    className={`${classes.categoryOption} ${c.key === detectedCategory ? classes.categoryOptionActive : ""}`}
                    onClick={() => changeCategory(c.key)}
                  >
                    <c.icon size={16} />
                    <Text size="sm" fw={600}>{c.label}</Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* フォーム: AI時は固定+変動、ブラウザ時は従来 */}
            {aiMode && Object.keys(fixedValues).length > 0 ? (
              <>
                {/* 往復など複数ステップのページャ */}
                {aiSteps.length > 1 && (
                  <Box
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 10,
                      padding: "6px 10px",
                      background: "var(--surface, #f5f5f5)",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => goToStep(currentStepIdx - 1)}
                      disabled={currentStepIdx === 0}
                      aria-label="前のステップ"
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: 20,
                        lineHeight: 1,
                        padding: "2px 8px",
                        cursor: currentStepIdx === 0 ? "default" : "pointer",
                        opacity: currentStepIdx === 0 ? 0.3 : 1,
                      }}
                    >
                      ‹
                    </button>
                    <Text size="13px" fw={600}>
                      ステップ {currentStepIdx + 1} / {aiSteps.length}
                    </Text>
                    <button
                      type="button"
                      onClick={() => goToStep(currentStepIdx + 1)}
                      disabled={currentStepIdx === aiSteps.length - 1}
                      aria-label="次のステップ"
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: 20,
                        lineHeight: 1,
                        padding: "2px 8px",
                        cursor: currentStepIdx === aiSteps.length - 1 ? "default" : "pointer",
                        opacity: currentStepIdx === aiSteps.length - 1 ? 0.3 : 1,
                      }}
                    >
                      ›
                    </button>
                  </Box>
                )}

                {/* 要確認警告 */}
                {needsReview && (
                  <Box className={classes.reviewBanner}>
                    <IconAlertTriangle size={16} />
                    <Text size="xs" fw={600}>要確認: 一部の項目が読み取れませんでした</Text>
                  </Box>
                )}

                {/* タイトル（目立つ単独カード） */}
                <Box className={classes.titleCard}>
                  <Box className={classes.titleCardLabelRow}>
                    <Text className={classes.titleCardLabel}>タイトル</Text>
                    {inferredFields.includes("title") && (
                      <Text className={classes.inferredBadge}>推定</Text>
                    )}
                  </Box>
                  <input
                    type="text"
                    className={classes.titleCardInput}
                    placeholder="タイトルを入力"
                    value={fixedValues.title ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFixedValues((prev) => ({ ...prev, title: v }));
                    }}
                  />
                </Box>

                {/* カテゴリ別固定項目（title を除く） */}
                <Box className={classes.formCard}>
                  {getFixedFields(detectedCategory)
                    .filter((f) => f.key !== "title")
                    .map((f) => {
                    const isInferred = inferredFields.includes(f.key);
                    const isEmpty = !fixedValues[f.key];
                    return (
                      <Box key={f.key} className={classes.formRow}>
                        <Box className={classes.formLabelRow}>
                          <Text className={classes.formLabel}>{f.label}</Text>
                          {isInferred && <Text className={classes.inferredBadge}>推定</Text>}
                        </Box>
                        {isEmpty ? (
                          <TextInput
                            classNames={{ input: `${classes.formInput} ${classes.formInputEmpty}` }}
                            variant="unstyled"
                            placeholder="未読取（タップで入力）"
                            value=""
                            onChange={(e) => setFixedValues((prev) => ({ ...prev, [f.key]: e.currentTarget.value }))}
                          />
                        ) : (
                          <TextInput
                            classNames={{ input: `${classes.formInput} ${isInferred ? classes.formInputInferred : ""}` }}
                            variant="unstyled"
                            placeholder={f.placeholder}
                            value={fixedValues[f.key] || ""}
                            onChange={(e) => setFixedValues((prev) => ({ ...prev, [f.key]: e.currentTarget.value }))}
                          />
                        )}
                      </Box>
                    );
                  })}
                </Box>

                {/* 変動項目 */}
                {variableFields.length > 0 && (
                  <>
                    <Text size="xs" fw={600} c="dimmed" mt="md" mb={6}>その他の読み取り情報</Text>
                    <Box className={classes.formCard}>
                      {variableFields.map((v, i) => (
                        <Box key={i} className={classes.formRow}>
                          <Text className={classes.formLabel}>{v.label}</Text>
                          <TextInput
                            classNames={{ input: classes.formInput }}
                            variant="unstyled"
                            value={v.value}
                            onChange={(e) => {
                              setVariableFields((prev) =>
                                prev.map((item, idx) => idx === i ? { ...item, value: e.currentTarget.value } : item)
                              );
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </>
                )}
              </>
            ) : (
              <Box className={classes.formCard}>
                {fields.map((field) => {
                  const val = formValues[field.key] || "";
                  const empty = !val;
                  return (
                    <Box key={field.key} className={classes.formRow}>
                      <Text className={classes.formLabel}>{field.label}</Text>
                      <TextInput
                        classNames={{ input: `${classes.formInput} ${empty ? classes.formInputEmpty : ""}` }}
                        variant="unstyled"
                        placeholder={empty ? "未読取（タップで入力）" : field.placeholder}
                        value={val}
                        onChange={(e) => updateField(field.key, e.currentTarget.value)}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}

            {/* OCR全文（ブラウザOCR時のみ表示） */}
            {!aiMode && (
              <details className={classes.ocrDetails}>
                <summary className={classes.ocrSummary}>OCR全文を表示</summary>
                <Box className={classes.ocrTextBox}>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }} c="dimmed">
                    {ocrText || "テキストなし"}
                  </Text>
                </Box>
              </details>
            )}

            {/* 同じ日の予定に追加チェック — target 指定時は確定済みなので非表示 */}
            {!targetJourneyId && (
              <Checkbox
                label="同じ日の予定があれば追加する"
                checked={addToExisting}
                onChange={(e) => setAddToExisting(e.currentTarget.checked)}
                mt="md"
                size="sm"
              />
            )}

            {/* アクションボタン */}
            <Box className={classes.resultButtons}>
              <button
                className={classes.createButton}
                onClick={createStep}
                disabled={registering}
                style={registering ? { opacity: 0.7, pointerEvents: "none" } : undefined}
              >
                {registering ? (
                  <>
                    <Loader size={16} color="white" />
                    {targetJourney ? "追加中..." : "登録中..."}
                  </>
                ) : (
                  <>
                    <IconCheck size={18} />
                    {targetJourney ? "この旅程に追加" : "登録"}
                  </>
                )}
              </button>
              <button className={classes.retryButton} onClick={reset} disabled={registering}>
                やり直す
              </button>
            </Box>
          </>
        )}

        {/* エラー */}
        {status === "error" && (
          <Box className={classes.captureArea}>
            <IconAlertCircle size={48} color="var(--danger-500)" />
            <Text fw={700} size="lg" mt="md" c="red.6">
              読み取りに失敗しました
            </Text>
            <Text size="sm" c="dimmed" ta="center" mt={4}>
              画像が不鮮明か、対応していない形式です。
            </Text>
            {errorDetail && (
              <details style={{ marginTop: 12, width: "100%" }}>
                <summary style={{ fontSize: 12, color: "var(--text-dim)", cursor: "pointer", textAlign: "center" }}>
                  詳細を表示
                </summary>
                <Text size="xs" c="dimmed" mt={8} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {errorDetail}
                </Text>
              </details>
            )}
            <Box className={classes.buttons} style={{ marginTop: 24 }}>
              <button className={classes.captureButton} onClick={reset}>
                やり直す
              </button>
            </Box>
          </Box>
        )}
      </Box>

      {!isEmbedded && <TabBar />}

      {/* Flow A: 登録先の 3 分岐 */}
      <DestinationSelector
        opened={selectorOpen}
        primary={pendingCommit?.stepsToRegister[0] ?? null}
        onCancel={closeSelector}
        onChoose={handleSelectorChoose}
      />

      {/* Flow A: 既存旅程のピッカー */}
      <JourneyPicker
        opened={pickerOpen}
        primary={pendingCommit?.stepsToRegister[0] ?? null}
        onBack={() => {
          setPickerOpen(false);
          setSelectorOpen(true);
        }}
        onCancel={() => {
          setPickerOpen(false);
          setPendingCommit(null);
          setRegistering(false);
        }}
        onPick={handlePickerPick}
      />
    </>
  );
}
