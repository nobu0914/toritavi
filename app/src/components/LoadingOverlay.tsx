"use client";

import { Box, Loader, Text } from "@mantine/core";

/**
 * 全画面ローディングオーバーレイ
 * ページ遷移・保存・削除など非同期処理中に表示
 */
export function LoadingOverlay({ message = "読み込み中..." }: { message?: string }) {
  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(2px)",
      }}
    >
      <Loader size={32} color="blue" />
      <Text size="sm" fw={500} c="gray.7">{message}</Text>
    </Box>
  );
}

/**
 * useNavigateWithLoading - 遷移時にローディングを表示し、遷移完了で自動解除
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

export function useNavigateWithLoading() {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, setNavigating] = useState(false);
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      setNavigating(false);
      prevPathname.current = pathname;
    }
  }, [pathname]);

  const navigate = useCallback((path: string) => {
    setNavigating(true);
    router.push(path);
  }, [router]);

  const goBack = useCallback((fallback?: string) => {
    setNavigating(true);
    fallback ? router.push(fallback) : router.back();
  }, [router]);

  return { navigating, navigate, goBack };
}
