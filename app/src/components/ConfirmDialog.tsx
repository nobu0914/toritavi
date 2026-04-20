"use client";

import { useEffect, useState } from "react";
import { Modal, TextInput } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

/**
 * Shared confirm dialog used across destructive / important flows on
 * /account/*. Three severities cover the mock requirements:
 *
 *   - "default"  軽めの確認 (ログアウト 等)
 *   - "danger"   danger icon 付き、不可逆操作 (端末キャッシュ削除 / 全旅程削除)
 *   - "type"     最上位破壊操作。"削除" と入力しないと confirm が押せない
 *               (アカウント削除)
 *
 * DS v2 準拠: 赤塗りではなく danger-50 + danger ink の控えめなトーン。
 */

type Severity = "default" | "danger" | "type";

type Props = {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  severity?: Severity;
  /** severity="type" のとき入力させるキーワード。一致しないと確定不可。 */
  typeToken?: string;
};

export function ConfirmDialog({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "実行",
  cancelLabel = "キャンセル",
  severity = "default",
  typeToken = "削除",
}: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) {
      setTyped("");
      setBusy(false);
    }
  }, [opened]);

  const danger = severity !== "default";
  const typeMode = severity === "type";
  const canConfirm = !busy && (!typeMode || typed.trim() === typeToken);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      // caller typically closes the dialog itself; defensively reset busy
      // in case the caller keeps the dialog open for an error state.
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={busy ? () => {} : onClose}
      centered
      withCloseButton={false}
      radius="md"
      padding={0}
      size="sm"
      styles={{
        content: { overflow: "hidden" },
        body: { padding: 0 },
      }}
    >
      <div
        style={{
          background: danger ? "var(--danger-50)" : "white",
          padding: "20px 20px 14px",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        {danger && (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--danger-500)",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconAlertTriangle size={18} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            {title}
          </div>
          {message && (
            <div
              style={{
                fontSize: 13,
                color: "var(--text-dim)",
                marginTop: 6,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {message}
            </div>
          )}
        </div>
      </div>

      {typeMode && (
        <div style={{ padding: "0 20px 16px", background: "var(--danger-50)" }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>
            確認のため <strong style={{ color: "var(--danger-700)" }}>{typeToken}</strong> と入力してください
          </div>
          <TextInput
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            placeholder={typeToken}
            autoFocus
            size="sm"
          />
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "12px 16px 16px",
          borderTop: "1px solid var(--border)",
          background: "white",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            background: "var(--surface)",
            color: "var(--text-dim)",
            border: "1px solid var(--border)",
            fontSize: 15,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            background: danger ? "var(--danger-500)" : "var(--info-700)",
            color: "white",
            border: "none",
            fontSize: 15,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: canConfirm ? "pointer" : "not-allowed",
            opacity: canConfirm ? 1 : 0.5,
          }}
        >
          {busy ? "処理中…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
