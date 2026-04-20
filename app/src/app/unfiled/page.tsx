"use client";

import { Box, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconInbox,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { JourneyPicker } from "@/components/JourneyPicker";
import {
  deleteUnfiledStep,
  getUnfiledSteps,
  promoteUnfiledSteps,
} from "@/lib/store-client";
import { getCategoryIcon } from "@/lib/helpers";
import type { Step } from "@/lib/types";

/**
 * /unfiled — Flow A "未整理" inbox.
 *
 * Steps with journey_id = NULL (from Supabase) live here until the
 * user promotes them into a Journey. Each row supports two actions:
 *   - 旅程に入れる → opens JourneyPicker, then promoteUnfiledSteps
 *   - 削除        → hard-delete this step row
 *
 * When the list is empty we keep the existing "まだありません" state
 * since the email-forwarded booking flow (not yet shipped) is the
 * other source of unfiled items.
 */

export default function UnfiledPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [pickerFor, setPickerFor] = useState<Step | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getUnfiledSteps();
      setSteps(list);
    } catch (e) {
      console.error("[unfiled] getUnfiledSteps failed", e);
      notifications.show({
        message: "未整理の読み込みに失敗しました",
        color: "red",
        icon: <IconAlertCircle size={18} />,
        autoClose: 4000,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handlePromote = async (journeyId: string) => {
    if (!pickerFor) return;
    const stepId = pickerFor.id;
    setPendingId(stepId);
    setPickerFor(null);
    try {
      await promoteUnfiledSteps([stepId], journeyId);
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      notifications.show({
        message: "旅程に追加しました",
        icon: <IconCheck size={18} />,
        autoClose: 3000,
        withBorder: false,
        style: { background: "var(--success-500)", color: "white" },
        styles: { icon: { color: "white", background: "transparent" } },
      });
      router.push(`/trips/${journeyId}`);
    } catch (e) {
      console.error("[unfiled] promote failed", e);
      notifications.show({
        message: e instanceof Error ? e.message : "移動に失敗しました",
        color: "red",
        icon: <IconAlertCircle size={18} />,
        autoClose: 4000,
      });
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = async (step: Step) => {
    if (!confirm(`「${step.title || "(無題)"}」を削除しますか？`)) return;
    setPendingId(step.id);
    try {
      await deleteUnfiledStep(step.id);
      setSteps((prev) => prev.filter((s) => s.id !== step.id));
    } catch (e) {
      console.error("[unfiled] delete failed", e);
      notifications.show({
        message: e instanceof Error ? e.message : "削除に失敗しました",
        color: "red",
        icon: <IconAlertCircle size={18} />,
        autoClose: 4000,
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      <AppHeader title="未整理" />
      <Box pb={110}>
        {loading && (
          <Box style={{ display: "grid", placeItems: "center", padding: "48px 0" }}>
            <Loader size="sm" />
          </Box>
        )}

        {!loading && steps.length === 0 && (
          <Box style={{ textAlign: "center", padding: "48px 32px" }}>
            <Box
              style={{
                color: "var(--text-muted)",
                marginBottom: 12,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <IconInbox size={48} />
            </Box>
            <Text fw={600} size="16px" c="gray.7" mb={4}>
              未整理のアイテムはありません
            </Text>
            <Text size="14px" c="gray.6" lh={1.6}>
              OCR 読み取り時に「未整理に保存」を選ぶと
              <br />
              ここに表示されます。
            </Text>
          </Box>
        )}

        {!loading && steps.length > 0 && (
          <Box style={{ padding: "8px 16px 0" }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                padding: "10px 4px 6px",
              }}
            >
              {steps.length} 件の未整理
            </Text>

            {steps.map((s) => (
              <Row
                key={s.id}
                step={s}
                busy={pendingId === s.id}
                onPromote={() => setPickerFor(s)}
                onDelete={() => handleDelete(s)}
              />
            ))}
          </Box>
        )}
      </Box>
      <TabBar />

      <JourneyPicker
        opened={!!pickerFor}
        primary={pickerFor}
        onBack={() => setPickerFor(null)}
        onCancel={() => setPickerFor(null)}
        onPick={handlePromote}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Row({
  step,
  busy,
  onPromote,
  onDelete,
}: {
  step: Step;
  busy: boolean;
  onPromote: () => void;
  onDelete: () => void;
}) {
  const Icon = getCategoryIcon(step.category ?? "その他");
  return (
    <Box
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 12,
        marginBottom: 8,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Box style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Box
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: "var(--n-100)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            color: "var(--ink-800)",
          }}
        >
          <Icon size={20} />
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {step.title || "(無題のステップ)"}
          </Text>
          <Text style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
            {formatSubtitle(step)}
          </Text>
        </Box>
      </Box>

      <Box style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={onPromote}
          disabled={busy}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 999,
            background: "var(--ink-800)",
            color: "#fff",
            border: "none",
            fontSize: 13,
            fontWeight: 700,
            cursor: busy ? "progress" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontFamily: "inherit",
          }}
        >
          <IconPlus size={14} />
          旅程に入れる
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label="削除"
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            background: "transparent",
            color: "var(--text-dim)",
            border: "1px solid var(--border)",
            cursor: busy ? "progress" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "inherit",
          }}
        >
          <IconTrash size={14} />
        </button>
      </Box>
    </Box>
  );
}

function formatSubtitle(s: Step): string {
  const parts: string[] = [];
  if (s.date) parts.push(s.date);
  if (s.time) parts.push(s.time);
  if (s.from && s.to) parts.push(`${s.from} → ${s.to}`);
  else if (s.to) parts.push(s.to);
  else if (s.from) parts.push(s.from);
  return parts.length > 0 ? parts.join(" · ") : s.category ?? "";
}
