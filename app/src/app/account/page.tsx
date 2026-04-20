"use client";

import { Box, Button, Loader, Stack, Text } from "@mantine/core";
import { IconChevronRight, IconFlask, IconLogout, IconUser } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { createClient } from "@/lib/supabase-browser";
import { disableGuestMode, isGuestMode } from "@/lib/guest";
import { clearGuestData } from "@/lib/store-guest";

export default function AccountPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const sb = createClient();
      await sb.auth.signOut();
      // Belt-and-suspenders: ensure nothing guest-flavored survives for the
      // next user of this device.
      clearGuestData();
      router.replace("/login");
    } catch {
      setSigningOut(false);
    }
  };

  const handleExitGuest = () => {
    disableGuestMode();
    clearGuestData();
    router.replace("/login");
  };

  return (
    <>
      <AppHeader title="アカウント" />
      <Box pb={110}>
        {/* Profile / status card */}
        <Box
          style={{
            background: "white",
            margin: 16,
            borderRadius: 8,
            border: "1px solid var(--border)",
            padding: 20,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Box
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: isGuest ? "var(--warn-500)" : "var(--info-700)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {isGuest ? <IconFlask size={24} /> : <IconUser size={24} />}
          </Box>
          <Box style={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <Loader size="xs" />
            ) : isGuest ? (
              <>
                <Text fw={700} size="16px">ゲストユーザー</Text>
                <Text size="12px" c="gray.6" mt={2}>未登録（サンプルデータを閲覧中）</Text>
              </>
            ) : (
              <>
                <Text fw={700} size="16px">ログイン中</Text>
                <Text size="12px" c="gray.6" mt={2} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {email ?? "—"}
                </Text>
              </>
            )}
          </Box>
        </Box>

        {/* Guest mode CTA */}
        {isGuest && (
          <Box style={{ margin: "0 16px 16px" }}>
            <Stack gap={8}>
              <Button component={Link} href="/signup" fullWidth>
                無料で会員登録する
              </Button>
              <Button component={Link} href="/login" variant="default" fullWidth>
                既存アカウントでログイン
              </Button>
              <Text size="xs" c="dimmed" mt={6} ta="center" lh={1.6}>
                会員登録するとデータがクラウドに保存され、端末を超えて同期されます。
              </Text>
            </Stack>
          </Box>
        )}

        {/* Menu */}
        <Text
          size="11px"
          fw={700}
          c="gray.6"
          tt="uppercase"
          lts={0.5}
          style={{ padding: "16px 16px 8px" }}
        >
          設定
        </Text>
        <Box
          style={{
            background: "white",
            margin: "0 16px 16px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          {["プロフィール設定", "通知設定", "ヘルプ・サポート"].map((item) => (
            <Box
              key={item}
              style={{
                padding: 14,
                borderBottom: "1px solid var(--n-100)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 15,
                color: "var(--text-dim)",
              }}
            >
              {item}
              <IconChevronRight size={18} color="var(--n-300)" />
            </Box>
          ))}
        </Box>

        {/* Sign out / exit guest */}
        <Box style={{ margin: "0 16px 16px" }}>
          {isGuest ? (
            <Button
              leftSection={<IconLogout size={16} />}
              color="red"
              variant="light"
              fullWidth
              onClick={handleExitGuest}
            >
              ゲストモードを終了（データ削除）
            </Button>
          ) : (
            <Button
              leftSection={<IconLogout size={16} />}
              color="red"
              variant="light"
              fullWidth
              loading={signingOut}
              onClick={handleSignOut}
            >
              ログアウト
            </Button>
          )}
        </Box>
      </Box>
      <TabBar />
    </>
  );
}
