"use client";

import { useEffect, useState } from "react";
import { Box, Loader, Progress, Text } from "@mantine/core";
import { IconCrown, IconMessageCircle, IconScan } from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { isGuestMode } from "@/lib/guest";

/*
 * /account/plan — Pro状態の読み取り専用表示。
 *
 * Web版から購入はできない（Apple IAP / Google Play Billing はモバイルアプリ
 * 経由のみ — 特定商取引法の記載どおり）。ここでは /api/ai-usage が返す
 * plan / 利用状況を表示し、free の場合はモバイルアプリへの案内のみ行う。
 * 実装プラン: ~/.claude/plans/snappy-churning-candle.md Phase 1d
 */

type FeatureUsage = {
  usedRequests: number;
  limitRequests: number;
};

type AiUsage = {
  plan: "free" | "pro";
  ocr: FeatureUsage;
  concierge: FeatureUsage;
};

export default function AccountPlanPage() {
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    const guest = isGuestMode();
    setIsGuest(guest);
    if (guest) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        // Cookieセッションで認証される（authenticateRequestがWeb側はCookie、
        // モバイルはBearerを見る。ここはWebなのでヘッダー不要）。
        const res = await fetch("/api/ai-usage");
        if (res.ok) {
          setUsage((await res.json()) as AiUsage);
        }
      } catch (e) {
        console.error("[account/plan] fetch failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isPro = usage?.plan === "pro";

  return (
    <>
      <AppHeader title="プラン" back backHref="/account" />
      <Box pb={110}>
        {isGuest ? (
          <Box style={{ padding: "14px 16px" }}>
            <Text size="sm" c="dimmed" lh={1.6}>
              プラン情報の確認には会員登録が必要です。
            </Text>
          </Box>
        ) : loading ? (
          <Box style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader size="sm" />
          </Box>
        ) : usage === null ? (
          <Box style={{ padding: "14px 16px" }}>
            <Text size="sm" c="dimmed" lh={1.6}>
              プラン情報を取得できませんでした。
            </Text>
          </Box>
        ) : (
          <>
            <Box style={{ padding: "14px 16px 4px" }}>
              <PlanBadge isPro={isPro} />
            </Box>

            <SectionLabel>AI利用状況</SectionLabel>
            <Card>
              <UsageRow
                icon={<IconScan size={18} color="var(--text-dim)" />}
                label="予定の自動登録（OCR）"
                u={usage.ocr}
              />
              <Box style={{ height: 1, background: "var(--n-100)" }} />
              <UsageRow
                icon={<IconMessageCircle size={18} color="var(--text-dim)" />}
                label="AIコンシェルジュ"
                u={usage.concierge}
              />
              <Text size="10.5px" c="dimmed" style={{ padding: "0 14px 14px" }}>
                OCR は今月分（翌月 1 日 0:00 JST にリセット）／ AIコンシェルジュは
                本日分（翌 0:00 JST にリセット）
              </Text>
            </Card>

            {!isPro && (
              <>
                <SectionLabel>Curlew Pro</SectionLabel>
                <Card>
                  <Box style={{ padding: 16 }}>
                    {/* ⚠️ 未実装の機能を書かない（CLAUDE.md「文言が実装に先行して
                        はならない」）。有料プランの差分は OCR 件数の解放だけ。 */}
                    <Text size="15px" fw={600} mb={6}>
                      予定の自動登録（OCR）が月 10 件 → 月 100 件に
                    </Text>
                    <Text size="13px" c="dimmed" lh={1.6}>
                      月額 480 円 / 年額 4,800 円（2 か月分お得）。Curlew Pro は
                      モバイルアプリからご登録いただけます（Apple In-App Purchase /
                      Google Play Billing、自動更新）。アプリのアカウント画面から
                      お申し込みください。
                    </Text>
                  </Box>
                </Card>
              </>
            )}
          </>
        )}
      </Box>
      <TabBar />
    </>
  );
}

/* ---------- subviews ---------- */

function PlanBadge({ isPro }: { isPro: boolean }) {
  return (
    <Box
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 20,
        background: isPro ? "var(--info-a10, rgba(17,132,199,0.1))" : "var(--n-100)",
        color: isPro ? "var(--info-700, #0C6296)" : "var(--text-dim)",
      }}
    >
      <IconCrown size={16} />
      <Text size="13px" fw={700}>
        {isPro ? "Curlew Pro" : "Free"}
      </Text>
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="11px"
      fw={700}
      c="gray.6"
      tt="uppercase"
      lts={0.5}
      style={{ padding: "16px 16px 8px" }}
    >
      {children}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        background: "white",
        margin: "0 16px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );
}

function UsageRow({
  icon,
  label,
  u,
}: {
  icon: React.ReactNode;
  label: string;
  u: FeatureUsage;
}) {
  const ratio = u.limitRequests > 0 ? u.usedRequests / u.limitRequests : 0;
  const near = ratio >= 0.8;
  return (
    <Box style={{ padding: 14 }}>
      <Box style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ flexShrink: 0 }}>{icon}</span>
        <Text size="13px" style={{ flex: 1 }}>
          {label}
        </Text>
        <Text size="12px" fw={600} c={near ? "var(--danger-700)" : "dimmed"}>
          {u.usedRequests} / {u.limitRequests}
        </Text>
      </Box>
      <Progress
        value={Math.min(ratio, 1) * 100}
        size="sm"
        color={near ? "red" : "blue"}
      />
    </Box>
  );
}
