"use client";

import { Box, Text } from "@mantine/core";
import { IconInbox } from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

export default function UnfiledPage() {
  return (
    <>
      <AppHeader title="Unfiled" />
      <Box pb={110}>
        <Box
          style={{
            textAlign: "center",
            padding: "48px 32px",
          }}
        >
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
            確認メールを転送すると、
            <br />
            ここに表示されます。
          </Text>
        </Box>
      </Box>
      <TabBar />
    </>
  );
}
