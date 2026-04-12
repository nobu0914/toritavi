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
import type { StepCategory, StepSource, Information } from "@/lib/types";
import { getFixedFields } from "@/lib/ocr-rules";

const categories: StepCategory[] = [
  "列車", "飛行機", "バス", "車", "徒歩",
  "宿泊", "商談", "食事", "観光", "病院", "その他",
];

const sources: StepSource[] = ["撮影", "アップロード", "メール", "手入力"];

export type StepDraft = {
  category: StepCategory;
  source: StepSource;
  title: string;
  date: string;
  endDate: string;
  time: string;
  endTime: string;
  from: string;
  to: string;
  confNumber: string;
  information: Information[];
};

export function emptyStepDraft(): StepDraft {
  return {
    category: "列車", source: "手入力",
    title: "", date: "", endDate: "", time: "", endTime: "",
    from: "", to: "", confNumber: "", information: [],
  };
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
  opened, onClose, draft, onChange, onSave, isEdit, editingTitle, sourceImageUrl,
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

  const update = (patch: Partial<StepDraft>) => onChange({ ...draft, ...patch });

  // カテゴリに応じた固定項目（ocr-rulesから取得）
  // key名のマッピング: startTime→time（StepDraft互換）
  const categoryFields = getFixedFields(draft.category).map((f) => ({
    ...f,
    draftKey: (f.key === "startTime" ? "time" : f.key) as keyof StepDraft,
  }));

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

          {/* カテゴリ・取り込み元 */}
          <Box className={classes.formSection}>
            <Box className={classes.formRow}>
              <Box className={classes.dateGrid}>
                <Box>
                  <Text className={classes.formLabel}>カテゴリ</Text>
                  {editing ? (
                    <Select
                      classNames={{ input: classes.fieldInput }}
                      data={categories}
                      value={draft.category}
                      onChange={(value) => value && update({ category: value as StepCategory })}
                      allowDeselect={false}
                    />
                  ) : (
                    <Text className={classes.readOnlyValue}>{draft.category}</Text>
                  )}
                </Box>
                <Box>
                  <Text className={classes.formLabel}>取り込み元</Text>
                  {editing ? (
                    <Select
                      classNames={{ input: classes.fieldInput }}
                      data={sources}
                      value={draft.source}
                      onChange={(value) => value && update({ source: value as StepSource })}
                      allowDeselect={false}
                    />
                  ) : (
                    <Text className={classes.readOnlyValue}>{draft.source}</Text>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>

          {/* カテゴリ別固定項目 */}
          <Box className={classes.formSection} style={{ marginTop: 12 }}>
            {categoryFields.map((f) => {
              const val = String(draft[f.draftKey] || "");
              return (
                <Box key={f.key} className={classes.formRow}>
                  <Text className={classes.formLabel}>{f.label}</Text>
                  {editing ? (
                    <TextInput
                      classNames={{ input: classes.fieldInput }}
                      placeholder={f.placeholder}
                      value={val}
                      onChange={(e) => update({ [f.draftKey]: e.currentTarget.value })}
                    />
                  ) : (
                    <Text className={classes.readOnlyValue}>
                      {val || <span style={{ color: "var(--mantine-color-gray-4)", fontStyle: "italic" }}>未読取</span>}
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>

          {/* 変動項目（information） */}
          {draft.information.length > 0 && (
            <>
              <Text size="xs" fw={600} c="dimmed" mt="md" mb={6}>その他の情報</Text>
              <Box className={classes.formSection}>
                {draft.information.map((info, i) => (
                  <Box key={info.id} className={classes.formRow}>
                    <Text className={classes.formLabel}>{info.label}</Text>
                    {editing ? (
                      <TextInput
                        classNames={{ input: classes.fieldInput }}
                        value={info.value}
                        onChange={(e) => {
                          const newInfo = [...draft.information];
                          newInfo[i] = { ...info, value: e.currentTarget.value };
                          update({ information: newInfo });
                        }}
                      />
                    ) : (
                      <Text className={classes.readOnlyValue}>{info.value || "未設定"}</Text>
                    )}
                  </Box>
                ))}
              </Box>
            </>
          )}
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
