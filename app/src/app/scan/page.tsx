"use client";

import { Box, Text, Loader, TextInput, Checkbox } from "@mantine/core";
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
  IconChevronDown,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { addJourney, getJourneys, updateJourney, generateId } from "@/lib/store";
import type { Step, StepCategory } from "@/lib/types";
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

/* ====== コンポーネント ====== */

type ScanStatus = "idle" | "processing" | "done" | "error";

export default function ScanPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [detectedCategory, setDetectedCategory] = useState<StepCategory>("その他");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [ocrText, setOcrText] = useState("");
  const [progress, setProgress] = useState(0);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [addToExisting, setAddToExisting] = useState(true);

  const pdfToImage = async (file: File): Promise<Blob> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const scale = 2; // 高解像度でOCR精度向上
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  };

  const handleFile = async (file: File) => {
    setStatus("processing");
    setProgress(0);

    try {
      let ocrTarget: File | Blob = file;

      // PDFの場合は画像に変換
      if (file.type === "application/pdf") {
        const imageBlob = await pdfToImage(file);
        ocrTarget = imageBlob;
        setImageUrl(URL.createObjectURL(imageBlob));
      } else {
        setImageUrl(URL.createObjectURL(file));
      }

      const Tesseract = await import("tesseract.js");
      const result = await Tesseract.recognize(ocrTarget, "jpn+eng", {
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      const text = result.data.text;
      setOcrText(text);
      const cat = detectCategory(text);
      setDetectedCategory(cat);
      setFormValues(extractFields(text, cat));
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const updateField = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const changeCategory = (cat: StepCategory) => {
    setDetectedCategory(cat);
    setFormValues(extractFields(ocrText, cat));
    setShowCategoryPicker(false);
  };


  const createStep = () => {
    const stepData = formToStep(detectedCategory, formValues);
    const now = new Date().toISOString();
    const todayStr = new Date().toISOString().split("T")[0];
    const step: Step = {
      id: generateId(),
      category: detectedCategory,
      title: stepData.title,
      time: stepData.time,
      detail: stepData.detail || undefined,
      confNumber: stepData.confNumber || undefined,
      source: "撮影",
      status: "未開始",
      information: [],
    };

    if (addToExisting && sameDayTarget) {
      // 既存Journeyに追加
      updateJourney(sameDayTarget.id, {
        steps: [...sameDayTarget.steps, step],
      });
    } else {
      // 新規Journey作成
      const cd = getCategoryDef(detectedCategory);
      addJourney({
        id: generateId(),
        title: `${cd.label} ${new Date().toLocaleDateString("ja-JP")}`,
        startDate: todayStr,
        endDate: todayStr,
        steps: [step],
        createdAt: now,
        updatedAt: now,
      });
    }

    sessionStorage.setItem("toritavi_toast", "journey_created");
    router.push("/");
  };

  const reset = () => {
    setImageUrl(null);
    setStatus("idle");
    setOcrText("");
    setFormValues({});
    setProgress(0);
    setShowCategoryPicker(false);
  };

  const catDef = getCategoryDef(detectedCategory);
  const fields = categoryFields[detectedCategory] || categoryFields["その他"];

  // 同じ日のJourneyを検索
  const today = new Date().toISOString().split("T")[0];
  const sameDayJourneys = status === "done"
    ? getJourneys().filter((j) => j.startDate <= today && j.endDate >= today)
    : [];
  const sameDayTarget = sameDayJourneys[0]; // 最初の一致を使用

  return (
    <>
      <AppHeader title="予定登録" />

      <Box pb={110} px="md" pt="md">
        {/* 初期画面: 撮影/アップロード */}
        {status === "idle" && (
          <Box className={classes.captureArea}>
            <Box className={classes.iconWrap}>
              <IconScan size={48} stroke={1.5} />
            </Box>
            <Text fw={700} size="lg" mt="md">
              予定の自動登録
            </Text>
            <Text size="sm" c="dimmed" ta="center" mt={4} lh={1.6}>
              撮影またはアップロードするだけで
              <br />
              種類を自動判定し、情報を読み取ります
            </Text>

            <Box className={classes.buttons}>
              <button
                className={classes.captureButton}
                onClick={() => cameraInputRef.current?.click()}
              >
                <IconCamera size={22} />
                撮影する
              </button>
              <button
                className={classes.uploadButton}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload size={20} />
                ファイル・画像を選択
              </button>
            </Box>

            <Text size="xs" c="dimmed" mt="md">
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
          </Box>
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
                読み取り中... {progress}%
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
            {imageUrl && (
              <Box className={classes.previewCard}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="スキャン元" className={classes.previewThumb} />
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

            {/* 専用フォーム */}
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
            {sameDayTarget && (
              <Checkbox
                label={`同じ日の予定に追加する（${sameDayTarget.title}）`}
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
