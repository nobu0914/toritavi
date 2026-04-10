"use client";

import { Box, Text } from "@mantine/core";
import { IconArrowDown } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";

const THRESHOLD = 80;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const startY = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0 && !refreshing) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, [refreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.4, 120));
    } else {
      setIsPulling(false);
      setPullDistance(0);
    }
  }, [isPulling]);

  const onTouchEnd = useCallback(() => {
    if (!isPulling) return;
    setIsPulling(false);
    if (pullDistance >= THRESHOLD) {
      setRefreshing(true);
      setPullDistance(50);
      window.location.reload();
    } else {
      setPullDistance(0);
    }
  }, [isPulling, pullDistance]);

  const triggered = pullDistance >= THRESHOLD;

  return (
    <Box
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ position: "relative" }}
    >
      <Box
        style={{
          height: pullDistance,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: isPulling ? "none" : "height 0.2s ease",
          background: "var(--mantine-color-gray-0)",
        }}
      >
        {pullDistance > 10 && (
          <Box style={{ textAlign: "center" }}>
            <IconArrowDown
              size={20}
              style={{
                transition: "transform 0.2s",
                transform: triggered ? "rotate(180deg)" : "rotate(0deg)",
                color: triggered
                  ? "var(--mantine-color-blue-7)"
                  : "var(--mantine-color-gray-5)",
              }}
            />
            <Text
              size="11px"
              fw={600}
              c={triggered ? "blue.7" : "gray.5"}
            >
              {refreshing ? "読み込み中..." : triggered ? "離すと更新" : "引っ張って更新"}
            </Text>
          </Box>
        )}
      </Box>
      {children}
    </Box>
  );
}
