"use client";

import { useEffect, useState } from "react";
import { Box, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChevronRight,
  IconDownload,
  IconFlask,
  IconLogout,
  IconMail,
  IconRefresh,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { createClient } from "@/lib/supabase-browser";
import { disableGuestMode, isGuestMode } from "@/lib/guest";
import { clearGuestData } from "@/lib/store-guest";
import { clearGuestSettings, getSettings } from "@/lib/store-settings";
import { getJourneys, deleteJourney } from "@/lib/store-client";

/*
 * /account/data — DS v2 §7 (account-subpages.html)
 * セッション管理 + データ管理 + 危険な操作（危険ゾーン）。
 * 破壊的操作はすべて ConfirmDialog を通す。
 */

type DialogKind =
  | "logout"
  | "clearCache"
  | "wipeAll"
  | "deleteAccount"
  | "exitGuest"
  | null;

export default function AccountDataPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  useEffect(() => {
    const guest = isGuestMode();
    setIsGuest(guest);
    if (guest) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        setEmail(user?.email ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ---- actions ----

  const handleLogout = async () => {
    try {
      const sb = createClient();
      await sb.auth.signOut();
      clearGuestData();
      clearGuestSettings();
      router.replace("/login");
    } catch (e) {
      console.error("[account/data] logout failed", e);
      notifications.show({ color: "red", message: "ログアウトに失敗しました" });
    }
  };

  const handleExport = async () => {
    try {
      const journeys = await getJourneys();
      const settings = await getSettings();
      const blob = new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), journeys, settings },
            null,
            2
          ),
        ],
        { type: "application/json;charset=utf-8" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `toritavi-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[account/data] export failed", e);
      notifications.show({ color: "red", message: "エクスポートに失敗しました" });
    }
  };

  const handleClearCache = async () => {
    try {
      // Blow away every SW cache bucket we can see — future fetches go to
      // network and repopulate only what's still referenced.
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // Also unregister SWs so the next load registers fresh against the
      // current sw.js (picks up any in-flight deploy.)
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      notifications.show({ message: "端末内キャッシュを削除しました。再読込します。" });
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      console.error("[account/data] clear cache failed", e);
      notifications.show({ color: "red", message: "キャッシュ削除に失敗しました" });
    }
  };

  const handleWipeAllData = async () => {
    try {
      const journeys = await getJourneys();
      // RLS prevents touching other users' rows, so this is safe even if
      // we ever end up with a stale client in a multi-user device.
      for (const j of journeys) {
        await deleteJourney(j.id);
      }
      notifications.show({ message: "すべての旅程データを削除しました" });
    } catch (e) {
      console.error("[account/data] wipe-all failed", e);
      notifications.show({ color: "red", message: "削除に失敗しました" });
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      clearGuestData();
      clearGuestSettings();
      router.replace("/login");
    } catch (e) {
      console.error("[account/data] delete account failed", e);
      notifications.show({
        color: "red",
        message:
          e instanceof Error ? e.message : "アカウント削除に失敗しました",
      });
    }
  };

  const handleExitGuest = () => {
    disableGuestMode();
    clearGuestData();
    clearGuestSettings();
    router.replace("/login");
  };

  const handleReseedGuest = () => {
    clearGuestData();
    notifications.show({ message: "サンプルデータを再投入しました" });
    router.replace("/");
  };

  // ---- render ----

  return (
    <>
      <AppHeader title="アカウントとデータ" back backHref="/account" />
      <Box pb={110}>
        <Box style={{ padding: "14px 16px 4px" }}>
          <Text size="sm" c="dimmed" lh={1.6}>
            {isGuest
              ? "ゲストモードを終了したり、端末内データを削除できます。"
              : "ログアウトやアカウント削除などの操作を行います。"}
          </Text>
        </Box>

        {loading ? (
          <Box style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader size="sm" />
          </Box>
        ) : isGuest ? (
          <GuestView
            onSignupNav={() => router.push("/signup")}
            onReseed={handleReseedGuest}
            onExport={handleExport}
            onExitGuest={() => setDialog("exitGuest")}
          />
        ) : (
          <MemberView
            email={email}
            onLogout={() => setDialog("logout")}
            onExport={handleExport}
            onClearCache={() => setDialog("clearCache")}
            onWipeAll={() => setDialog("wipeAll")}
            onDeleteAccount={() => setDialog("deleteAccount")}
          />
        )}
      </Box>

      {/* ---- Confirm dialogs ---- */}
      <ConfirmDialog
        opened={dialog === "logout"}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await handleLogout();
          setDialog(null);
        }}
        title="ログアウトしますか？"
        message="次回利用時は再度ログインが必要です。端末内のキャッシュは残ります。"
        confirmLabel="ログアウト"
        severity="default"
      />
      <ConfirmDialog
        opened={dialog === "clearCache"}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          setDialog(null);
          await handleClearCache();
        }}
        title="端末内キャッシュを削除しますか？"
        message="再ダウンロードのため、次回画面がやや遅くなることがあります。"
        confirmLabel="削除"
        severity="danger"
      />
      <ConfirmDialog
        opened={dialog === "wipeAll"}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await handleWipeAllData();
          setDialog(null);
        }}
        title="すべての旅程データを削除しますか？"
        message={
          "この操作は取り消せません。旅程・予定・取り込んだ画像参照がすべて削除されます。\nアカウント自体は残ります。"
        }
        confirmLabel="削除"
        severity="danger"
      />
      <ConfirmDialog
        opened={dialog === "deleteAccount"}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await handleDeleteAccount();
          setDialog(null);
        }}
        title="アカウントを削除しますか？"
        message={
          "この操作は取り消せません。ログイン情報・プロフィール・すべての旅程データ・取り込み画像が完全に削除されます。"
        }
        confirmLabel="アカウントを削除"
        severity="type"
        typeToken="削除"
      />
      <ConfirmDialog
        opened={dialog === "exitGuest"}
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          handleExitGuest();
          setDialog(null);
        }}
        title="ゲストモードを終了しますか？"
        message="端末内のすべてのゲストデータが削除されます。"
        confirmLabel="終了"
        severity="danger"
      />

      <TabBar />
    </>
  );
}

/* ---------- subviews ---------- */

function MemberView({
  email,
  onLogout,
  onExport,
  onClearCache,
  onWipeAll,
  onDeleteAccount,
}: {
  email: string | null;
  onLogout: () => void;
  onExport: () => void;
  onClearCache: () => void;
  onWipeAll: () => void;
  onDeleteAccount: () => void;
}) {
  return (
    <>
      <SectionLabel>セッション</SectionLabel>
      <Card>
        <StaticRow
          icon={<IconUser size={18} color="var(--text-dim)" />}
          label="ログイン中のメール"
          sub={email ?? "—"}
        />
        <ActionRow
          icon={<IconLogout size={18} color="var(--text-dim)" />}
          label="ログアウト"
          onClick={onLogout}
          last
        />
      </Card>

      <SectionLabel>データ管理</SectionLabel>
      <Card>
        <ActionRow
          icon={<IconDownload size={18} color="var(--text-dim)" />}
          label="データをエクスポート"
          sub="JSON 形式で保存"
          onClick={onExport}
        />
        <ActionRow
          icon={<IconRefresh size={18} color="var(--text-dim)" />}
          label="端末内キャッシュを削除"
          sub="再ダウンロードされます"
          onClick={onClearCache}
          last
        />
      </Card>

      {/* Danger zone */}
      <Box style={{ margin: "20px 16px 0" }}>
        <Text fw={700} c="var(--danger-700)" size="13px">
          危険な操作
        </Text>
        <Text size="12px" c="dimmed" mt={4} lh={1.6}>
          実行後は元に戻せません。本当に必要な時のみ利用してください。
        </Text>
      </Box>
      <Box style={{ display: "flex", flexDirection: "column", gap: 8, margin: "12px 16px 0" }}>
        <DangerRow label="すべての旅程データを削除" onClick={onWipeAll} />
        <DangerRow label="アカウントを削除" onClick={onDeleteAccount} />
      </Box>
    </>
  );
}

function GuestView({
  onSignupNav,
  onReseed,
  onExport,
  onExitGuest,
}: {
  onSignupNav: () => void;
  onReseed: () => void;
  onExport: () => void;
  onExitGuest: () => void;
}) {
  return (
    <>
      <SectionLabel>ゲストモード</SectionLabel>
      <Card>
        <StaticRow
          icon={<IconFlask size={18} color="var(--text-dim)" />}
          label="現在の状態"
          sub="ゲストモード（端末内のみ保存）"
        />
        <ActionRow
          icon={<IconMail size={18} color="var(--text-dim)" />}
          label="会員登録してデータを保存"
          onClick={onSignupNav}
          last
        />
      </Card>

      <SectionLabel>データ</SectionLabel>
      <Card>
        <ActionRow
          icon={<IconDownload size={18} color="var(--text-dim)" />}
          label="データをエクスポート"
          sub="JSON 形式で保存"
          onClick={onExport}
        />
        <ActionRow
          icon={<IconRefresh size={18} color="var(--text-dim)" />}
          label="サンプルデータを再投入"
          sub="初期状態に戻します"
          onClick={onReseed}
          last
        />
      </Card>

      <Box style={{ margin: "20px 16px 0" }}>
        <Text fw={700} c="var(--danger-700)" size="13px">
          危険な操作
        </Text>
        <Text size="12px" c="dimmed" mt={4} lh={1.6}>
          ゲストモード終了時は、端末内のすべてのデータが削除されます。
        </Text>
      </Box>
      <Box style={{ margin: "12px 16px 0" }}>
        <DangerRow label="ゲストモードを終了（データ削除）" onClick={onExitGuest} />
      </Box>
    </>
  );
}

/* ---------- row primitives ---------- */

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

function StaticRow({
  icon,
  label,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <Box
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderBottom: "1px solid var(--n-100)",
      }}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="15px">{label}</Text>
        <Text size="12px" c="dimmed" mt={2}>
          {sub}
        </Text>
      </Box>
    </Box>
  );
}

function ActionRow({
  icon,
  label,
  sub,
  onClick,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderBottom: last ? "none" : "1px solid var(--n-100)",
        width: "100%",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="15px">{label}</Text>
        {sub && (
          <Text size="12px" c="dimmed" mt={2}>
            {sub}
          </Text>
        )}
      </Box>
      <IconChevronRight size={18} color="var(--n-300)" />
    </button>
  );
}

function DangerRow({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        background: "white",
        border: "1px solid rgba(231,76,60,0.2)",
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 15,
        color: "var(--danger-700)",
        width: "100%",
        textAlign: "left",
      }}
    >
      <span>{label}</span>
      <IconChevronRight size={18} color="var(--danger-500)" />
    </button>
  );
}
