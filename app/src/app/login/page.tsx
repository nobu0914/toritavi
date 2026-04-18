"use client";

import { Alert, Button, Divider, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconBrandGoogle } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";
import { disableGuestMode, enableGuestMode } from "@/lib/guest";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("メールアドレスとパスワードを入力してください");
      return;
    }
    setLoading(true);
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      if (err) {
        setError(resolveAuthError(err.message));
        setLoading(false);
        return;
      }
      disableGuestMode();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
      setLoading(false);
    }
  };

  const handleGuest = () => {
    enableGuestMode();
    router.replace("/");
  };

  return (
    <AuthShell title="ログイン" subtitle="メールアドレスとパスワードでログインしてください。">
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
          <PasswordInput
            label="パスワード"
            placeholder="8文字以上"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            required
          />
          <Button type="submit" loading={loading} fullWidth mt="xs">
            ログイン
          </Button>
        </Stack>
      </form>

      <Stack gap={4} mt="md" align="center">
        <Link href="/forgot-password" style={{ fontSize: 13, color: "var(--info-700)" }}>
          パスワードをお忘れですか？
        </Link>
        <Text size="sm" c="dimmed" mt={4}>
          アカウントをお持ちでない方は{" "}
          <Link href="/signup" style={{ color: "var(--info-700)", fontWeight: 600 }}>
            新規登録
          </Link>
        </Text>
      </Stack>

      <Divider my="lg" label="または" labelPosition="center" />

      <Button
        variant="default"
        fullWidth
        leftSection={<IconBrandGoogle size={16} />}
        disabled
        title="Phase 2 で対応予定"
      >
        Google でログイン（準備中）
      </Button>

      <Divider my="lg" label="会員登録せずに試す" labelPosition="center" />

      <Button variant="light" color="gray" fullWidth onClick={handleGuest}>
        ゲストで試す（サンプルデータ）
      </Button>
      <Text size="xs" c="dimmed" ta="center" mt={8} lh={1.5}>
        サンプル旅程でアプリを体験できます。
        <br />
        データは端末内にのみ保存され、ログイン後は通常データと切り替わります。
      </Text>
    </AuthShell>
  );
}

function resolveAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "メールアドレスまたはパスワードが違います";
  if (m.includes("email not confirmed")) return "メール認証が完了していません。受信箱を確認してください";
  if (m.includes("too many requests")) return "試行回数が多すぎます。しばらくしてからお試しください";
  return message;
}
