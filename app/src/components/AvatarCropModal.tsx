"use client";

import { useCallback, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
import { Modal, Slider } from "@mantine/core";
import { IconMinus, IconPlus, IconX } from "@tabler/icons-react";
import { cropImageToBlob } from "@/lib/avatar";

/*
 * AvatarCropModal — DS v2 §4 step 2 (account-subpages.html)
 * 黒背景の没入画面、円形プレビュー、ズームスライダー、ドラッグ移動。
 * 「キャンセル / リセット / 適用」の 3 ボタンを下部に。
 */

type Props = {
  opened: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onApply: (blob: Blob) => void | Promise<void>;
};

const INITIAL_CROP = { x: 0, y: 0 };
const INITIAL_ZOOM = 1;

export function AvatarCropModal({ opened, imageSrc, onCancel, onApply }: Props) {
  const [crop, setCrop] = useState(INITIAL_CROP);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [areaPx, setAreaPx] = useState<Area | null>(null);
  const [applying, setApplying] = useState(false);

  const onCropComplete = useCallback((_area: Area, px: Area) => {
    setAreaPx(px);
  }, []);

  const reset = () => {
    setCrop(INITIAL_CROP);
    setZoom(INITIAL_ZOOM);
  };

  const handleApply = async () => {
    if (!imageSrc || !areaPx) return;
    setApplying(true);
    try {
      const blob = await cropImageToBlob(imageSrc, areaPx);
      await onApply(blob);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      opened={opened && !!imageSrc}
      onClose={applying ? () => {} : onCancel}
      fullScreen
      withCloseButton={false}
      padding={0}
      radius={0}
      zIndex={900}
      transitionProps={{ transition: "fade", duration: 180 }}
      styles={{
        content: { background: "#000" },
        body: { padding: 0, height: "100vh", background: "#000" },
        inner: { padding: 0 },
      }}
    >
      {/* Top bar */}
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
          padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px",
          color: "#fff",
          background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)",
          pointerEvents: "none",
        }}
      >
        <button
          type="button"
          aria-label="キャンセル"
          onClick={applying ? undefined : onCancel}
          disabled={applying}
          style={{
            pointerEvents: "all",
            background: "transparent",
            border: "none",
            color: "#fff",
            cursor: applying ? "not-allowed" : "pointer",
            padding: 6,
            display: "inline-flex",
          }}
        >
          <IconX size={24} />
        </button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>画像をトリミング</div>
        <div style={{ width: 36 }} />
      </div>

      {/* Crop canvas */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 168,
          background: "#000",
        }}
      >
        {imageSrc && (
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            minZoom={1}
            maxZoom={4}
          />
        )}
      </div>

      {/* Zoom slider + bottom actions */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          background: "#000",
          color: "#fff",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 20px 0",
            fontSize: 11,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          ピンチまたはスライダーで拡大・ドラッグで位置調整
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 20px 16px",
          }}
        >
          <IconMinus size={18} color="#fff" />
          <div style={{ flex: 1 }}>
            <Slider
              value={zoom}
              onChange={setZoom}
              min={1}
              max={4}
              step={0.01}
              label={null}
              thumbSize={18}
              styles={{
                track: { background: "rgba(255,255,255,0.25)" },
                bar: { background: "#fff" },
                thumb: { borderColor: "#fff", background: "#fff" },
              }}
            />
          </div>
          <IconPlus size={18} color="#fff" />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            padding: "0 16px",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            style={bottomBtn("transparent", "#fff", "1px solid rgba(255,255,255,0.4)")}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={applying}
            style={bottomBtn("transparent", "#fff", "1px solid rgba(255,255,255,0.4)")}
          >
            リセット
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying || !areaPx}
            style={bottomBtn("#fff", "#000", "none", applying || !areaPx)}
          >
            {applying ? "適用中…" : "適用"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function bottomBtn(
  bg: string,
  fg: string,
  border: string,
  disabled = false
): React.CSSProperties {
  return {
    height: 44,
    background: bg,
    color: fg,
    border,
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
