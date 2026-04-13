"use client";

import { Box, Text, Loader, TextInput, Checkbox, Textarea } from "@mantine/core";
import {
  IconCamera,
  IconUpload,
  IconPlane,
  IconTrain,
  IconBed,
  IconBriefcase,
  IconToolsKitchen2,
  IconBus,
  IconTicket,
  IconStethoscope,
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
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { addJourney, getJourneys, updateJourney, generateId } from "@/lib/store-supabase";
import type { Step, StepCategory } from "@/lib/types";
import { getFixedFields } from "@/lib/ocr-rules";
import classes from "./page.module.css";

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
  { key: "宿泊", label: "ホテル", icon: IconBed, color: "teal" },
  { key: "観光", label: "チケット", icon: IconTicket, color: "violet" },
  { key: "商談", label: "ビジネス", icon: IconBriefcase, color: "indigo" },
  { key: "食事", label: "レストラン", icon: IconToolsKitchen2, color: "orange" },
  { key: "バス", label: "バス", icon: IconBus, color: "green" },
  { key: "病院", label: "病院", icon: IconStethoscope, color: "red" },
  { key: "その他", label: "その他", icon: IconDots, color: "gray" },
];

function getCategoryDef(key: StepCategory): CategoryDef {
  return categoryDefs.find((c) => c.key === key) ?? categoryDefs[categoryDefs.length - 1];
}

/* ====== カテゴリ自動判定 ====== */

