"use client";

import { Alert, Button, Divider, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconBrandGoogle } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";
import { disableGuestMode, enableGuestMode } from "@/lib/guest";
import { clearGuestData } from "@/lib/store-guest";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // auth/callback がエラー時に付ける ?error= を初期表示する（期限切れ/使用済みの
  // 確認・再設定リンクを無言で握りつぶさない）。以降はフォーム操作で上書きされる。
  const [error, setError] = useState(() => {
    const code = searchParams.get("error");
    return code ? resolveCallbackError(code) : "";
  });

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
      // Clear any leftover guest localStorage so the newly-logged-in user
      // doesn't see the previous occupant's sample / draft data on a shared
      // device. The cookie and the localStorage flag are both cleared by
      // disableGuestMode; clearGuestData removes the actual journey data.
      disableGuestMode();
      clearGuestData();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
      setLoading(false);
    }
  };

  const handleGuest = () => {
    // Start the guest preview from a clean slate so the current visitor
    // doesn't inherit sample data edited by a previous guest on this device.
    clearGuestData();
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function resolveCallbackError(code: string): string {
  const c = code.toLowerCase();
  if (c === "missing_code") return "リンクが無効です。もう一度お試しください。";
  if (c.includes("expired") || c.includes("otp")) {
    return "リンクの有効期限が切れています。お手数ですが、もう一度メールを送信してください。";
  }
  if (c.includes("invalid") || c.includes("used")) {
    return "リンクが無効か、既に使用されています。もう一度お試しください。";
  }
  return "認証に失敗しました。もう一度お試しください。";
}

function resolveAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "メールアドレスまたはパスワードが違います";
  if (m.includes("email not confirmed")) return "メール認証が完了していません。受信箱を確認してください";
  if (m.includes("too many requests")) return "試行回数が多すぎます。しばらくしてからお試しください";
  return message;
}
