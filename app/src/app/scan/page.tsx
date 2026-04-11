"use client";

import { Box, Text, Loader } from "@mantine/core";
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
  IconCheck,
  IconAlertCircle,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { addJourney, generateId } from "@/lib/store";
import type { Step, StepCategory } from "@/lib/types";
import classes from "./page.module.css";

/* ====== カテゴリ定義 ====== */

type ScanCategory = {
  key: StepCategory;
  label: string;
  icon: typeof IconPlane;
  color: string;
  description: string;
};

const scanCategories: ScanCategory[] = [
  { key: "飛行機", label: "フライト", icon: IconPlane, color: "blue", description: "" },
  { key: "列車", label: "鉄道", icon: IconTrain, color: "blue", description: "" },
  { key: "宿泊", label: "ホテル", icon: IconBed, color: "teal", description: "" },
  { key: "観光", label: "チケット", icon: IconTicket, color: "violet", description: "" },
  { key: "商談", label: "ビジネス", icon: IconBriefcase, color: "indigo", description: "" },
  { key: "食事", label: "レストラン", icon: IconToolsKitchen2, color: "orange", description: "" },
  { key: "バス", label: "バス", icon: IconBus, color: "green", description: "" },
  { key: "病院", label: "病院", icon: IconStethoscope, color: "red", description: "" },
  { key: "その他", label: "その他", icon: IconDots, color: "gray", description: "" },
];

/* ====== カテゴリ特化パーサー ====== */

type ParsedField = { label: string; value: string };

