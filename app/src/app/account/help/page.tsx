"use client";

import { useState } from "react";
import { Box, Modal, Text } from "@mantine/core";
import {
  IconBell,
  IconCamera,
  IconChevronRight,
  IconFileDescription,
  IconFlask,
  IconInfoCircle,
  IconLock,
  IconMail,
  IconShieldCheck,
} from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";

/*
 * /account/help — DS v2 §6 (account-subpages.html)
 * 閲覧専用、保存なし、footer CTA なし。
 * FAQ はタイル型 → タップで Modal 詳細、サポート / 規約はリスト行。
 */

type FaqItem = {
  id: string;
  title: string;
  sub: string;
  icon: React.ComponentType<{ size?: number }>;
  body: string;
};

const FAQS: FaqItem[] = [
  {
    id: "scan",
    title: "スキャン・OCR\nの使い方",
    sub: "自動登録の精度を上げるコツ",
    icon: IconCamera,
    body:
      "予定登録タブから「撮影」または「アップロード」で書類をスキャンできます。\n\n" +
      "精度を上げるコツ:\n" +
      "・予約番号・日時・便名がはっきり映るように撮影\n" +
      "・逆光や画面反射を避ける\n" +
      "・1枚に複数予約が混在する場合はトリミングで分けてから送信\n" +
      "・取り込み後「要確認」のついた項目は内容を必ず確認してください",
  },
  {
    id: "guest",
    title: "ゲストモード\nのデータ",
    sub: "本登録時の移行手順",
    icon: IconFlask,
    body:
      "ゲストモードで作成したデータは端末内（ブラウザ）のみに保存されています。\n\n" +
      "本登録の手順:\n" +
      "1. アカウントタブから「無料で会員登録する」をタップ\n" +
      "2. メールアドレスとパスワードを設定\n" +
      "3. メール内のリンクで認証を完了\n\n" +
      "現時点ではゲストデータは自動移行されません。端末でログイン後、再度登録してください。",
  },
  {
    id: "notifications",
    title: "通知が来ない\nときは？",
    sub: "OS 設定との連携",
    icon: IconBell,
    body:
      "通知が届かない場合は以下を確認してください:\n\n" +
      "・端末のシステム設定で toritavi の通知が許可されているか\n" +
      "・アプリ内「通知設定」で受け取りたい通知がオンか\n" +
      "・機内モードや集中モードが有効になっていないか\n\n" +
      "ブラウザ版（Web）ではプッシュ通知は現時点で未対応です。",
  },
  {
    id: "privacy",
    title: "データ\nプライバシー",
    sub: "保存場所と暗号化",
    icon: IconLock,
    body:
      "データの扱い:\n\n" +
      "・会員データは Supabase（EU ap-northeast-1 ほか）に暗号化保存\n" +
      "・RLS で本人以外はアクセス不可\n" +
      "・通信は TLS で保護、ブラウザ側も CSP で XSS 耐性を付与\n" +
      "・画像はプライベート Storage bucket に保存、署名付き URL でのみ参照\n\n" +
      "詳細はプライバシーポリシーをご参照ください。",
  },
];

export default function HelpPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = FAQS.find((f) => f.id === openId) ?? null;

  return (
    <>
      <AppHeader title="ヘルプ・サポート" back backHref="/account" />
      <Box pb={110}>
        <Box style={{ padding: "14px 16px 4px" }}>
          <Text size="sm" c="dimmed" lh={1.6}>
            よくある質問や、お問い合わせ窓口を確認できます。
          </Text>
        </Box>

        {/* よくある質問 — タイル 2x2 */}
        <SectionLabel>よくある質問</SectionLabel>
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            margin: "0 16px 12px",
          }}
        >
          {FAQS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setOpenId(f.id)}
                style={{
                  background: "white",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 14,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "var(--n-50)",
                    color: "var(--ink-700)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={18} />
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1.35,
                    whiteSpace: "pre-line",
                  }}
                >
                  {f.title}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
                  {f.sub}
                </span>
              </button>
            );
          })}
        </Box>

        {/* サポート */}
        <SectionLabel>サポート</SectionLabel>
        <Card>
          <Row
            icon={<IconMail size={18} color="var(--text-dim)" />}
            label="お問い合わせ"
            sub="support@toritavi.com"
            href="mailto:support@toritavi.com"
          />
          <Row
            icon={<IconInfoCircle size={18} color="var(--text-dim)" />}
            label="不具合を報告"
            sub="件名に「不具合」を含めてください"
            href="mailto:support@toritavi.com?subject=%E4%B8%8D%E5%85%B7%E5%90%88%E3%81%AE%E5%A0%B1%E5%91%8A"
          />
          <Row
            icon={<IconShieldCheck size={18} color="var(--text-dim)" />}
            label="セキュリティ窓口"
            sub="/.well-known/security.txt"
            href="/.well-known/security.txt"
            last
          />
        </Card>

        {/* 規約・ポリシー */}
        <SectionLabel>規約・ポリシー</SectionLabel>
        <Card>
          <Row
            icon={<IconFileDescription size={18} color="var(--text-dim)" />}
            label="利用規約"
            href="/terms"
          />
          <Row
            icon={<IconLock size={18} color="var(--text-dim)" />}
            label="プライバシーポリシー"
            href="/privacy"
            last
          />
        </Card>

        {/* アプリ版数 */}
        <Text
          size="xs"
          c="dimmed"
          ta="center"
          style={{ padding: "24px 16px 8px", lineHeight: 1.6 }}
        >
          toritavi v1.0.0 · 最終更新 2026-04-20
        </Text>
      </Box>

      {/* FAQ 詳細 Modal */}
      <Modal
        opened={!!openItem}
        onClose={() => setOpenId(null)}
        title={openItem ? openItem.title.replace(/\n/g, "") : ""}
        centered
        radius="md"
        size="sm"
        styles={{ title: { fontWeight: 700 } }}
      >
        {openItem && (
          <Text
            size="sm"
            c="var(--text)"
            style={{ whiteSpace: "pre-line", lineHeight: 1.7 }}
          >
            {openItem.body}
          </Text>
        )}
      </Modal>

      <TabBar />
    </>
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

function Row({
  icon,
  label,
  sub,
  href,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  href: string;
  last?: boolean;
}) {
  const external = href.startsWith("mailto:") || href.startsWith("http");
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderBottom: last ? "none" : "1px solid var(--n-100)",
        fontSize: 15,
        color: "var(--text)",
        textDecoration: "none",
      }}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", lineHeight: 1.35 }}>{label}</span>
        {sub && (
          <span
            style={{
              display: "block",
              fontSize: 12,
              color: "var(--text-dim)",
              marginTop: 2,
            }}
          >
            {sub}
          </span>
        )}
      </span>
      <IconChevronRight size={18} color="var(--n-300)" />
    </a>
  );
}
