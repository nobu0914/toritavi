"use client";

import { ActionIcon, Box, Text } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import { LoadingOverlay, useNavigateWithLoading } from "@/components/LoadingOverlay";

type Props = {
  title: string;
  back?: boolean;
  backHref?: string;
  action?: React.ReactNode;
};

export function AppHeader({ title, back, backHref, action }: Props) {
  const { navigating, goBack } = useNavigateWithLoading();
  const handleBack = () => goBack(backHref);

  return (
    <>
      {navigating && <LoadingOverlay message="読み込み中..." />}
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
              onClick={handleBack}
            >
              <IconChevronLeft size={20} />
            </ActionIcon>
          )}
          {back ? (
            <Box
              component="button"
              type="button"
              onClick={handleBack}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                margin: 0,
                color: "white",
                cursor: "pointer",
              }}
            >
              <Text fw={700} size="18px" c="white" lh={1.2}>
                {title}
              </Text>
            </Box>
          ) : (
            <Text fw={700} size="18px" c="white" lh={1.2}>
              {title}
            </Text>
          )}
        </Box>
        {action && (
          <Box style={{ color: "rgba(255,255,255,0.8)" }}>{action}</Box>
        )}
      </Box>
    </>
  );
}
