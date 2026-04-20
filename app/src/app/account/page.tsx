"use client";

import { Box, Button, Loader, Stack, Text } from "@mantine/core";
import {
  IconBell,
  IconChevronRight,
  IconDatabase,
  IconFlask,
  IconHelpCircle,
  IconUser,
  IconUserCircle,
} from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { createClient } from "@/lib/supabase-browser";
import { isGuestMode } from "@/lib/guest";

type MenuItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
};

// 親画面は DS v2 §15 の「状態確認 + 主要導線」ロール。
// フォーム本体 / トグル大量表示 / 破壊的操作の確認 は下層に逃がす。
const MENU: MenuItem[] = [
  { href: "/account/profile", label: "プロフィール設定", icon: IconUserCircle },
  { href: "/account/notifications", label: "通知設定", icon: IconBell },
  { href: "/account/help", label: "ヘルプ・サポート", icon: IconHelpCircle },
  { href: "/account/data", label: "アカウントとデータ", icon: IconDatabase },
];

export default function AccountPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);

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

  return (
    <>
      <AppHeader title="アカウント" />
      <Box pb={110}>
        {/* Status card */}
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
                <Text
                  size="12px"
                  c="gray.6"
                  mt={2}
                  style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                >
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

        {/* Primary navigation — 4 items to subpages */}
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
          {MENU.map((item, idx) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 14,
                  borderBottom:
                    idx === MENU.length - 1 ? "none" : "1px solid var(--n-100)",
                  fontSize: 15,
                  color: "var(--text)",
                  textDecoration: "none",
                }}
              >
                <Icon size={20} color="var(--text-dim)" />
                <span style={{ flex: 1 }}>{item.label}</span>
                <IconChevronRight size={18} color="var(--n-300)" />
              </Link>
            );
          })}
        </Box>

      </Box>
      <TabBar />
    </>
  );
}
