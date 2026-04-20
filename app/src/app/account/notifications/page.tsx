"use client";

import { useEffect, useState } from "react";
import { Box, Loader, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { getSettings, updateSettings } from "@/lib/store-settings";
import type { NotificationPrefs } from "@/lib/types";

/*
 * /account/notifications — DS v2 §5 (account-subpages.html)
 * 即時保存方式。CTA bar なし、最下部に「すべての通知をオフにする」。
 * 書き込み先は user_settings.notification_prefs (JSONB)。
 * ゲストモードは localStorage に保存 (通知は実配信しないが UX 一貫性のため)。
 */

type Category = keyof NotificationPrefs;

type ToggleDef = {
  key: string;
  label: string;
  sub: string;
};

type SectionDef = {
  key: Category;
  title: string;
  items: ToggleDef[];
};

const SECTIONS: SectionDef[] = [
  {
    key: "tripReminders",
    title: "旅程リマインド",
    items: [
      { key: "dayBefore", label: "出発前日の通知", sub: "前日 21:00 に明日の予定を通知" },
      { key: "hourBefore", label: "出発1時間前", sub: "移動開始のリマインド" },
      { key: "checkIn", label: "ホテル チェックイン", sub: "チェックイン可能時刻をお知らせ" },
    ],
  },
  {
    key: "changes",
    title: "変更通知",
    items: [
      { key: "delayCancel", label: "遅延・欠航", sub: "フライト/列車の運行情報" },
      { key: "bookingChange", label: "予約の変更", sub: "時刻・ゲートなどの更新" },
    ],
  },
  {
    key: "documents",
    title: "書類・OCR",
    items: [
      { key: "needsReview", label: "要確認の書類", sub: "OCR が一部読み取れなかった時" },
      { key: "ocrDone", label: "取り込み完了", sub: "メール取込が正常終了した時" },
    ],
  },
  {
    key: "announcements",
    title: "お知らせ",
    items: [{ key: "updates", label: "アップデート情報", sub: "新機能や改善のお知らせ" }],
  },
];

// Sensible defaults — matches the "on" marks on the mock (J/I).
const DEFAULTS: NotificationPrefs = {
  tripReminders: { dayBefore: true, hourBefore: true, checkIn: false },
  changes: { delayCancel: true, bookingChange: true },
  documents: { needsReview: true, ocrDone: false },
  announcements: { updates: false },
};

function readFlag(prefs: NotificationPrefs, section: Category, key: string): boolean {
  const cat = (prefs[section] ?? {}) as Record<string, boolean | undefined>;
  if (cat[key] !== undefined) return !!cat[key];
  const def = (DEFAULTS[section] ?? {}) as Record<string, boolean | undefined>;
  return !!def[key];
}

function writeFlag(
  prefs: NotificationPrefs,
  section: Category,
  key: string,
  value: boolean
): NotificationPrefs {
  const cat = { ...(prefs[section] ?? {}) } as Record<string, boolean>;
  cat[key] = value;
  return { ...prefs, [section]: cat } as NotificationPrefs;
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<NotificationPrefs>({});

  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings();
        setPrefs(s.notificationPrefs ?? {});
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = async (section: Category, key: string, value: boolean) => {
    const next = writeFlag(prefs, section, key, value);
    setPrefs(next);
    try {
      await updateSettings({ notificationPrefs: next });
    } catch (e) {
      console.error("[notifications] save failed", e);
      notifications.show({
        color: "red",
        message: "設定の保存に失敗しました。通信環境を確認してもう一度お試しください。",
      });
      // Revert optimistic update
      setPrefs(prefs);
    }
  };

  const allOff = async () => {
    const next: NotificationPrefs = {};
    for (const section of SECTIONS) {
      const cat: Record<string, boolean> = {};
      for (const item of section.items) cat[item.key] = false;
      (next as Record<string, unknown>)[section.key] = cat;
    }
    setPrefs(next);
    try {
      await updateSettings({ notificationPrefs: next });
      notifications.show({ message: "すべての通知をオフにしました" });
    } catch (e) {
      console.error("[notifications] bulk-off failed", e);
      notifications.show({
        color: "red",
        message: "設定の保存に失敗しました。",
      });
      setPrefs(prefs);
    }
  };

  return (
    <>
      <AppHeader title="通知設定" back backHref="/account" />
      <Box pb={110}>
        <Box style={{ padding: "14px 16px 4px" }}>
          <Text size="sm" c="dimmed" lh={1.6}>
            受け取りたい通知を選択してください。変更は即時反映されます。
          </Text>
        </Box>

        {loading ? (
          <Box style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader size="sm" />
          </Box>
        ) : (
          <>
            {SECTIONS.map((section) => (
              <Box key={section.key}>
                <Text
                  size="11px"
                  fw={700}
                  c="gray.6"
                  tt="uppercase"
                  lts={0.5}
                  style={{ padding: "16px 16px 8px" }}
                >
                  {section.title}
                </Text>
                <Box
                  style={{
                    background: "white",
                    margin: "0 16px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    overflow: "hidden",
                  }}
                >
                  {section.items.map((item, idx) => (
                    <Box
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: 14,
                        borderBottom:
                          idx === section.items.length - 1
                            ? "none"
                            : "1px solid var(--n-100)",
                      }}
                    >
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={600} size="15px" lh={1.35}>
                          {item.label}
                        </Text>
                        <Text size="12px" c="dimmed" mt={2}>
                          {item.sub}
                        </Text>
                      </Box>
                      <Switch
                        checked={readFlag(prefs, section.key, item.key)}
                        onChange={(e) =>
                          toggle(section.key, item.key, e.currentTarget.checked)
                        }
                        size="md"
                        color="blue"
                      />
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}

            <Box style={{ padding: "8px 16px 16px" }}>
              <button
                type="button"
                onClick={allOff}
                style={{
                  width: "100%",
                  height: 40,
                  borderRadius: 10,
                  background: "white",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                すべての通知をオフにする
              </button>
            </Box>
          </>
        )}
      </Box>
      <TabBar />
    </>
  );
}