function parseByCategory(text: string, category: StepCategory): { title: string; time: string; detail: string; confNumber: string; fields: ParsedField[] } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const allText = lines.join(" ");
  const fields: ParsedField[] = [];
  let title = "";
  let time = "";
  let detail = "";
  let confNumber = "";

  // 共通: 時刻
  const timeMatch = allText.match(/(\d{1,2}:\d{2})/);
  if (timeMatch) time = timeMatch[1];

  // 共通: 確認番号
  const confMatch = allText.match(/([A-Z]{1,6}[-]?\d{3,})/i);
  if (confMatch) confNumber = confMatch[1];

  switch (category) {
    case "飛行機": {
      // 便名: NH123, JL456, ANA1234 等
      const flightMatch = allText.match(/(NH|JL|ANA|JAL|UA|DL|AA|SQ|CX|TG|OZ|KE|CI|BR|HX|MM|JW|BC|GK|7G|APJ|SKY|SNA|ADO|SFJ|FDA|IBX|ORC|AMX|RAC)[\s-]?(\d{1,4})/i);
      if (flightMatch) {
        title = `${flightMatch[1].toUpperCase()}${flightMatch[2]}便`;
        fields.push({ label: "便名", value: `${flightMatch[1].toUpperCase()} ${flightMatch[2]}` });
      }

      // 空港コード: NRT, HND, KIX 等
      const airportCodes = allText.match(/\b([A-Z]{3})\b/g);
      if (airportCodes && airportCodes.length >= 2) {
        detail = `${airportCodes[0]} → ${airportCodes[1]}`;
        fields.push({ label: "区間", value: detail });
      }

      // 出発・到着時刻
      const times = allText.match(/(\d{1,2}:\d{2})/g);
      if (times && times.length >= 2) {
        time = times[0];
        fields.push({ label: "出発", value: times[0] });
        fields.push({ label: "到着", value: times[1] });
      }

      // 座席
      const seatMatch = allText.match(/(\d{1,3}[A-K])\b/);
      if (seatMatch) fields.push({ label: "座席", value: seatMatch[1] });

      // ゲート
      const gateMatch = allText.match(/gate[\s:]*([A-Z]?\d{1,3})/i);
      if (gateMatch) fields.push({ label: "ゲート", value: gateMatch[1] });

      if (!title) title = "フライト情報";
      break;
    }

    case "列車": {
      // 列車名: のぞみ225号, ひかり503号 等
      const trainMatch = allText.match(/(のぞみ|ひかり|こだま|みずほ|さくら|はやぶさ|かがやき|つばさ|やまびこ|とき|あさま|しらさぎ|サンダーバード|はくたか)\s*(\d{1,4})\s*号?/);
      if (trainMatch) {
        title = `${trainMatch[1]} ${trainMatch[2]}号`;
        fields.push({ label: "列車", value: title });
      }

      // 駅名
      const stationMatch = allText.match(/(東京|品川|新横浜|名古屋|京都|新大阪|博多|新神戸|広島|岡山|仙台|盛岡|新青森|新函館北斗|金沢|長野|上野|大宮|小田原|熱海|三島|静岡|浜松|豊橋|米原|新白河|郡山|福島|一ノ関|北上|新花巻|水沢江刺|くりこま高原|古川|上田|佐久平|軽井沢|高崎|越後湯沢|長岡|燕三条|新潟)/g);
      if (stationMatch && stationMatch.length >= 2) {
        const unique = [...new Set(stationMatch)];
        if (unique.length >= 2) {
          detail = `${unique[0]} → ${unique[1]}`;
          fields.push({ label: "区間", value: detail });
        }
      }

      // 号車・座席
      const carMatch = allText.match(/(\d{1,2})\s*号車/);
      if (carMatch) fields.push({ label: "号車", value: `${carMatch[1]}号車` });

      const seatMatch = allText.match(/(\d{1,2})\s*[番]?\s*([A-E])\s*席?/);
      if (seatMatch) fields.push({ label: "座席", value: `${seatMatch[1]}番${seatMatch[2]}席` });

      // 発着時刻
      const times = allText.match(/(\d{1,2}:\d{2})/g);
      if (times && times.length >= 2) {
        time = times[0];
        fields.push({ label: "発車", value: times[0] });
        fields.push({ label: "到着", value: times[1] });
      }

      if (!title) title = "列車情報";
      break;
    }

    case "宿泊": {
      // ホテル名
      const hotelMatch = allText.match(/(ホテル[^\s,、。]{2,15}|[^\s,、。]{2,10}(ホテル|inn|hotel|旅館))/i);
      if (hotelMatch) {
        title = hotelMatch[0];
        fields.push({ label: "施設名", value: title });
      }

      // チェックイン/アウト
      const checkinMatch = allText.match(/(?:check.?in|チェックイン)[:\s]*(\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日)/i);
      if (checkinMatch) fields.push({ label: "チェックイン", value: checkinMatch[1] });

      const checkoutMatch = allText.match(/(?:check.?out|チェックアウト)[:\s]*(\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日)/i);
      if (checkoutMatch) fields.push({ label: "チェックアウト", value: checkoutMatch[1] });

      // 部屋タイプ
      const roomMatch = allText.match(/(シングル|ダブル|ツイン|スイート|デラックス|スタンダード|禁煙|喫煙)/);
      if (roomMatch) fields.push({ label: "部屋", value: roomMatch[0] });

      // 宿泊日
      const dateMatch = allText.match(/(\d{1,2}月\d{1,2}日)/);
      if (dateMatch) {
        time = dateMatch[1];
        fields.push({ label: "日付", value: dateMatch[1] });
      }

      if (!title) title = "宿泊情報";
      break;
    }

    case "商談": {
      // 会社名
      const companyMatch = allText.match(/([^\s]{2,10}(株式会社|(株)|社|Corp|Inc))/);
      if (companyMatch) {
        title = companyMatch[0];
        fields.push({ label: "相手先", value: title });
      }

      // 場所
      const placeMatch = allText.match(/([\u4e00-\u9faf]{2,6}(ビル|センター|ホール|会議室))/);
      if (placeMatch) {
        detail = placeMatch[0];
        fields.push({ label: "場所", value: detail });
      }

      // 時刻
      const times = allText.match(/(\d{1,2}:\d{2})/g);
      if (times) {
        time = times[0];
        if (times.length >= 2) {
          fields.push({ label: "時間", value: `${times[0]} - ${times[1]}` });
        }
      }

      if (!title) title = "商談・会議";
      break;
    }

    case "食事": {
      // 店名
      const shopMatch = allText.match(/(レストラン[^\s,]{2,10}|[^\s,]{2,10}(レストラン|食堂|カフェ|Cafe|ダイニング))/i);
      if (shopMatch) {
        title = shopMatch[0];
        fields.push({ label: "店名", value: title });
      }

      // 予約時刻
      if (timeMatch) fields.push({ label: "予約時刻", value: timeMatch[1] });

      // 人数
      const guestMatch = allText.match(/(\d{1,2})\s*名/);
      if (guestMatch) fields.push({ label: "人数", value: `${guestMatch[1]}名` });

      if (!title) title = "食事予約";
      break;
    }

    case "バス": {
      // バス会社・路線名
      const busMatch = allText.match(/([\u4e00-\u9faf]{2,8}(バス|交通|ライナー))/);
      if (busMatch) {
        title = busMatch[0];
        fields.push({ label: "路線", value: title });
      }

      const times = allText.match(/(\d{1,2}:\d{2})/g);
      if (times && times.length >= 2) {
        time = times[0];
        fields.push({ label: "発車", value: times[0] });
        fields.push({ label: "到着", value: times[1] });
      }

      if (!title) title = "バス情報";
      break;
    }

    case "病院": {
      // 病院: 病院名、診療科、予約日時、診察券番号
      const hospitalMatch = allText.match(/([\u4e00-\u9faf]{2,10}(病院|クリニック|医院|診療所))/);
      if (hospitalMatch) {
        title = hospitalMatch[0];
        fields.push({ label: "病院名", value: title });
      }

      const deptMatch = allText.match(/(内科|外科|眼科|歯科|皮膚科|整形外科|耳鼻科|小児科|産婦人科|泌尿器科|精神科|神経科|循環器|消化器|呼吸器)/);
      if (deptMatch) fields.push({ label: "診療科", value: deptMatch[0] });

      const dateMatch2 = allText.match(/(\d{1,2}月\d{1,2}日|\d{4}[年/.]\d{1,2}[月/.]\d{1,2}日?)/);
      if (dateMatch2) fields.push({ label: "予約日", value: dateMatch2[1] });

      if (timeMatch) fields.push({ label: "予約時刻", value: timeMatch[1] });

      const cardMatch = allText.match(/(\d{4,10})/);
      if (cardMatch) fields.push({ label: "診察券番号", value: cardMatch[1] });

      if (!title) title = "病院予約";
      break;
    }

    case "観光": {
      // チケット: イベント名、会場、日付、座席、番号
      const eventMatch = allText.match(/([\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]{3,20})/);
      if (eventMatch) {
        title = eventMatch[0];
        fields.push({ label: "イベント", value: title });
      }

      const venueMatch = allText.match(/([\u4e00-\u9faf]{2,10}(ホール|アリーナ|スタジアム|ドーム|劇場|センター|会場|シアター))/);
      if (venueMatch) {
        detail = venueMatch[0];
        fields.push({ label: "会場", value: detail });
      }

      const dateMatch = allText.match(/(\d{4}[年/.]\d{1,2}[月/.]\d{1,2}日?|\d{1,2}月\d{1,2}日)/);
      if (dateMatch) fields.push({ label: "日付", value: dateMatch[1] });

      const seatMatch = allText.match(/([\u4e00-\u9faf]?\d{1,3}\s*列\s*\d{1,3}\s*番|[A-Z]?\d{1,3}\s*番)/);
      if (seatMatch) fields.push({ label: "座席", value: seatMatch[0] });

      if (timeMatch) fields.push({ label: "開場/開演", value: timeMatch[1] });

      if (!title) title = "チケット情報";
      break;
    }

    default: {
      // その他: 全文から要点だけ
      title = lines[0]?.substring(0, 30) || "スキャンデータ";
      if (lines.length > 1) detail = lines.slice(1).join(" ").substring(0, 60);
      break;
    }
  }

  if (confNumber) fields.push({ label: "確認番号", value: confNumber });

  return { title, time, detail, confNumber, fields };
}

