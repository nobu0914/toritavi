"use client";

/*
 * ConciergeToolCard — AI の tool_use 提案を確認するカード UI。
 * DS v2 §15.4 の「操作の提案」ブロック。
 *
 * Phase 1 は add_step のみ対応。実行するかどうかはユーザーのタップで確定。
 */

import { Box, Text } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { Journey } from "@/lib/types";
import classes from "./ConciergeToolCard.module.css";

export type AddStepToolInput = {
  journey_id: string;
  category: string;
  title: string;
  date?: string;
  time?: string;
  endTime?: string;
  from?: string;
  to?: string;
  reason?: string;
};

type Props = {
  input: AddStepToolInput;
  journeys: Journey[];
  result?: { ok: boolean; note?: string };
  onConfirm: () => void;
  onDecline: () => void;
};

export function ConciergeToolCard({ input, journeys, result, onConfirm, onDecline }: Props) {
  const targetJourney = journeys.find((j) => j.id === input.journey_id);
  const journeyName = targetJourney?.title ?? "（該当 Journey なし）";

  const timeSpan = [input.time, input.endTime].filter(Boolean).join("-");
  const placeLine = [input.from, input.to].filter(Boolean).join(" → ");

  if (result) {
    return (
      <Box className={classes.card} data-state={result.ok ? "confirmed" : "declined"}>
        <Box className={classes.header}>
          <Text className={classes.headerLabel}>{result.ok ? "CONFIRMED" : "DECLINED"}</Text>
        </Box>
        <Box className={classes.resultRow}>
          {result.ok ? <IconCheck size={14} /> : <IconX size={14} />}
          <Text size="xs" fw={600}>{result.note ?? (result.ok ? "追加しました" : "キャンセルしました")}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box className={classes.card}>
      <Box className={classes.header}>
        <Text className={classes.headerLabel}>PROPOSAL</Text>
      </Box>
      <Text className={classes.title}>{input.title} を予定に追加しますか？</Text>
      <Box className={classes.meta}>
        <Text size="xs" c="dimmed">
          カテゴリ: {input.category}
          {input.date && ` · 日付: ${input.date}`}
          {timeSpan && ` · 時刻: ${timeSpan}`}
        </Text>
        {placeLine && <Text size="xs" c="dimmed">場所: {placeLine}</Text>}
        <Text size="xs" c="dimmed">追加先: <strong>{journeyName}</strong></Text>
        {input.reason && (
          <Text size="xs" c="dimmed" fs="italic" mt={4}>{input.reason}</Text>
        )}
      </Box>
      <Box className={classes.actions}>
        <button type="button" className={classes.confirmBtn} onClick={onConfirm} disabled={!targetJourney}>
          追加する
        </button>
        <button type="button" className={classes.declineBtn} onClick={onDecline}>
          いいえ
        </button>
      </Box>
    </Box>
  );
}
