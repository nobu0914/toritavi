"use client";

import { Drawer } from "@mantine/core";
import {
  IconCalendar,
  IconChevronRight,
  IconInbox,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import type { Step } from "@/lib/types";

/**
 * DestinationSelector — Flow A's 3-way branch.
 *
 * Shown after ScanFlow has a complete primary Step ready to commit,
 * but BEFORE the write happens. The user picks one of:
 *   - new      : create a brand new Journey, seed with these steps
 *   - existing : route to <JourneyPicker> (parent handles next screen)
 *   - unfiled  : park in the unfiled inbox (journey_id = NULL)
 *
 * The parent owns all navigation and persistence. This component just
 * renders the prompt and returns the choice.
 */

type Props = {
  opened: boolean;
  /** Primary step — used only for the preview header. */
  primary: Step | null;
  onCancel: () => void;
  onChoose: (mode: "new" | "existing" | "unfiled") => void;
};

export function DestinationSelector({ opened, primary, onCancel, onChoose }: Props) {
  return (
    <Drawer
      opened={opened}
      onClose={onCancel}
      position="bottom"
      size="auto"
      padding={0}
      withCloseButton={false}
      radius="lg"
      overlayProps={{ opacity: 0.55, blur: 2 }}
      trapFocus
      styles={{
        content: { maxHeight: "92vh" },
        body: { padding: 0 },
      }}
      removeScrollProps={{ gapMode: "padding" }}
    >
      {/* ===================== header ===================== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px 10px",
          borderBottom: "1px solid var(--n-100)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>登録先を選ぶ</div>
        <button
          type="button"
          aria-label="閉じる"
          onClick={onCancel}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-dim)",
            display: "inline-flex",
            padding: 4,
            cursor: "pointer",
          }}
        >
          <IconX size={20} />
        </button>
      </div>

      {/* ===================== OCR preview card ===================== */}
      {primary && (
        <div style={{ padding: "12px 16px 0" }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {primary.title || "読み取り結果"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                {formatPreviewLine(primary)}
              </div>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                background: "var(--accent-50)",
                color: "var(--accent-700)",
                border: "1px solid var(--accent-100)",
                flexShrink: 0,
              }}
            >
              OCR
            </span>
          </div>
        </div>
      )}

      {/* ===================== choices ===================== */}
      <div style={{ padding: "14px 16px 16px" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "var(--text-dim)",
            textTransform: "uppercase",
            letterSpacing: 1,
            padding: "0 2px 8px",
          }}
        >
          どこに入れますか？
        </div>

        <Choice
          icon={<IconPlus size={20} />}
          iconBg="var(--ink-800)"
          iconFg="#fff"
          title="新しい旅程を作る"
          hint="仮タイトル付きで下書き開始"
          recommended
          onClick={() => onChoose("new")}
        />
        <Choice
          icon={<IconCalendar size={20} />}
          iconBg="var(--accent-50)"
          iconFg="var(--accent-700)"
          title="既存の旅程に追加"
          hint="日付の近い候補から選ぶ"
          onClick={() => onChoose("existing")}
        />
        <Choice
          icon={<IconInbox size={20} />}
          iconBg="var(--n-100)"
          iconFg="var(--ink-800)"
          title="未整理に保存"
          hint="あとで旅程に振り分け"
          onClick={() => onChoose("unfiled")}
        />
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */

function Choice({
  icon,
  iconBg,
  iconFg,
  title,
  hint,
  recommended,
  onClick,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconFg: string;
  title: string;
  hint: string;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        marginBottom: 8,
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 14,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        boxShadow: recommended ? "0 0 0 2px rgba(15,27,45,0.08)" : undefined,
        borderColor: recommended ? "var(--ink-800)" : "var(--border)",
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: iconBg,
          color: iconFg,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          {title}
        </span>
        <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
          {hint}
        </span>
      </span>
      <IconChevronRight size={18} color="var(--text-dim)" />
    </button>
  );
}

function formatPreviewLine(s: Step): string {
  const parts: string[] = [];
  if (s.date) parts.push(s.date);
  if (s.time) parts.push(s.time);
  if (s.from && s.to) parts.push(`${s.from} → ${s.to}`);
  else if (s.from) parts.push(s.from);
  else if (s.to) parts.push(s.to);
  return parts.join(" · ");
}
