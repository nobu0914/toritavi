"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Loader,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconInfoCircle } from "@tabler/icons-react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { createClient } from "@/lib/supabase-browser";
import { isGuestMode } from "@/lib/guest";
import { getSettings, updateSettings } from "@/lib/store-settings";
import type { UserSettings } from "@/lib/types";

/*
 * /account/profile — DS v2 §3 (account-subpages.html)
 * 基本情報 + 旅程サポート項目。フォーム末尾に保存 CTA 固定。
 *   - ログイン済み: 全フィールド + "保存する" (Supabase upsert)
 *   - ゲスト: 表示名 / TZ / 出発地 のみ + 黄色バナー + "無料で会員登録する"
 *
 * 画像アップロード / トリミングは Phase 6 で本ページに追加する。
 */

// DS v2 で common Japanese + international TZ を想定した最小セット。
const TZ_OPTIONS = [
  { value: "Asia/Tokyo", label: "Asia/Tokyo (GMT+9)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (GMT+9)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (GMT+8)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (GMT+8)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (GMT+7)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GMT+4)" },
  { value: "Europe/London", label: "Europe/London (GMT+0/+1)" },
  { value: "Europe/Paris", label: "Europe/Paris (GMT+1/+2)" },
  { value: "America/New_York", label: "America/New_York (GMT-5/-4)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (GMT-8/-7)" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu (GMT-10)" },
];

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [form, setForm] = useState<UserSettings>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const guest = isGuestMode();
    setIsGuest(guest);
    (async () => {
      try {
        if (!guest) {
          const sb = createClient();
          const { data: { user } } = await sb.auth.getUser();
          setEmail(user?.email ?? null);
        }
        const s = await getSettings();
        setForm(s);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const patch = (p: Partial<UserSettings>) => {
    setForm((cur) => ({ ...cur, ...p }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Restrict what we send over per variant. Guest has no email/
      // avatar to worry about (the store layer also drops avatarUrl
      // defensively for guests).
      const payload: Partial<UserSettings> = {
        displayName: form.displayName ?? "",
        timezone: form.timezone ?? "",
        defaultOrigin: form.defaultOrigin ?? "",
      };
      if (!isGuest) payload.emergencyContact = form.emergencyContact ?? "";
      await updateSettings(payload);
      setDirty(false);
      notifications.show({ message: "保存しました" });
    } catch (e) {
      console.error("[profile] save failed", e);
      notifications.show({ color: "red", message: "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AppHeader title="プロフィール設定" back backHref="/account" />
      <Box pb={110} style={{ paddingBottom: 110 + 72 /* room for fixed CTA */ }}>
        {loading ? (
          <Box style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader size="sm" />
          </Box>
        ) : isGuest ? (
          <>
            <GuestBanner />
            <Box style={{ padding: "14px 16px 4px" }}>
              <Text size="sm" c="dimmed" lh={1.6}>
                端末内のみに保存されます。本登録するとクラウドに同期されます。
              </Text>
            </Box>
            <SectionLabel>基本情報</SectionLabel>
            <Card>
              <Field label="表示名">
                <TextInput
                  value={form.displayName ?? ""}
                  onChange={(e) => patch({ displayName: e.currentTarget.value })}
                  placeholder="端末内のみに保存"
                  variant="unstyled"
                />
              </Field>
              <Field label="タイムゾーン">
                <Select
                  data={TZ_OPTIONS}
                  value={form.timezone ?? null}
                  onChange={(v) => patch({ timezone: v ?? "" })}
                  placeholder="選択してください"
                  variant="unstyled"
                  searchable
                />
              </Field>
              <Field label="よく使う出発地" last>
                <TextInput
                  value={form.defaultOrigin ?? ""}
                  onChange={(e) => patch({ defaultOrigin: e.currentTarget.value })}
                  placeholder="例: 東京駅, 羽田空港"
                  variant="unstyled"
                />
              </Field>
            </Card>
          </>
        ) : (
          <>
            <Box style={{ padding: "14px 16px 4px" }}>
              <Text size="sm" c="dimmed" lh={1.6}>
                アプリ内で表示されるあなたの情報を管理します。
              </Text>
            </Box>
            <SectionLabel>基本情報</SectionLabel>
            <Card>
              <Field label="表示名">
                <TextInput
                  value={form.displayName ?? ""}
                  onChange={(e) => patch({ displayName: e.currentTarget.value })}
                  placeholder="例: 田中 太郎"
                  variant="unstyled"
                />
              </Field>
              <Field label="メールアドレス" hint="ログイン ID のため変更不可">
                <TextInput
                  value={email ?? ""}
                  readOnly
                  variant="unstyled"
                />
              </Field>
              <Field label="タイムゾーン" last>
                <Select
                  data={TZ_OPTIONS}
                  value={form.timezone ?? null}
                  onChange={(v) => patch({ timezone: v ?? "" })}
                  placeholder="選択してください"
                  variant="unstyled"
                  searchable
                />
              </Field>
            </Card>

            <SectionLabel>旅程サポート</SectionLabel>
            <Card>
              <Field label="よく使う出発地">
                <TextInput
                  value={form.defaultOrigin ?? ""}
                  onChange={(e) => patch({ defaultOrigin: e.currentTarget.value })}
                  placeholder="例: 東京駅, 羽田空港"
                  variant="unstyled"
                />
              </Field>
              <Field label="緊急連絡先" last>
                <TextInput
                  value={form.emergencyContact ?? ""}
                  onChange={(e) => patch({ emergencyContact: e.currentTarget.value })}
                  placeholder="海外出張時に同行者に共有"
                  variant="unstyled"
                />
              </Field>
            </Card>
          </>
        )}
      </Box>

      {/* Footer CTA — fixed above TabBar */}
      {!loading && (
        <Box
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
            padding: "12px 16px",
            background: "white",
            borderTop: "1px solid var(--border)",
            zIndex: 90,
            maxWidth: 430,
            marginInline: "auto",
          }}
        >
          {isGuest ? (
            <Link
              href="/signup"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 48,
                borderRadius: 10,
                background: "var(--accent-500)",
                color: "white",
                fontSize: 16,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              無料で会員登録する
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{
                width: "100%",
                height: 48,
                borderRadius: 10,
                background: "var(--info-700)",
                color: "white",
                border: "none",
                fontSize: 16,
                fontWeight: 700,
                cursor: dirty && !saving ? "pointer" : "not-allowed",
                opacity: dirty && !saving ? 1 : 0.5,
                fontFamily: "inherit",
              }}
            >
              {saving ? "保存中…" : "保存する"}
            </button>
          )}
        </Box>
      )}

      <TabBar />
    </>
  );
}

/* ---------- row primitives ---------- */

function GuestBanner() {
  return (
    <Box
      style={{
        margin: "16px 16px 0",
        padding: "12px 14px",
        background: "var(--warn-50)",
        border: "1px solid rgba(245,176,65,0.3)",
        borderRadius: 10,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <IconInfoCircle size={18} color="var(--warn-700)" style={{ flexShrink: 0, marginTop: 2 }} />
      <Box>
        <Text size="xs" fw={700} c="var(--warn-700)" lh={1.55}>
          ゲストモードです
        </Text>
        <Text size="xs" c="var(--warn-700)" lh={1.55} mt={2}>
          本登録すると画像と設定がクラウドに保存されます。
        </Text>
      </Box>
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="11px"
      fw={700}
      c="gray.6"
      tt="uppercase"
      lts={0.5}
      style={{ padding: "16px 16px 8px" }}
    >
      {children}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        background: "white",
        margin: "0 16px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );
}

function Field({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        padding: "10px 14px",
        borderBottom: last ? "none" : "1px solid var(--n-100)",
      }}
    >
      <Text size="11px" fw={600} c="dimmed" mb={2}>
        {label}
      </Text>
      {children}
      {hint && (
        <Text size="11px" c="dimmed" mt={4}>
          {hint}
        </Text>
      )}
    </Box>
  );
}
