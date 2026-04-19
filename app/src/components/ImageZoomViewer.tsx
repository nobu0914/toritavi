"use client";

/*
 * ImageZoomViewer — スキャン元画像の拡大ビューア。
 * Ticket の画像タップでフルスクリーン モーダルを開き、ピンチ/パン/ダブルタップで
 * 細部を確認できるようにする。多ページ PDF は現状は矢印ボタン（Phase 1）。
 *
 * - 背景: 黒 (#000)
 * - pinch / pan / double-tap で 1x ⇄ 2x トグル、最大 4x
 * - × / ESC / 背景タップ / 下部「閉じる」で閉じる
 * - 上部右に 保存 ボタン、左に × ボタン
 */

import { Modal, ActionIcon } from "@mantine/core";
import { IconX, IconDownload, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";

type Props = {
  opened: boolean;
  onClose: () => void;
  images: string[];
  initialIndex?: number;
  onDownload?: (index: number) => void;
};

export function ImageZoomViewer({ opened, onClose, images, initialIndex = 0, onDownload }: Props) {
  const [index, setIndex] = useState(initialIndex);

  // opened の立ち上がりで index を初期化。閉じた後に残らないよう open 時にリセット。
  useEffect(() => {
    if (opened) setIndex(initialIndex);
  }, [opened, initialIndex]);

  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  // 横スワイプでページ移動。ただし拡大中（scale > 1）は pan を優先するため無効化。
  // 閾値 50px 以上 + 横>縦 の条件で確定スワイプ判定。
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    const scale = transformRef.current?.instance.state.scale ?? 1;
    if (scale > 1.05) return; // 拡大中は pan 優先、ページ切替しない
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy)) return; // 縦主体なら無視（下スワイプ等）
    if (dx < 0 && hasNext) setIndex((i) => i + 1);
    else if (dx > 0 && hasPrev) setIndex((i) => i - 1);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      padding={0}
      // Drawer zIndex=400 より前面。
      zIndex={800}
      transitionProps={{ transition: "fade", duration: 180 }}
      styles={{
        content: { background: "#000" },
        body: { padding: 0, height: "100vh", background: "#000" },
        inner: { padding: 0 },
      }}
    >
      {/* 上部バー: ×（閉じる）/ 保存 */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px",
          background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)",
          pointerEvents: "none",
        }}
      >
        <ActionIcon
          variant="filled"
          color="dark"
          radius="xl"
          size={40}
          onClick={onClose}
          aria-label="閉じる"
          style={{ pointerEvents: "auto", background: "rgba(255,255,255,0.18)" }}
        >
          <IconX size={20} color="#fff" />
        </ActionIcon>
        {onDownload && (
          <ActionIcon
            variant="filled"
            color="dark"
            radius="xl"
            size={40}
            onClick={() => onDownload(index)}
            aria-label="原本を保存"
            style={{ pointerEvents: "auto", background: "rgba(255,255,255,0.18)" }}
          >
            <IconDownload size={20} color="#fff" />
          </ActionIcon>
        )}
      </div>

      {/* 画像エリア: pinch / pan / double-tap。横スワイプはラッパで検出する */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ width: "100vw", height: "100vh" }}
      >
        <TransformWrapper
          key={index} // ページ切替時に state をリセット
          ref={transformRef}
          minScale={1}
          maxScale={4}
          doubleClick={{ mode: "toggle", step: 2 }}
          wheel={{ step: 0.2 }}
          panning={{ velocityDisabled: false }}
          centerOnInit
          limitToBounds
        >
          <TransformComponent
            wrapperStyle={{ width: "100vw", height: "100vh" }}
            contentStyle={{ width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[index]}
              alt={`スキャン元 ${index + 1} / ${images.length}`}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
              }}
              draggable={false}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>

      {/* ページ送りボタン（多ページ時のみ） */}
      {images.length > 1 && (
        <>
          {hasPrev && (
            <ActionIcon
              variant="filled"
              color="dark"
              radius="xl"
              size={44}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              aria-label="前のページ"
              style={{
                position: "fixed",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 2,
                background: "rgba(255,255,255,0.18)",
              }}
            >
              <IconChevronLeft size={22} color="#fff" />
            </ActionIcon>
          )}
          {hasNext && (
            <ActionIcon
              variant="filled"
              color="dark"
              radius="xl"
              size={44}
              onClick={() => setIndex((i) => Math.min(images.length - 1, i + 1))}
              aria-label="次のページ"
              style={{
                position: "fixed",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 2,
                background: "rgba(255,255,255,0.18)",
              }}
            >
              <IconChevronRight size={22} color="#fff" />
            </ActionIcon>
          )}
          <div
            style={{
              position: "fixed",
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              zIndex: 2,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 12px",
                borderRadius: 999,
              }}
            >
              {index + 1} / {images.length}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
