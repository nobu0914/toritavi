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
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import classes from "./StepEditModal.module.css";
import type { StepCategory, StepSource, Information } from "@/lib/types";
import { getFixedFields, formatTimeDisplay, isInternational } from "@/lib/ocr-rules";
import { IconAlertTriangle } from "@tabler/icons-react";

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
  sourceImageUrls?: string[];
  needsReview?: boolean;
  inferred?: string[];
};

export function StepEditModal({
  opened, onClose, draft, onChange, onSave, isEdit, editingTitle, sourceImageUrl, sourceImageUrls,
  needsReview, inferred,
}: Props) {
  const [editing, setEditing] = useState(!isEdit);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);

  const [prevOpened, setPrevOpened] = useState(false);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setEditing(!isEdit);
      setPreviewExpanded(false);
      setPreviewPage(0);
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
          background: "var(--n-50)",
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
          {/* スキャン元プレビュー */}
          {(() => {
            const images = sourceImageUrls && sourceImageUrls.length > 0 ? sourceImageUrls : sourceImageUrl ? [sourceImageUrl] : [];
            if (images.length === 0) return null;
            return previewExpanded ? (
              <Box className={classes.sourceAccordion}>
                <Box className={classes.sourceSlider}>
                  {images.length > 1 && (
                    <button
                      className={classes.sourceArrow}
                      onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                      disabled={previewPage === 0}
                    >
                      <IconChevronLeft size={18} />
                    </button>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={images[previewPage]}
                    alt={`ページ ${previewPage + 1}`}
                    className={classes.sourceImageFull}
                  />
                  {images.length > 1 && (
                    <button
                      className={classes.sourceArrow}
                      onClick={() => setPreviewPage((p) => Math.min(images.length - 1, p + 1))}
                      disabled={previewPage === images.length - 1}
                    >
                      <IconChevronRight size={18} />
                    </button>
                  )}
                </Box>
                {images.length > 1 && (
                  <Text size="xs" c="dimmed" ta="center" mt={4}>
                    {previewPage + 1} / {images.length} ページ
                  </Text>
                )}
                <Box className={classes.sourceToggle} onClick={() => setPreviewExpanded(false)}>
                  閉じる
                </Box>
              </Box>
            ) : (
              <Box className={classes.sourceAccordion}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={images[0]}
                  alt="スキャン元"
                  className={classes.sourceImage}
                  style={{ height: 60 }}
                />
                <Box className={classes.sourceToggle} onClick={() => setPreviewExpanded(true)}>
                  <IconChevronDown size={14} />
                  スキャン元データを表示
                </Box>
              </Box>
            );
          })()}

          {/* サマリーカード（閲覧モード） */}
          {isEdit && !editing && (
            <Box className={classes.summaryCard}>
              <Box className={classes.summaryRow}>
                <Text className={classes.summaryLabel}>出発</Text>
                <Text className={classes.summaryValue}>
                  {draft.date || "未設定"} {formatTimeDisplay(draft.time, { timezone: undefined, compact: true })}
                  {isInternational(undefined) ? "" : ""}
                </Text>
              </Box>
              {draft.endTime && (
                <Box className={classes.summaryRow}>
                  <Text className={classes.summaryLabel}>到着</Text>
                  <Text className={classes.summaryValue}>
                    {draft.endDate || draft.date || ""} {formatTimeDisplay(draft.endTime, { compact: true })}
                    {draft.endDate && draft.date && draft.endDate !== draft.date ? "（翌日）" : ""}
                  </Text>
                </Box>
              )}
              {(draft.from || draft.to) && (
                <Box className={classes.summaryRow}>
                  <Text className={classes.summaryLabel}>区間</Text>
                  <Text className={classes.summaryValue}>
                    {[draft.from, draft.to].filter(Boolean).join(" → ")}
                  </Text>
                </Box>
              )}
              {draft.confNumber && (
                <Box className={classes.summaryRow}>
                  <Text className={classes.summaryLabel}>確認番号</Text>
                  <Text className={classes.summaryValue} style={{ fontFamily: "monospace" }}>
                    {draft.confNumber}
                  </Text>
                </Box>
              )}
            </Box>
          )}

          {/* 要確認バナー */}
          {needsReview && (
            <Box className={classes.reviewBanner}>
              <IconAlertTriangle size={16} />
              <Text size="xs" fw={600}>
                要確認{inferred && inferred.length > 0 ? `: ${inferred.join(", ")}` : ""}
              </Text>
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
                      {val || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>未読取</span>}
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
