"use client";

/*
 * AddStepDrawer — DS v2 §10.6 Journey への予定追加 (Bottom Sheet)
 * 既存 /trips/[id] 上に Mantine Drawer を立ち上げ、ScanFlow をそのまま embed する。
 * 画面遷移ゼロで OCR / 撮影 / メール貼付 / 手入力の全フローを提供。
 */

import { Drawer } from "@mantine/core";
import { Suspense } from "react";
import { SheetHeader } from "./SheetHeader";
import { ScanFlow } from "./ScanFlow";

type Props = {
  opened: boolean;
  onClose: () => void;
  journey: { id: string; title: string };
  onCompleted: (journeyId: string) => void;
};

export function AddStepDrawer({ opened, onClose, journey, onCompleted }: Props) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="100%"
      withCloseButton={false}
      styles={{
        content: {
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
        },
        body: {
          padding: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflowY: "auto",
        },
      }}
    >
      <SheetHeader
        title={`${journey.title} に予定を追加`}
        onClose={onClose}
        leftIcon="down"
      />
      <Suspense fallback={null}>
        <ScanFlow
          chrome="embedded"
          target={{ id: journey.id, title: journey.title }}
          onComplete={(journeyId) => {
            onCompleted(journeyId);
          }}
        />
      </Suspense>
    </Drawer>
  );
}
