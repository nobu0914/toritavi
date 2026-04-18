"use client";

import { Box, Text } from "@mantine/core";
import { IconArrowDown } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

const THRESHOLD = 80;
const MAX_PULL_DISTANCE = 120;
const DRAG_RATIO = 0.4;
const MIN_PULL_TO_ACTIVATE = 10;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const tracking = useRef(false);
  const activated = useRef(false);
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const reset = () => {
      tracking.current = false;
      activated.current = false;
      startY.current = null;
      setPullDistance(0);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1 || window.scrollY > 0) {
        return;
      }
      startY.current = event.touches[0].clientY;
      tracking.current = true;
      activated.current = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!tracking.current || startY.current === null) {
        return;
      }

      const diff = event.touches[0].clientY - startY.current;
      if (diff <= 0 || window.scrollY > 0) {
        reset();
        return;
      }

      if (!activated.current) {
        if (diff <= MIN_PULL_TO_ACTIVATE) {
          return;
        }
        activated.current = true;
      }

      setPullDistance(Math.min(diff * DRAG_RATIO, MAX_PULL_DISTANCE));
    };

    const handleTouchEnd = () => {
      if (!tracking.current) {
        return;
      }

      const shouldRefresh = activated.current && pullDistanceRef.current >= THRESHOLD;
      tracking.current = false;
      activated.current = false;
      startY.current = null;

      if (shouldRefresh) {
        setRefreshing(true);
        setPullDistance(50);
        window.location.reload();
        return;
      }

      setPullDistance(0);
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, []);

  const triggered = pullDistance >= THRESHOLD;

  return (
    <>
      {pullDistance > 0 && (
        <Box
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: pullDistance,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--n-50)",
            borderBottom: "1px solid var(--border)",
            zIndex: 250,
            pointerEvents: "none",
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
                    ? "var(--info-700)"
                    : "var(--text-dim)",
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
      )}
      {children}
    </>
  );
}
