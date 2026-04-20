"use client";

import { Box, Text } from "@mantine/core";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

// Stub: Phase 3 で通知 toggle 群を実装する。
export default function NotificationsPage() {
  return (
    <>
      <AppHeader title="通知設定" back backHref="/account" />
      <Box pb={110} style={{ padding: 40, textAlign: "center" }}>
        <Text c="dimmed" size="sm">準備中</Text>
      </Box>
      <TabBar />
    </>
  );
}
