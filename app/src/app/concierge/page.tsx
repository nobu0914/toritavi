"use client";

import { Suspense } from "react";
import { ConciergeChat } from "@/components/ConciergeChat";

export default function ConciergePage() {
  return (
    <Suspense fallback={null}>
      <ConciergeChat />
    </Suspense>
  );
}
