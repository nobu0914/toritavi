"use client";

import { Alert, Button, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconMailCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("メールアドレスの形式が正しくありません");
      return;
    }
    setLoading(true);
    try {
      const sb = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?type=recovery`;
      const { error: err } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setSent(true);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="メールを送信しました"
        subtitle="パスワード再設定リンクを送信しました。メールをご確認ください。"
      >
        <Stack gap="md" align="center" py="md">
          <IconMailCheck size={48} color="var(--info-500)" />
          <Text size="sm" fw={600}>{email}</Text>
          <Text size="xs" c="dimmed" ta="center" lh={1.6}>
            メールが届かない場合は迷惑メールフォルダもご確認ください。
          </Text>
          <Button component={Link} href="/login" variant="subtle" fullWidth>
            ログイン画面へ
          </Button>
        </Stack>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="パスワード再設定"
      subtitle="登録メールアドレスに再設定リンクをお送りします。"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" p="xs">
              <Text size="sm">{error}</Text>
            </Alert>
          )}
          <TextInput
            label="メールアドレス"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            autoComplete="email"
            required
          />
          <Button type="submit" loading={loading} fullWidth mt="xs">
            再設定リンクを送信
          </Button>
        </Stack>
      </form>

      <Text size="sm" c="dimmed" ta="center" mt="md">
        <Link href="/login" style={{ color: "var(--info-700)" }}>
          ログイン画面に戻る
        </Link>
      </Text>
    </AuthShell>
  );
}
