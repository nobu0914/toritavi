"use client";

import { useEffect } from "react";
import { migrateFromLocalStorage } from "@/lib/db";
import { restoreFromCloud, setupAutoSync } from "@/lib/sync";

/**
 * データ同期の初期化コンポーネント
 * - localStorage → IndexedDB 移行（初回のみ）
 * - Supabase → IndexedDB 復元（ローカルデータなし時）
 * - オンライン復帰時の自動同期
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const init = async () => {
      // 1. localStorageからの移行
      await migrateFromLocalStorage();
      // 2. クラウドから復元（ローカルが空の場合）
      await restoreFromCloud();
    };
    init();

    // 3. 自動同期の設定
    const cleanup = setupAutoSync();
    return cleanup;
  }, []);

  return <>{children}</>;
}
