"use client";

import { Box, Text, Loader } from "@mantine/core";
import {
  IconCamera,
  IconUpload,
  IconScan,
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

type OcrStatus = "idle" | "processing" | "done" | "error";

type ParsedStep = {
  category: StepCategory;
  title: string;
  time: string;
  detail: string;
  confNumber: string;
};

function parseOcrText(text: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // 時刻パターン検出
    const timeMatch = line.match(/(\d{1,2}:\d{2})/);
    const time = timeMatch ? timeMatch[1] : "";

    // 確認番号パターン
    const confMatch = line.match(/([A-Z]{1,4}[-]?\d{4,})/i);
    const confNumber = confMatch ? confMatch[1] : "";

    // カテゴリ推定
    let category: StepCategory = "その他";
    const lower = line.toLowerCase();
    if (/新幹線|のぞみ|ひかり|こだま|列車|train|rail|jr/i.test(lower)) category = "列車";
    else if (/flight|便|搭乗|航空|ana|jal/i.test(lower)) category = "飛行機";
    else if (/hotel|ホテル|check.?in|宿泊|inn|旅館/i.test(lower)) category = "宿泊";
    else if (/会議|商談|meeting|打ち合わせ/i.test(lower)) category = "商談";
    else if (/レストラン|食事|ランチ|ディナー|restaurant/i.test(lower)) category = "食事";
    else if (/バス|bus/i.test(lower)) category = "バス";

    // 意味のある行だけステップ化（短すぎる行はスキップ）
    if (line.length >= 4 && (time || confNumber || category !== "その他")) {
      steps.push({
        category,
        title: line.substring(0, 40),
        time,
        detail: "",
        confNumber,
      });
    }
  }

  // 何も検出できなかった場合、全文を1ステップにする
  if (steps.length === 0 && text.trim().length > 0) {
    steps.push({
      category: "その他",
      title: text.trim().substring(0, 40),
      time: "",
      detail: text.trim().substring(40),
      confNumber: "",
    });
  }

  return steps;
}

export default function ScanPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [ocrText, setOcrText] = useState("");
  const [parsedSteps, setParsedSteps] = useState<ParsedStep[]>([]);
  const [progress, setProgress] = useState(0);

  const handleFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setStatus("processing");
    setProgress(0);
    setOcrText("");
    setParsedSteps([]);

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
      setParsedSteps(parseOcrText(text));
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const createSteps = () => {
    if (parsedSteps.length === 0) return;

    const now = new Date().toISOString();
    const today = new Date().toISOString().split("T")[0];
    const steps: Step[] = parsedSteps.map((s) => ({
      id: generateId(),
      category: s.category,
      title: s.title,
      time: s.time,
      detail: s.detail || undefined,
      confNumber: s.confNumber || undefined,
      source: "撮影",
      status: "未開始",
      information: [],
    }));

    addJourney({
      id: generateId(),
      title: `スキャン ${new Date().toLocaleDateString("ja-JP")}`,
      startDate: today,
      endDate: today,
      steps,
      createdAt: now,
      updatedAt: now,
    });

    sessionStorage.setItem("toritavi_toast", "journey_created");
    router.push("/");
  };

  const reset = () => {
    setImageUrl(null);
    setStatus("idle");
    setOcrText("");
    setParsedSteps([]);
    setProgress(0);
  };

  return (
    <>
      <AppHeader title="スキャン" />

      <Box pb={110} px="md" pt="md">
        {status === "idle" && (
          <Box className={classes.captureArea}>
            <Box className={classes.iconWrap}>
              <IconScan size={48} stroke={1.5} />
            </Box>
            <Text fw={700} size="lg" mt="md">
              書類をスキャン
            </Text>
            <Text size="sm" c="dimmed" ta="center" mt={4} lh={1.6}>
              チケット・予約確認書・搭乗券などを
              <br />
              撮影またはアップロードしてください
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
                <IconUpload size={22} />
                画像を選択
              </button>
            </Box>

            <Text size="xs" c="dimmed" mt="md">
              対応形式: JPG, PNG, PDF（1ページ目）
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

        {status === "processing" && (
          <Box className={classes.processingArea}>
            {imageUrl && (
              <img src={imageUrl} alt="スキャン中" className={classes.preview} />
            )}
            <Box className={classes.processingOverlay}>
              <Loader size="md" color="white" />
              <Text size="sm" fw={600} c="white" mt="sm">
                OCR処理中... {progress}%
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

        {status === "done" && (
          <>
            {imageUrl && (
              <img src={imageUrl} alt="スキャン結果" className={classes.resultImage} />
            )}

            <Text className={classes.sectionLabel}>読み取り結果</Text>
            <Box className={classes.ocrTextBox}>
              <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {ocrText || "テキストを検出できませんでした"}
              </Text>
            </Box>

            {parsedSteps.length > 0 && (
              <>
                <Text className={classes.sectionLabel}>
                  検出されたステップ（{parsedSteps.length}件）
                </Text>
                {parsedSteps.map((step, i) => (
                  <Box key={i} className={classes.stepCard}>
                    <Box className={classes.stepBadge}>{step.category}</Box>
                    <Text fw={600} size="sm">
                      {step.title}
                    </Text>
                    {step.time && (
                      <Text size="xs" c="dimmed">
                        時刻: {step.time}
                      </Text>
                    )}
                    {step.confNumber && (
                      <Text
                        size="xs"
                        c="blue.7"
                        fw={600}
                        style={{ fontFamily: "monospace" }}
                      >
                        Conf# {step.confNumber}
                      </Text>
                    )}
                  </Box>
                ))}
              </>
            )}

            <Box className={classes.resultButtons}>
              <button className={classes.createButton} onClick={createSteps}>
                <IconCheck size={18} />
                Journeyとして追加
              </button>
              <button className={classes.retryButton} onClick={reset}>
                やり直す
              </button>
            </Box>
          </>
        )}

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
