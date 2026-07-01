"use client";

import { Box, Stack, Text } from "@mantine/core";
import { IconBellOff } from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

// 通知フィードの実データ源（遅延・変更・リマインダー）はまだ無い。
// 以前はダミー通知を全ユーザーに表示していたが、誤解を招くため空状態に。
export default function AlertsPage() {
  return (
    <>
      <AppHeader title="通知" />
      <Box pb={110}>
        <Stack align="center" gap={8} mt={80} px={24}>
          <IconBellOff size={40} color="var(--border)" stroke={1.5} />
          <Text fw={600} size="15px" c="gray.7">
            通知はまだありません
          </Text>
          <Text size="13px" c="gray.5" ta="center" lh={1.5}>
            旅程の遅延・変更やリマインダーは、準備が整い次第ここに表示されます。
          </Text>
        </Stack>
      </Box>
      <TabBar />
    </>
  );
}
