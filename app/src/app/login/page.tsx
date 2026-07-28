"use client";

import { Alert, Button, Divider, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";
import { disableGuestMode } from "@/lib/guest";
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
      router.replace("/account/data");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
      setLoading(false);
    }
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

      {/* Web の新規登録・ゲスト体験・Google ログインは Phase 1 では出さない。
          旅程やスキャンの画面を閉じたので、押した先に見るものが無い。
          押せるのに何も起きない導線は、無いより悪い。 */}
      <Stack gap={4} mt="md" align="center">
        <Link href="/forgot-password" style={{ fontSize: 13, color: "var(--info-700)" }}>
          パスワードをお忘れですか？
        </Link>
      </Stack>

      <Divider my="lg" />

      {/* **これから何をする画面なのかを先に言う。** 以前は
          「Web でできるのは〜だけです」と、できないことから書いていた。
          ログイン前の人には何のために来たのかが伝わらず、制限の告知だけが
          残る（2026-07-28 に「意味が不明」と指摘を受けて書き直し）。 */}
      <Text size="xs" c="dimmed" ta="center" lh={1.6}>
        このページは、データの書き出しとアカウント削除のためのものです。
        <br />
        旅程の作成・編集は JUNROS アプリ（iPhone）で行えます。
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
