"use client";

import { useState } from "react";
import {
  ActionIcon,
  Box,
  Modal,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconX } from "@tabler/icons-react";
import classes from "./StepEditModal.module.css";
import type { StepCategory, StepSource } from "@/lib/types";

const categories: StepCategory[] = [
  "列車",
  "飛行機",
  "バス",
  "車",
  "徒歩",
  "宿泊",
  "商談",
  "食事",
  "観光",
  "病院",
  "その他",
];

const sources: StepSource[] = ["撮影", "アップロード", "メール", "手入力"];

export type StepDraft = {
  category: StepCategory;
  source: StepSource;
  title: string;
  time: string;
  detail: string;
  confNumber: string;
};

export function emptyStepDraft(): StepDraft {
  return { category: "列車", source: "手入力", title: "", time: "", detail: "", confNumber: "" };
}

type Props = {
  opened: boolean;
  onClose: () => void;
  draft: StepDraft;
  onChange: (draft: StepDraft) => void;
  onSave: () => void;
  isEdit: boolean;
  editingTitle?: string;
  sourceImageUrl?: string;
};

export function StepEditModal({
  opened,
  onClose,
  draft,
  onChange,
  onSave,
  isEdit,
  editingTitle,
  sourceImageUrl,
}: Props) {
  const [editing, setEditing] = useState(!isEdit);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const [prevOpened, setPrevOpened] = useState(false);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setEditing(!isEdit);
      setPreviewExpanded(false);
    }
  }

  const update = (patch: Partial<StepDraft>) =>
    onChange({ ...draft, ...patch });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="md"
      withCloseButton={false}
      styles={{
        content: {
          borderRadius: 12,
          maxHeight: "min(90vh, 820px)",
          display: "flex",
          flexDirection: "column",
          overflow: "visible",
        },
        body: {
          padding: 0,
          background: "var(--mantine-color-gray-0)",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "visible",
        },
      }}
    >
      <Box className={classes.panel}>
        <Box className={classes.top}>
          <Box style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Text className={classes.topTitle}>
              {isEdit ? editingTitle || "ステップ" : "ステップを追加"}
            </Text>
            {!isEdit && (
              <Text style={{ fontSize: 9, color: "var(--mantine-color-gray-4)", fontWeight: 600 }}>
                新規モーダル
              </Text>
            )}
          </Box>
          <ActionIcon variant="subtle" color="gray" radius="xl" onClick={onClose}>
            <IconX size={18} />
          </ActionIcon>
        </Box>
        <Box className={classes.body}>
          {/* スキャン元アコーディオンプレビュー */}
          {sourceImageUrl && (
            <Box
              className={classes.sourceAccordion}
              onClick={() => setPreviewExpanded((v) => !v)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceImageUrl}
                alt="スキャン元"
                className={classes.sourceImage}
                style={{ height: previewExpanded ? "auto" : 60 }}
              />
              <Box className={classes.sourceToggle}>
                {previewExpanded ? (
                  <><IconChevronUp size={14} />閉じる</>
                ) : (
                  <><IconChevronDown size={14} />スキャン元データを表示</>
                )}
              </Box>
            </Box>
          )}

          <Box className={classes.formSection} key={editing ? "editing" : "readonly"}>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>カテゴリ</Text>
              {editing ? (
                <Select
                  classNames={{ input: classes.fieldInput }}
                  data={categories}
                  value={draft.category}
                  onChange={(value) =>
                    value && update({ category: value as StepCategory })
                  }
                  allowDeselect={false}
                />
              ) : (
                <Text className={classes.readOnlyValue}>{draft.category || "未設定"}</Text>
              )}
            </Box>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>取り込み元</Text>
              {editing ? (
                <Select
                  classNames={{ input: classes.fieldInput }}
                  data={sources}
                  value={draft.source}
                  onChange={(value) =>
                    value && update({ source: value as StepSource })
                  }
                  allowDeselect={false}
                />
              ) : (
                <Text className={classes.readOnlyValue}>{draft.source || "未設定"}</Text>
              )}
            </Box>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>タイトル</Text>
              {editing ? (
                <TextInput
                  classNames={{ input: classes.fieldInput }}
                  placeholder="例: のぞみ 225号"
                  value={draft.title}
                  onChange={(e) => update({ title: e.currentTarget.value })}
                  required
                />
              ) : (
                <Text className={classes.readOnlyValue}>{draft.title || "未設定"}</Text>
              )}
            </Box>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>詳細・場所</Text>
              {editing ? (
                <TextInput
                  classNames={{ input: classes.fieldInput }}
                  placeholder="例: 東京 → 新大阪"
                  value={draft.detail}
                  onChange={(e) => update({ detail: e.currentTarget.value })}
                />
              ) : (
                <Text className={classes.readOnlyValue}>{draft.detail || "未設定"}</Text>
              )}
            </Box>
            <Box className={classes.formRow}>
              <Box className={classes.dateGrid}>
                <Box>
                  <Text className={classes.formLabel}>時刻</Text>
                  {editing ? (
                    <TextInput
                      classNames={{ input: classes.fieldInput }}
                      placeholder="10:00"
                      value={draft.time}
                      onChange={(e) => update({ time: e.currentTarget.value })}
                    />
                  ) : (
                    <Text className={classes.readOnlyValue}>{draft.time || "未設定"}</Text>
                  )}
                </Box>
                <Box>
                  <Text className={classes.formLabel}>確認番号</Text>
                  {editing ? (
                    <TextInput
                      classNames={{ input: classes.fieldInput }}
                      placeholder="TK-882541"
                      value={draft.confNumber}
                      onChange={(e) => update({ confNumber: e.currentTarget.value })}
                    />
                  ) : (
                    <Text className={classes.readOnlyValue}>{draft.confNumber || "未設定"}</Text>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
        <Box className={classes.footer}>
          <button
            className={classes.saveButton}
            onClick={editing ? onSave : () => setEditing(true)}
            disabled={editing && !draft.title.trim()}
          >
            {editing ? (isEdit ? "更新" : "保存") : "編集する"}
          </button>
        </Box>
      </Box>
    </Modal>
  );
}