/* ====== ステータス型 ====== */

type ScanStatus = "idle" | "processing" | "done" | "error";

/* ====== コンポーネント ====== */

export default function ScanPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<ScanCategory | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [ocrText, setOcrText] = useState("");
  const [parsedResult, setParsedResult] = useState<ReturnType<typeof parseByCategory> | null>(null);
  const [progress, setProgress] = useState(0);

  const selectCategory = (cat: ScanCategory) => {
    setSelectedCategory((prev) => (prev?.key === cat.key ? null : cat));
  };

  const handleFile = async (file: File) => {
    if (!selectedCategory) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setStatus("processing");
    setProgress(0);
    setOcrText("");
    setParsedResult(null);

    try {
      const Tesseract = await import("tesseract.js");
      const result = await Tesseract.recognize(file, "jpn+eng", {
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      const text = result.data.text;
      setOcrText(text);
      setParsedResult(parseByCategory(text, selectedCategory.key));
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // inputをリセットして同じファイルを再選択可能に
    e.target.value = "";
  };

  const createStep = () => {
    if (!parsedResult || !selectedCategory) return;

    const now = new Date().toISOString();
    const today = new Date().toISOString().split("T")[0];
    const step: Step = {
      id: generateId(),
      category: selectedCategory.key,
      title: parsedResult.title,
      time: parsedResult.time,
      detail: parsedResult.detail || undefined,
      confNumber: parsedResult.confNumber || undefined,
      source: "撮影",
      status: "未開始",
      information: [],
    };

    addJourney({
      id: generateId(),
      title: `${selectedCategory.label} ${new Date().toLocaleDateString("ja-JP")}`,
      startDate: today,
      endDate: today,
      steps: [step],
      createdAt: now,
      updatedAt: now,
    });

    sessionStorage.setItem("toritavi_toast", "journey_created");
    router.push("/");
  };

  const reset = () => {
    setSelectedCategory(null);
    setImageUrl(null);
    setStatus("idle");
    setOcrText("");
    setParsedResult(null);
    setProgress(0);
  };

  const backToIdle = () => {
    setImageUrl(null);
    setStatus("idle");
    setOcrText("");
    setParsedResult(null);
    setProgress(0);
  };

  const isActive = selectedCategory !== null;

  return (
    <>
      <AppHeader
        title="スキャン"
        back={status !== "idle"}
        backHref="/scan"
        action={undefined}
      />

      <Box pb={110} px="md" pt="md">
        {/* メイン画面: カテゴリ選択 + 撮影ボタン */}
        {status === "idle" && (
          <>
            <Text fw={700} size="sm" mb={8}>
              種類を選択
            </Text>

            <Box className={classes.categoryGrid}>
              {scanCategories.map((cat) => {
                const selected = selectedCategory?.key === cat.key;
                return (
                  <button
                    key={cat.key}
                    className={`${classes.categoryCard} ${selected ? classes.categorySelected : ""}`}
                    onClick={() => selectCategory(cat)}
                  >
                    <Box className={`${classes.radio} ${selected ? classes.radioChecked : ""}`}>
                      {selected && <Box className={classes.radioDot} />}
                    </Box>
                    <Box
                      className={classes.categoryIcon}
                      style={{
                        background: selected
                          ? `var(--mantine-color-${cat.color}-7)`
                          : `var(--mantine-color-${cat.color}-0)`,
                        color: selected
                          ? "white"
                          : `var(--mantine-color-${cat.color}-7)`,
                      }}
                    >
                      <cat.icon size={20} />
                    </Box>
                    <Text fw={600} size="xs">
                      {cat.label}
                    </Text>
                  </button>
                );
              })}
            </Box>

            <Box className={classes.buttons} style={{ marginTop: 20 }}>
              <button
                className={classes.captureButton}
                disabled={!isActive}
                onClick={() => cameraInputRef.current?.click()}
              >
                <IconCamera size={22} />
                撮影する
              </button>
              <button
                className={classes.uploadButton}
                disabled={!isActive}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload size={22} />
                画像を選択
              </button>
            </Box>

            {!isActive && (
              <Text size="xs" c="dimmed" ta="center" mt={12}>
                種類を選ぶと撮影・アップロードできます
              </Text>
            )}

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
                {selectedCategory?.label}の情報を読み取り中... {progress}%
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

        {/* ステップ4: 結果表示 */}
        {status === "done" && parsedResult && selectedCategory && (
          <>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="スキャン結果" className={classes.resultImage} />
            )}

            <Box className={classes.resultHeader}>
              <Box
                className={classes.resultCategoryBadge}
                style={{
                  background: `var(--mantine-color-${selectedCategory.color}-0)`,
                  color: `var(--mantine-color-${selectedCategory.color}-7)`,
                }}
              >
                <selectedCategory.icon size={14} />
                {selectedCategory.label}
              </Box>
              <Text fw={700} size="lg">
                {parsedResult.title}
              </Text>
            </Box>

            {parsedResult.fields.length > 0 && (
              <Box className={classes.fieldsCard}>
                {parsedResult.fields.map((f, i) => (
                  <Box key={i} className={classes.fieldRow}>
                    <Text size="xs" c="dimmed">
                      {f.label}
                    </Text>
                    <Text
                      size="sm"
                      fw={600}
                      style={
                        f.label === "確認番号"
                          ? { fontFamily: "monospace", color: "var(--mantine-color-blue-7)" }
                          : undefined
                      }
                    >
                      {f.value}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            <Text className={classes.sectionLabel}>OCR全文</Text>
            <Box className={classes.ocrTextBox}>
              <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }} c="dimmed">
                {ocrText || "テキストを検出できませんでした"}
              </Text>
            </Box>

            <Box className={classes.resultButtons}>
              <button className={classes.createButton} onClick={createStep}>
                <IconCheck size={18} />
                Journeyとして追加
              </button>
              <button className={classes.retryButton} onClick={backToIdle}>
                撮り直す
              </button>
              <button className={classes.retryButton} onClick={reset}>
                種類を変更
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
              <button className={classes.captureButton} onClick={backToIdle}>
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
