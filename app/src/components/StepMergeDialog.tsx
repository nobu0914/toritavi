"use client";

/*
 * StepMergeDialog — §16.3 既存予定への追記確認ダイアログ。
 *
 * props:
 *   candidates: findMergeCandidates の戻り値
 *   draft:      今スキャンで取得した新規 Step（Partial<Step>）
 *   onConfirm:  ユーザーが「統合する」を選んだ時、選択した候補を渡す
 *   onDecline:  「新規として登録」を選んだ時
 */

import { Modal, Box, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { Step } from "@/lib/types";
import type { MergeCandidate } from "@/lib/step-merge-match";
import { diffForPreview } from "@/lib/step-merge-rules";
import classes from "./StepMergeDialog.module.css";

type Props = {
  opened: boolean;
  candidates: MergeCandidate[];
  draft: Partial<Step>;
  onConfirm: (candidate: MergeCandidate) => void;
  onDecline: () => void;
};

export function StepMergeDialog({ opened, candidates, draft, onConfirm, onDecline }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (opened) setSelectedIdx(0);
  }, [opened, candidates]);

  if (candidates.length === 0) return null;
  const selected = candidates[selectedIdx] ?? candidates[0];
  const changes = diffForPreview(selected.step, draft);

  return (
    <Modal
      opened={opened}
      onClose={onDecline}
      withCloseButton={false}
      centered
      size="md"
      padding={0}
      className={classes.modal}
    >
      <Box className={classes.panel}>
        <Box className={classes.header}>既存の予定に追記しますか?</Box>
        <Box className={classes.body}>
          {candidates.length > 1 && (
            <Box className={classes.candidateList}>
              {candidates.map((c, i) => (
                <button
                  key={c.step.id}
                  type="button"
                  className={classes.candidateBtn}
                  data-active={i === selectedIdx ? "true" : "false"}
                  onClick={() => setSelectedIdx(i)}
                >
                  <Text className={classes.candidateBtnTitle}>{c.step.title}</Text>
                  <Text className={classes.candidateBtnMeta}>
                    {c.journey.title} · {c.step.date ?? "日付未定"} · {c.reason}
                  </Text>
                </button>
              ))}
            </Box>
          )}

          <Text className={classes.matchLabel} data-tier={selected.tier}>
            MATCH · 強度 {selected.tier === 1 ? "強" : selected.tier === 4 ? "弱" : "中"} · {selected.reason}
          </Text>
          <Box className={classes.matchCard} data-tier={selected.tier}>
            <Text className={classes.matchTitle}>{selected.step.title}</Text>
            <Text className={classes.matchMeta}>
              {selected.journey.title} · {selected.step.date ?? "—"}
            </Text>
          </Box>

          <Text className={classes.diffLabel}>変更内容</Text>
          {changes.length === 0 ? (
            <Text size="xs" c="dimmed">差分なし（変わる項目はありません）</Text>
          ) : (
            <Box className={classes.diffTable}>
              <Box className={classes.diffHead}>
                <span>項目</span>
                <span>現在</span>
                <span>更新後</span>
              </Box>
              {changes.map((c) => (
                <Box key={c.key} className={classes.diffRow} data-strategy={c.strategy}>
                  <span className={classes.diffKey}>{c.label}</span>
                  <span className={classes.diffBefore}>{c.before || "—"}</span>
                  <span className={classes.diffAfter}>{c.after || "—"}</span>
                </Box>
              ))}
            </Box>
          )}

          <Box className={classes.historyNote}>
            <IconInfoCircle size={10} />
            変更前の値は 1 世代保持します（元に戻す可能）
          </Box>
        </Box>
        <Box className={classes.footer}>
          <button
            type="button"
            className={classes.confirmBtn}
            onClick={() => onConfirm(selected)}
            disabled={changes.length === 0}
            style={changes.length === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          >
            統合する
          </button>
          <button type="button" className={classes.declineBtn} onClick={onDecline}>
            新規として登録
          </button>
        </Box>
      </Box>
    </Modal>
  );
}
