"use client";

import { IconChevronLeft } from "@tabler/icons-react";
import { LoadingOverlay, useNavigateWithLoading } from "@/components/LoadingOverlay";

/*
 * AppHeader — Design System v2 §6 Header System Type A/B 準拠
 *   Type A (Global):  back=false。TabBar 到達の最上位ページで使用。
 *   Type B (Page):    back=true。 スタック下階層で使用。
 *   Type B' (Save):   action に Accent Pill ボタンを注入、left=✕（キャンセル）想定。
 *
 * background: var(--ink-800), 白文字, 戻るボタン + タイトル + 右アクション の 3 スロット。
 * body max-width (430px) を越えて、広い画面でも横幅を viewport 全域に展開する。
 */

type Props = {
  title: string;
  back?: boolean;
  backHref?: string;
  action?: React.ReactNode;
};

export function AppHeader({ title, back, backHref, action }: Props) {
  const { navigating, goBack } = useNavigateWithLoading();
  const handleBack = () => goBack(backHref);

  return (
    <>
      {navigating && <LoadingOverlay message="読み込み中..." />}
      <div
        style={{
          background: "var(--ink-800)",
          color: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 100,
          // Full-bleed: body(max-width:430px) の外側までダークナビを拡張
          width: "100vw",
          marginLeft: "calc(50% - 50vw)",
          marginRight: "calc(50% - 50vw)",
          // safe-area-inset-top を吸収して status bar 下までナビ背景を延長。
          // iOS PWA の black-translucent status bar 越しに body コンテンツが
          // 透けて見えるのを防ぐ。
          padding: "14px max(16px, calc((100vw - 430px) / 2 + 16px))",
          paddingTop: "calc(14px + env(safe-area-inset-top, 0px))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {back && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="戻る"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                margin: 0,
                color: "#fff",
                cursor: "pointer",
                width: 36,
                height: 36,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <IconChevronLeft size={22} />
            </button>
          )}
          <div
            onClick={back ? handleBack : undefined}
            style={{
              fontSize: "var(--fs-lg)",
              fontWeight: 700,
              color: "#fff",
              lineHeight: 1.2,
              cursor: back ? "pointer" : "default",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
        </div>
        {action && (
          <div style={{ color: "rgba(255,255,255,0.85)", flexShrink: 0 }}>
            {action}
          </div>
        )}
      </div>
    </>
  );
}
