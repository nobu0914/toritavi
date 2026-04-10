"use client";

import { Box, Text } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

export default function AccountPage() {
  return (
    <>
      <AppHeader title="Account" />
      <Box pb={110}>
        {/* Profile */}
        <Box
          style={{
            background: "white",
            margin: 16,
            borderRadius: 8,
            border: "1px solid var(--mantine-color-gray-2)",
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
              background: "var(--mantine-color-blue-7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              color: "white",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            T
          </Box>
          <Box>
            <Text fw={700} size="18px">
              田中 太郎
            </Text>
            <Text size="13px" c="gray.6" mt={2}>
              tanaka@example.com
            </Text>
          </Box>
        </Box>

        {/* Section label */}
        <Text
          size="11px"
          fw={700}
          c="gray.6"
          tt="uppercase"
          lts={0.5}
          style={{ padding: "16px 16px 8px" }}
        >
          Travel Stats
        </Text>

        {/* Stats grid */}
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10,
            margin: "0 16px 16px",
          }}
        >
          {[
            { v: "12", l: "Trips" },
            { v: "24", l: "Days" },
            { v: "8", l: "Cities" },
            { v: "4,820", l: "km" },
          ].map((item) => (
            <Box
              key={item.l}
              style={{
                background: "white",
                borderRadius: 8,
                border: "1px solid var(--mantine-color-gray-2)",
                padding: 16,
                textAlign: "center",
              }}
            >
              <Text fw={700} size="28px" c="blue.7">
                {item.v}
              </Text>
              <Text size="12px" c="gray.6" mt={4}>
                {item.l}
              </Text>
            </Box>
          ))}
        </Box>

        {/* Menu */}
        <Box
          style={{
            background: "white",
            margin: "0 16px",
            borderRadius: 8,
            border: "1px solid var(--mantine-color-gray-2)",
            overflow: "hidden",
          }}
        >
          {["Profile Settings", "Notification Settings", "Connected Accounts", "Help & Support"].map(
            (item) => (
              <Box
                key={item}
                style={{
                  padding: 14,
                  borderBottom: "1px solid var(--mantine-color-gray-1)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  fontSize: 15,
                }}
              >
                {item}
                <Box style={{ color: "var(--mantine-color-gray-4)", display: "flex" }}>
                  <IconChevronRight size={20} />
                </Box>
              </Box>
            )
          )}
          <Box
            style={{
              padding: 14,
              cursor: "pointer",
              fontSize: 15,
              color: "var(--mantine-color-red-6)",
            }}
          >
            Sign Out
          </Box>
        </Box>
      </Box>
      <TabBar />
    </>
  );
}
