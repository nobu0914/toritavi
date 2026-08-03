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

  // 🔴 **消える条件が「pathname が変わること」だけだった。**
  // 遷移が起きなければ（同じ経路への push、プロキシに差し戻される、
  // ルートが落ちる）オーバーレイは永遠に出たままで、画面は操作できない。
  // 例外は出ず、ログも残らないので原因も分からない（2026-08-03 実機で発生）。
  // **出しっぱなしにしない。** 一定時間で外し、理由をコンソールに残す。
  useEffect(() => {
    if (!navigating) return;
    const t = setTimeout(() => {
      console.warn("[nav] 遷移が完了しないため、ローディング表示を解除しました");
      setNavigating(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [navigating]);

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
