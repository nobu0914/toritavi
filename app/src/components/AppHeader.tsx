"use client";

import { ActionIcon, Box, Text } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

type Props = {
  title: string;
  back?: boolean;
  backHref?: string;
  action?: React.ReactNode;
};

export function AppHeader({ title, back, backHref, action }: Props) {
  const router = useRouter();

  return (
    <Box
      style={{
        background: "var(--mantine-color-blue-7)",
        color: "white",
        padding: "14px 16px",
        position: "sticky",
        top: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Box style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {back && (
          <ActionIcon
            variant="transparent"
            color="white"
            size="sm"
            style={{ padding: 4 }}
            onClick={() => (backHref ? router.push(backHref) : router.back())}
          >
            <IconChevronLeft size={20} />
          </ActionIcon>
        )}
        <Text fw={700} size="18px" c="white" lh={1.2}>
          {title}
        </Text>
      </Box>
      {action && (
        <Box style={{ color: "rgba(255,255,255,0.8)" }}>{action}</Box>
      )}
    </Box>
  );
}
