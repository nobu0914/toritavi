"use client";

import { Box, Text } from "@mantine/core";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

// Stub: Phase 4 で session / export / danger-zone を実装する。
export default function AccountDataPage() {
  return (
    <>
      <AppHeader title="アカウントとデータ" back backHref="/account" />
      <Box pb={110} style={{ padding: 40, textAlign: "center" }}>
        <Text c="dimmed" size="sm">準備中</Text>
      </Box>
      <TabBar />
    </>
  );
}
