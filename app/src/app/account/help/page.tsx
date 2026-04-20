"use client";

import { Box, Text } from "@mantine/core";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

// Stub: Phase 2 で FAQ / サポート / 規約 / アプリ版数を実装する。
export default function HelpPage() {
  return (
    <>
      <AppHeader title="ヘルプ・サポート" back backHref="/account" />
      <Box pb={110} style={{ padding: 40, textAlign: "center" }}>
        <Text c="dimmed" size="sm">準備中</Text>
      </Box>
      <TabBar />
    </>
  );
}
