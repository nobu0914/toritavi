"use client";

import { useState } from "react";
import {
  Box,
  Drawer,
  Menu,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconCalendarPlus,
  IconCopy,
  IconDownload,
  IconEdit,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import classes from "./StepDetailDrawer.module.css";
import type { StepCategory, StepSource, Information, StepStatus } from "@/lib/types";
import { getFixedFields } from "@/lib/ocr-rules";
import { Ticket } from "./Ticket";
import { SheetHeader } from "./SheetHeader";

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
  airline: string;
  confNumber: string;
  information: Information[];
  memo?: string;
};

export function emptyStepDraft(): StepDraft {
  return {
    category: "列車", source: "手入力",
    title: "", date: "", endDate: "", time: "", endTime: "",
    from: "", to: "", airline: "", confNumber: "", information: [],
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
  status?: StepStatus;
  onCancelEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
};

export function StepDetailDrawer({
  opened, onClose, draft, onChange, onSave, isEdit, editingTitle,
  sourceImageUrl, sourceImageUrls, needsReview, inferred, status,
  onCancelEdit, onDelete, onDuplicate,
}: Props) {
  const [mode, setMode] = useState<"view" | "edit">("view");

  const [prevOpened, setPrevOpened] = useState(false);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setMode(isEdit ? "view" : "edit");
    }
  }

  const update = (patch: Partial<StepDraft>) => onChange({ ...draft, ...patch });

  const categoryFields = getFixedFields(draft.category).map((f) => ({
    ...f,
    draftKey: (f.key === "startTime" ? "time" : f.key) as keyof StepDraft,
  }));

  const images = sourceImageUrls && sourceImageUrls.length > 0
    ? sourceImageUrls
    : sourceImageUrl ? [sourceImageUrl] : [];

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

  // ヘッダー ⋮ と下部「操作する」で同じ項目を出すため共通化。
  const actionMenuItems = (
    <>
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
    </>
  );

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="100%"
      withCloseButton={false}
      /* TabBar (z-index: 200) を確実に覆うため 400 に引き上げ。 */
      zIndex={400}
      styles={{
        content: {
          borderRadius: "20px 20px 0 0",
          display: "flex",
          flexDirection: "column",
        },
        body: { padding: 0, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
      }}
    >
      {/* View モードはヘッダーを廃止（Ticket が浮き出てくるカード UI）。
          閉じる → 下部「閉じる」、メニュー → 下部「操作する」で代替。 */}
      {mode === "view" ? null : (
        <SheetHeader
          title={isEdit ? editingTitle || draft.title || "予定" : "予定を追加"}
          onClose={onClose}
          leftIcon="down"
        />
      )}

      {/* スクロール可能な本体 */}
      <Box className={classes.body} data-mode={mode}>
        {mode === "view" ? (
          <>
            <Ticket
              data={{
                category: draft.category,
                source: draft.source,
                title: draft.title,
                date: draft.date,
                endDate: draft.endDate,
                time: draft.time,
                endTime: draft.endTime,
                from: draft.from,
                to: draft.to,
                airline: draft.airline,
                confNumber: draft.confNumber,
                information: draft.information,
                memo: draft.memo,
              }}
              status={status}
              needsReview={needsReview}
              inferred={inferred}
              sourceImageUrl={sourceImageUrl}
              sourceImageUrls={sourceImageUrls}
              onCopyMailBody={async () => {
                if (!draft.memo) return;
                try { await navigator.clipboard.writeText(draft.memo); } catch { /* ignore */ }
              }}
            />
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
          <Box className={classes.footerRow}>
            <button className={classes.closeButton} onClick={onClose} type="button">
              閉じる
            </button>
            <Menu position="top-end" shadow="md" width={220} withArrow zIndex={500}>
              <Menu.Target>
                <button className={classes.ctaButton} type="button" aria-label="操作メニューを開く">
                  操作する
                </button>
              </Menu.Target>
              <Menu.Dropdown>{actionMenuItems}</Menu.Dropdown>
            </Menu>
          </Box>
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
