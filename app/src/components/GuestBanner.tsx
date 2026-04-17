"use client";

import { Box, Text } from "@mantine/core";
import { IconFlask } from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isGuestMode } from "@/lib/guest";

export function GuestBanner() {
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setIsGuest(isGuestMode());
    const onStorage = () => setIsGuest(isGuestMode());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!isGuest) return null;

  return (
    <Box
      style={{
        position: "sticky",
        top: 0,
        zIndex: 101,
        background: "var(--mantine-color-yellow-0)",
        borderBottom: "1px solid var(--mantine-color-yellow-3)",
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <Box style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <IconFlask size={14} color="var(--mantine-color-yellow-9)" />
        <Text size="11px" fw={600} c="yellow.9">
          ゲストモード（データは端末内のみ保存）
        </Text>
      </Box>
      <Link
        href="/signup"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--mantine-color-blue-7)",
          textDecoration: "underline",
        }}
      >
        本登録する
      </Link>
    </Box>
  );
}
