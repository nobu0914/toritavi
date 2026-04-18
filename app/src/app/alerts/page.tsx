"use client";

import { Box, Text } from "@mantine/core";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

export default function AlertsPage() {
  const alerts = [
    {
      dotColor: "var(--accent-500)",
      title: "のぞみ 225号 — 10分遅延",
      desc: "東京駅 出発が10:10に変更されました。新大阪到着は12:40の見込みです。",
      time: "2分前",
    },
    {
      dotColor: "var(--success-500)",
      title: "ホテル大阪ベイ — チェックイン可能",
      desc: "本日18:00よりチェックイン可能です。",
      time: "1時間前",
    },
    {
      dotColor: "var(--info-700)",
      title: "明日の予定リマインダー",
      desc: "のぞみ 240号 新大阪 13:00発。チェックアウトは11:00です。",
      time: "3時間前",
    },
  ];

  return (
    <>
      <AppHeader title="Alerts" />
      <Box pb={110}>
        {alerts.map((alert) => (
          <Box
            key={alert.title}
            style={{
              background: "white",
              margin: "6px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              padding: 14,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: alert.dotColor,
                flexShrink: 0,
                marginTop: 5,
              }}
            />
            <Box>
              <Text fw={600} size="14px">
                {alert.title}
              </Text>
              <Text size="13px" c="gray.6" mt={2}>
                {alert.desc}
              </Text>
              <Text size="11px" c="gray.5" mt={6}>
                {alert.time}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
      <TabBar />
    </>
  );
}
