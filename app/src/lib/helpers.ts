import { Journey, JourneyState, Step, StepCategory, StepSource } from "./types";
import {
  IconTrain,
  IconPlane,
  IconBus,
  IconCar,
  IconWalk,
  IconBed,
  IconBriefcase,
  IconToolsKitchen2,
  IconTicket,
  IconStethoscope,
  IconDots,
  IconCamera,
  IconUpload,
  IconMail,
  IconTypography,
} from "@tabler/icons-react";

export function getCategoryIcon(category: StepCategory) {
  const map: Record<StepCategory, typeof IconTrain> = {
    列車: IconTrain,
    飛行機: IconPlane,
    バス: IconBus,
    車: IconCar,
    徒歩: IconWalk,
    宿泊: IconBed,
    商談: IconBriefcase,
    食事: IconToolsKitchen2,
    観光: IconTicket,
    病院: IconStethoscope,
    その他: IconDots,
  };
  return map[category] ?? IconDots;
}

export function getSourceIcon(source: StepSource) {
  const map: Record<StepSource, typeof IconCamera> = {
    撮影: IconCamera,
    アップロード: IconUpload,
    メール: IconMail,
    手入力: IconTypography,
  };
  return map[source] ?? IconDots;
}

export function getSourceLabel(source: StepSource): string {
  const map: Record<StepSource, string> = {
    撮影: "撮影 → OCR",
    アップロード: "PDFアップロード",
    メール: "メールから取込",
    手入力: "手入力",
  };
  return map[source] ?? source;
}

export function formatDateJP(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}月${d.getDate()}日 (${days[d.getDay()]})`;
}

export function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDateJP(start);
  return `${formatDateJP(start)} - ${formatDateJP(end)}`;
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysUntil(dateStr: string): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "完了";
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  return `${diff}日後`;
}

function parseStepMinutes(time: string): number {
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function sortStepsByTime(steps: Step[]): Step[] {
  return [...steps].sort((a, b) => parseStepMinutes(a.time) - parseStepMinutes(b.time));
}

export function getNextActionStep(steps: Step[]): Step | undefined {
  return sortStepsByTime(steps).find(
    (step) => step.status !== "完了" && step.status !== "キャンセル"
  );
}

export function getJourneyState(journey: Journey): JourneyState {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const start = new Date(journey.startDate + "T00:00:00");
  const end = new Date(journey.endDate + "T00:00:00");
  const actionableSteps = journey.steps.filter((step) => step.status !== "キャンセル");
  const allDone =
    actionableSteps.length > 0 &&
    actionableSteps.every((step) => step.status === "完了");

  if (allDone || end < now) return "完了";
  if (start > now) return "準備中";
  return "進行中";
}

export function getJourneyProgress(journey: Journey): {
  completed: number;
  total: number;
  ratio: number;
} {
  const total = journey.steps.filter((step) => step.status !== "キャンセル").length;
  const completed = journey.steps.filter((step) => step.status === "完了").length;
  return {
    completed,
    total,
    ratio: total === 0 ? 0 : completed / total,
  };
}

export function getJourneyStateColor(state: JourneyState): string {
  const map: Record<JourneyState, string> = {
    準備中: "indigo",
    進行中: "blue",
    完了: "teal",
  };
  return map[state];
}
