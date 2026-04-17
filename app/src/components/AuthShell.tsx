"use client";

import { Box, Text } from "@mantine/core";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "48px 20px 32px",
        background: "var(--mantine-color-gray-0)",
      }}
    >
      <Box style={{ textAlign: "center", marginBottom: 24 }}>
        <Text fw={800} size="28px" c="blue.7" style={{ letterSpacing: "-0.5px" }}>
          toritavi
        </Text>
        <Text size="xs" c="dimmed" mt={2}>
          行動を、前に進める
        </Text>
      </Box>

      <Box
        style={{
          background: "white",
          borderRadius: 12,
          padding: "28px 20px 24px",
          border: "1px solid var(--mantine-color-gray-2)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <Text fw={700} size="20px">
          {title}
        </Text>
        {subtitle && (
          <Text size="sm" c="dimmed" mt={4} mb={20} lh={1.6}>
            {subtitle}
          </Text>
        )}
        {!subtitle && <Box mt={20} />}
        {children}
      </Box>
    </Box>
  );
}
