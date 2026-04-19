"use client";

/**
 * /scan — TabBar「予定登録」エントリ。
 * 実体は ScanFlow コンポーネントに集約（AddStepDrawer でも同じ body を再利用する）。
 */

import { Suspense } from "react";
import { ScanFlow } from "@/components/ScanFlow";

export default function ScanPage() {
  // Next.js 16 では useSearchParams() 利用箇所は Suspense 境界内に置くのが必須。
  return (
    <Suspense fallback={null}>
      <ScanFlow />
    </Suspense>
  );
}
