"use client";

import { useState } from "react";
import {
  ActionIcon,
  Box,
  Drawer,
  Menu,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCalendarPlus,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconShare,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import classes from "./StepDetailDrawer.module.css";
import type { StepCategory, StepSource, Information } from "@/lib/types";
import { getFixedFields, formatTimeDisplay, isInternational, formatInferredFields } from "@/lib/ocr-rules";

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
  onCancelEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
};

export function StepDetailDrawer({
  opened, onClose, draft, onChange, onSave, isEdit, editingTitle,
  sourceImageUrl, sourceImageUrls, needsReview, inferred,
  onCancelEdit, onDelete, onDuplicate,
}: Props) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [quickEdit, setQuickEdit] = useState<{ key: keyof StepDraft; value: string } | null>(null);

  const [prevOpened, setPrevOpened] = useState(false);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setMode(isEdit ? "view" : "edit");
      setPreviewExpanded(false);
      setPreviewPage(0);
      setQuickEdit(null);
    }
  }

  const commitQuickEdit = () => {
    if (!quickEdit) return;
    update({ [quickEdit.key]: quickEdit.value } as Partial<StepDraft>);
    setQuickEdit(null);
    onSave();
  };

  const update = (patch: Partial<StepDraft>) => onChange({ ...draft, ...patch });

  const categoryFields = getFixedFields(draft.category).map((f) => ({
    ...f,
    draftKey: (f.key === "startTime" ? "time" : f.key) as keyof StepDraft,
  }));

  const images = sourceImageUrls && sourceImageUrls.length > 0
    ? sourceImageUrls
    : sourceImageUrl ? [sourceImageUrl] : [];

  const isIntl = isInternational(undefined); // TODO: pass timezone

  const buildShareText = (): string => {
    const lines: string[] = [];
    lines.push(draft.title || "(無題)");
    if (draft.date) lines.push(`${draft.date}${draft.time ? ` ${draft.time}` : ""}`);
    if (draft.from || draft.to) lines.push(`${draft.from || "?"} → ${draft.to || "?"}`);
    if (draft.endDate && draft.endDate !== draft.date) lines.push(`到着: ${draft.endDate}${draft.endTime ? ` ${draft.endTime}` : ""}`);
    if (draft.confNumber) lines.push(`確認番号: ${draft.confNumber}`);
    return lines.join("\n");
  };

  const handleShare = async () => {
    const text = buildShareText();
    const title = draft.title || "toritavi 予定";
    type NavShare = { share: (d: { title?: string; text?: string }) => Promise<void> };
    const nav = typeof navigator !== "undefined" ? (navigator as Navigator & Partial<NavShare>) : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text });
        return;
      } catch { /* user cancelled or not supported */ }
    }
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(text);
      alert("予定の情報をクリップボードにコピーしました");
    } catch {
      alert(text);
    }
  };

  const handleAddToCalendar = () => {
    const dtStart = (draft.date || "").replace(/-/g, "") + (draft.time ? "T" + draft.time.replace(":", "") + "00" : "");
    const dtEnd = ((draft.endDate || draft.date) || "").replace(/-/g, "") +
      ((draft.endTime || draft.time) ? "T" + (draft.endTime || draft.time).replace(":", "") + "00" : "");
    if (!dtStart) { alert("日付が未設定のためカレンダーに追加できません"); return; }
    const summary = (draft.title || "予定").replace(/\n/g, " ");
    const description = buildShareText().replace(/\n/g, "\\n");
    const location = [draft.from, draft.to].filter(Boolean).join(" → ");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//toritavi//JP",
      "BEGIN:VEVENT",
      `UID:${Date.now()}@toritavi.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd || dtStart}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      location ? `LOCATION:${location}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.title || "toritavi"}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadImage = async (url: string, index: number) => {
    try {
      const safeTitle = (draft.title || "toritavi").replace(/[/\\?%*:|"<>]/g, "_");
      const ext = url.match(/\.(png|jpe?g|webp|gif)/i)?.[1] ?? "jpg";
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}${images.length > 1 ? `_${index + 1}` : ""}.${ext}`;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error("[drawer] download failed:", e);
    }
  };

  const handleDownloadAll = () => {
    images.forEach((u, i) => {
      setTimeout(() => downloadImage(u, i), i * 150);
    });
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="100%"
      withCloseButton={false}
      styles={{
        content: { borderRadius: "16px 16px 0 0", display: "flex", flexDirection: "column" },
        body: { padding: 0, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
      }}
    >
      {/* ヘッダー */}
      <Box className={classes.header}>
        <ActionIcon variant="subtle" color="gray" radius="xl" onClick={onClose} aria-label="閉じる">
          <IconChevronDown size={22} />
        </ActionIcon>
        <Text className={classes.headerTitle} lineClamp={1}>
          {isEdit ? editingTitle || draft.title || "予定" : "予定を追加"}
        </Text>
        {isEdit && mode === "view" ? (
          <Box className={classes.headerActions}>
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              onClick={() => setMode("edit")}
              aria-label="編集"
            >
              <IconEdit size={18} />
            </ActionIcon>
            <Menu position="bottom-end" shadow="md" width={220} withArrow>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" radius="xl" aria-label="その他">
                  <IconDotsVertical size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setMode("edit")}>編集する</Menu.Item>
                <Menu.Item leftSection={<IconShare size={16} />} onClick={handleShare}>共有する</Menu.Item>
                {onDuplicate && (
                  <Menu.Item leftSection={<IconCopy size={16} />} onClick={onDuplicate}>複製する</Menu.Item>
                )}
                <Menu.Item leftSection={<IconCalendarPlus size={16} />} onClick={handleAddToCalendar}>カレンダーに追加</Menu.Item>
                {images.length > 0 && (
                  <Menu.Item leftSection={<IconDownload size={16} />} onClick={handleDownloadAll}>
                    {images.length > 1 ? `原本を保存 (${images.length}件)` : "原本を保存"}
                  </Menu.Item>
                )}
                {onDelete && (
                  <>
                    <Menu.Divider />
                    <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={onDelete}>削除する</Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          </Box>
        ) : (
          <ActionIcon variant="subtle" color="gray" radius="xl" onClick={onClose} aria-label="閉じる">
            <IconX size={18} />
          </ActionIcon>
        )}
      </Box>

      {/* スクロール可能な本体 */}
      <Box className={classes.body}>
        {mode === "view" ? (
          <>
            {/* 1. サマリー */}
            <Box className={classes.summary}>
              <Box className={classes.summaryRow}>
                <Text className={classes.summaryLabel}>出発</Text>
                <Text className={classes.summaryValue}>
                  {draft.date || "未設定"} {draft.time || ""}
                </Text>
              </Box>
              {(draft.endTime || draft.endDate) && (
                <Box className={classes.summaryRow}>
                  <Text className={classes.summaryLabel}>到着</Text>
                  <Text className={classes.summaryValue}>
                    {draft.endDate || draft.date || ""} {draft.endTime || ""}
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

            {/* 2. 要確認バナー */}
            {needsReview && (
              <Box className={classes.reviewBanner}>
                <IconAlertTriangle size={16} />
                <Text size="xs" fw={600}>
                  {inferred && inferred.length > 0
                    ? `AIが推定した項目があります: ${formatInferredFields(inferred, draft.category)}。内容をご確認ください`
                    : "要確認: 一部の項目を読み取れませんでした"}
                </Text>
              </Box>
            )}

            {/* 3. 原本プレビュー（アコーディオン） */}
            {images.length > 0 && (
              <Box className={classes.previewSection}>
                <Box className={classes.previewHeader}>
                  <Box className={classes.previewMeta}>
                    <IconDownload size={13} />
                    <Text component="span">スキャン元{images.length > 1 ? ` · ${images.length} ページ` : ""}</Text>
                  </Box>
                  <button
                    className={classes.previewDlBtn}
                    onClick={(e) => { e.stopPropagation(); handleDownloadAll(); }}
                    aria-label="原本をダウンロード"
                    type="button"
                  >
                    <IconDownload size={15} />
                  </button>
                </Box>
                {previewExpanded ? (
                  <>
                    <Box className={classes.previewSlider}>
                      {images.length > 1 && (
                        <button className={classes.previewArrow} onClick={() => setPreviewPage((p) => Math.max(0, p - 1))} disabled={previewPage === 0}>
                          <IconChevronLeft size={18} />
                        </button>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={images[previewPage]} alt={`ページ ${previewPage + 1}`} className={classes.previewImageFull} />
                      {images.length > 1 && (
                        <button className={classes.previewArrow} onClick={() => setPreviewPage((p) => Math.min(images.length - 1, p + 1))} disabled={previewPage === images.length - 1}>
                          <IconChevronRight size={18} />
                        </button>
                      )}
                    </Box>
                    {images.length > 1 && (
                      <Text size="xs" c="dimmed" ta="center" mt={4}>{previewPage + 1} / {images.length} ページ</Text>
                    )}
                    <Text className={classes.previewToggle} onClick={() => setPreviewExpanded(false)}>閉じる</Text>
                  </>
                ) : (
                  <Box onClick={() => setPreviewExpanded(true)} style={{ cursor: "pointer" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={images[0]} alt="スキャン元" className={classes.previewImageCropped} />
                    <Text className={classes.previewToggle}>
                      <IconChevronDown size={14} /> スキャン元データを表示
                    </Text>
                  </Box>
                )}
              </Box>
            )}

            {/* 4. 固定項目 */}
            <Text className={classes.sectionLabel}>基本情報</Text>
            <Box className={classes.fieldSection}>
              <Box className={classes.fieldRow}>
                <Text className={classes.fieldLabel}>カテゴリ</Text>
                <Text className={classes.fieldValue}>{draft.category}</Text>
              </Box>
              <Box className={classes.fieldRow}>
                <Text className={classes.fieldLabel}>取り込み元</Text>
                <Text className={classes.fieldValue}>{draft.source}</Text>
              </Box>
              {categoryFields.map((f) => {
                const val = String(draft[f.draftKey] || "");
                const isEditing = quickEdit?.key === f.draftKey;
                return (
                  <Box
                    key={f.key}
                    className={`${classes.fieldRow} ${isEditing ? classes.fieldRowEditing : classes.fieldRowTappable}`}
                    onClick={() => !isEditing && isEdit && setQuickEdit({ key: f.draftKey, value: val })}
                  >
                    <Text className={classes.fieldLabel}>{f.label}</Text>
                    {isEditing ? (
                      <Box className={classes.quickEditRow} onClick={(e) => e.stopPropagation()}>
                        <TextInput
                          value={quickEdit.value}
                          onChange={(e) => setQuickEdit({ key: f.draftKey, value: e.currentTarget.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitQuickEdit();
                            if (e.key === "Escape") setQuickEdit(null);
                          }}
                          autoFocus
                          size="sm"
                          style={{ flex: 1 }}
                        />
                        <button className={classes.quickEditConfirm} onClick={commitQuickEdit} aria-label="確定" type="button">✓</button>
                        <button className={classes.quickEditCancel} onClick={() => setQuickEdit(null)} aria-label="キャンセル" type="button">✕</button>
                      </Box>
                    ) : (
                      <Text className={`${classes.fieldValue} ${!val ? classes.fieldEmpty : ""}`}>
                        {val || "未読取"}
                      </Text>
                    )}
                  </Box>
                );
              })}
            </Box>

            {/* 5. 補助項目 */}
            {draft.information.length > 0 && (
              <>
                <Text className={classes.sectionLabel}>その他の情報</Text>
                <Box className={classes.fieldSection}>
                  {draft.information.map((info) => (
                    <Box key={info.id} className={classes.fieldRow}>
                      <Text className={classes.fieldLabel}>{info.label}</Text>
                      <Text className={classes.fieldValue}>{info.value}</Text>
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </>
        ) : (
          /* 編集モード */
          <>
            <Box className={classes.fieldSection}>
              <Box className={classes.fieldRow}>
                <Box className={classes.editGrid}>
                  <Box>
                    <Text className={classes.fieldLabel}>カテゴリ</Text>
                    <Select
                      data={categories}
                      value={draft.category}
                      onChange={(v) => v && update({ category: v as StepCategory })}
                      allowDeselect={false}
                      size="sm"
                    />
                  </Box>
                  <Box>
                    <Text className={classes.fieldLabel}>取り込み元</Text>
                    <Select
                      data={sources}
                      value={draft.source}
                      onChange={(v) => v && update({ source: v as StepSource })}
                      allowDeselect={false}
                      size="sm"
                    />
                  </Box>
                </Box>
              </Box>
            </Box>

            <Box className={classes.fieldSection} style={{ marginTop: 12 }}>
              {categoryFields.map((f) => (
                <Box key={f.key} className={classes.fieldRow}>
                  <Text className={classes.fieldLabel}>{f.label}</Text>
                  <TextInput
                    placeholder={f.placeholder}
                    value={String(draft[f.draftKey] || "")}
                    onChange={(e) => update({ [f.draftKey]: e.currentTarget.value })}
                    size="sm"
                  />
                </Box>
              ))}
            </Box>

            {draft.information.length > 0 && (
              <>
                <Text className={classes.sectionLabel}>その他の情報</Text>
                <Box className={classes.fieldSection}>
                  {draft.information.map((info, i) => (
                    <Box key={info.id} className={classes.fieldRow}>
                      <Text className={classes.fieldLabel}>{info.label}</Text>
                      <TextInput
                        value={info.value}
                        onChange={(e) => {
                          const newInfo = [...draft.information];
                          newInfo[i] = { ...info, value: e.currentTarget.value };
                          update({ information: newInfo });
                        }}
                        size="sm"
                      />
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </>
        )}
      </Box>

      {/* 6. 下部固定CTA */}
      <Box className={classes.footer}>
        {mode === "view" ? (
          <button className={classes.ctaButton} onClick={() => setMode("edit")}>
            編集する
          </button>
        ) : (
          <Box className={classes.footerRow}>
            <button
              className={classes.cancelButton}
              onClick={() => {
                if (isEdit) {
                  onCancelEdit?.();
                  setMode("view");
                } else {
                  onClose();
                }
              }}
              type="button"
            >
              キャンセル
            </button>
            <button
              className={classes.ctaButton}
              onClick={onSave}
              disabled={!draft.title.trim()}
            >
              {isEdit ? "更新する" : "保存する"}
            </button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