function detectCategory(text: string): StepCategory {
  const t = text.toLowerCase();
  if (/NH|JL|ANA|JAL|flight|搭乗|boarding|航空|便名|departure|arrival|gate/i.test(t)) return "飛行機";
  if (/新幹線|のぞみ|ひかり|こだま|はやぶさ|かがやき|特急|号車|jr|列車/i.test(t)) return "列車";
  if (/hotel|ホテル|check.?in|check.?out|宿泊|旅館|inn|チェックイン/i.test(t)) return "宿泊";
  if (/病院|クリニック|医院|診療|診察|内科|外科|歯科|眼科|皮膚科|処方/i.test(t)) return "病院";
  if (/会議|商談|meeting|打ち合わせ|会議室|アポイント/i.test(t)) return "商談";
  if (/レストラン|食事|ランチ|ディナー|予約.*名|restaurant|cafe|カフェ/i.test(t)) return "食事";
  if (/バス|bus|乗車券|高速バス/i.test(t)) return "バス";
  if (/チケット|ticket|入場|座席|アリーナ|ホール|劇場|開演|開場/i.test(t)) return "観光";
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
  病院: [
    { key: "hospitalName", label: "病院名", placeholder: "◯◯病院" },
    { key: "department", label: "診療科", placeholder: "内科" },
    { key: "date", label: "予約日", placeholder: "4月15日" },
    { key: "time", label: "予約時刻", placeholder: "10:00" },
    { key: "cardNo", label: "診察券番号", placeholder: "12345" },
  ],
  商談: [
    { key: "company", label: "相手先", placeholder: "ABC株式会社" },
    { key: "location", label: "場所", placeholder: "グランフロント大阪" },
    { key: "startTime", label: "開始時刻", placeholder: "14:00" },
    { key: "endTime", label: "終了時刻", placeholder: "16:00" },
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
    case "病院": {
      const hosp = allText.match(/([\u4e00-\u9faf]{2,10}(病院|クリニック|医院|診療所))/);
      if (hosp) values.hospitalName = hosp[0];
      const dept = allText.match(/(内科|外科|眼科|歯科|皮膚科|整形外科|耳鼻科|小児科|産婦人科)/);
      if (dept) values.department = dept[0];
      const dateM = allText.match(/(\d{1,2}月\d{1,2}日)/);
      if (dateM) values.date = dateM[1];
      if (times[0]) values.time = times[0];
      const card = allText.match(/(\d{4,10})/);
      if (card) values.cardNo = card[1];
      break;
    }
    case "商談": {
      const comp = allText.match(/([^\s]{2,10}(株式会社|(株)|社))/);
      if (comp) values.company = comp[0];
      const loc = allText.match(/([\u4e00-\u9faf]{2,6}(ビル|センター|ホール|会議室))/);
      if (loc) values.location = loc[0];
      if (times[0]) values.startTime = times[0];
      if (times[1]) values.endTime = times[1];
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
    case "病院":
      return {
        title: values.hospitalName || "病院",
        time: values.time || "",
        detail: [values.department, values.date].filter(Boolean).join(" / "),
        confNumber: values.cardNo || "",
      };
    case "商談":
      return {
        title: values.company || "商談",
        time: [values.startTime, values.endTime].filter(Boolean).join(" - "),
        detail: values.location || "",
        confNumber: values.confNumber || "",
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

export default function ScanPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [detectedCategory, setDetectedCategory] = useState<StepCategory>("その他");
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

  const pdfToImages = async (file: File): Promise<Blob[]> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const blobs: Blob[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const scale = 3;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png")
      );
      blobs.push(blob);
    }
    return blobs;
  };

  const handleFile = async (file: File) => {
    setStatus("processing");
    setProgress(0);
    setCurrentPage(0);

    try {
      let ocrTargets: (File | Blob)[] = [];

      if (file.type === "application/pdf") {
        const imageBlobs = await pdfToImages(file);
        const urls = imageBlobs.map((b) => URL.createObjectURL(b));
        setPageUrls(urls);
        setImageUrl(urls[0]);
        ocrTargets = imageBlobs;
      } else {
        const url = URL.createObjectURL(file);
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

    try {
      // 画像化
      let imageBlobs: Blob[];
      if (file.type === "application/pdf") {
        imageBlobs = await pdfToImages(file);
        const urls = imageBlobs.map((b) => URL.createObjectURL(b));
        setPageUrls(urls);
        setImageUrl(urls[0]);
      } else {
        const url = URL.createObjectURL(file);
        setImageUrl(url);
        setPageUrls([url]);
        imageBlobs = [file];
      }

      setProgress(30);

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
        throw new Error(`API error ${res.status}: ${errBody}`);
      }

      const result = await res.json();
      console.log("[OCR] API result:", JSON.stringify(result, null, 2));
      setProgress(90);

      // steps配列から処理（TODO: 往復時は複数Step登録UI）
      const allSteps = result.steps || [result];
      setAiSteps(allSteps);

      // 最初のStepを表示
      applyAiStep(allSteps[0]);
      setOcrText(`[AI OCR] ${JSON.stringify(result, null, 2)}`);
      setProgress(100);
      setStatus("done");
    } catch (err) {
      console.error("[OCR] Error:", err);
      setStatus("error");
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (aiMode) handleFileAI(file);
      else handleFile(file);
    }
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
    if (file) {
      if (aiMode) handleFileAI(file);
      else handleFile(file);
    }
  };

  const changeCategory = (cat: StepCategory) => {
    setDetectedCategory(cat);
    setFormValues(extractFields(ocrText, cat));
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
    let savedImageUrl: string | undefined;
    let savedImageUrls: string[] | undefined;
    if (imageUrl) {
      try { savedImageUrl = await blobToBase64(imageUrl); } catch { /* ignore */ }
    }
    if (pageUrls.length > 1) {
      try {
        const urls: string[] = [];
        for (const u of pageUrls) {
          urls.push(await blobToBase64(u));
        }
        savedImageUrls = urls;
      } catch { /* ignore */ }
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
      for (let si = 0; si < aiSteps.length; si++) {
        const s = aiSteps[si];
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

    let journeyId: string;
    const firstDate = stepsToRegister[0]?.date;
    const lastDate = stepsToRegister[stepsToRegister.length - 1]?.endDate
      || stepsToRegister[stepsToRegister.length - 1]?.date;

    // 同日Journeyを検索
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

    sessionStorage.setItem("toritavi_toast", "journey_created");
    router.push(`/trips/${journeyId}`);
  };

  const reset = () => {
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
    setInferredFields([]);
    setNeedsReview(false);
  };

  const catDef = getCategoryDef(detectedCategory);
  const fields = categoryFields[detectedCategory] || categoryFields["その他"];

  const today = new Date().toISOString().split("T")[0];

  return (
    <>
      <AppHeader title="予定登録" />

      <Box pb={110} px="md" pt="md">
        {/* テストモード切替 */}
        {status === "idle" && (
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
              <IconDragDrop size={24} stroke={1.5} color="var(--mantine-color-gray-5)" />
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
              対応: フライト・鉄道・ホテル・病院・チケット 他
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
                  background: `var(--mantine-color-${catDef.color}-0)`,
                  color: `var(--mantine-color-${catDef.color}-7)`,
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
                {/* 要確認警告 */}
                {needsReview && (
                  <Box className={classes.reviewBanner}>
                    <IconAlertTriangle size={16} />
                    <Text size="xs" fw={600}>要確認: 一部の項目が読み取れませんでした</Text>
                  </Box>
                )}

                {/* カテゴリ別固定項目 */}
                <Box className={classes.formCard}>
                  {getFixedFields(detectedCategory).map((f) => {
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
                            placeholder={f.placeholder}
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
                {fields.map((field) => (
                  <Box key={field.key} className={classes.formRow}>
                    <Text className={classes.formLabel}>{field.label}</Text>
                    <TextInput
                      classNames={{ input: classes.formInput }}
                      variant="unstyled"
                      placeholder={field.placeholder}
                      value={formValues[field.key] || ""}
                      onChange={(e) => updateField(field.key, e.currentTarget.value)}
                    />
                  </Box>
                ))}
              </Box>
            )}

            {/* OCR全文 */}
            <details className={classes.ocrDetails}>
              <summary className={classes.ocrSummary}>OCR全文を表示</summary>
              <Box className={classes.ocrTextBox}>
                <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }} c="dimmed">
                  {ocrText || "テキストなし"}
                </Text>
              </Box>
            </details>

            {/* 同じ日の予定に追加チェック */}
            {(
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
              <button className={classes.createButton} onClick={createStep}>
                <IconCheck size={18} />
                登録
              </button>
              <button className={classes.retryButton} onClick={reset}>
                やり直す
              </button>
            </Box>
          </>
        )}

        {/* エラー */}
        {status === "error" && (
          <Box className={classes.captureArea}>
            <IconAlertCircle size={48} color="var(--mantine-color-red-6)" />
            <Text fw={700} size="lg" mt="md" c="red.6">
              読み取りに失敗しました
            </Text>
            <Text size="sm" c="dimmed" ta="center" mt={4}>
              画像が不鮮明か、対応していない形式です。
            </Text>
            <Box className={classes.buttons} style={{ marginTop: 24 }}>
              <button className={classes.captureButton} onClick={reset}>
                やり直す
              </button>
            </Box>
          </Box>
        )}
      </Box>

      <TabBar />
    </>
  );
}
