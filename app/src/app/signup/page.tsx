"use client";

import { Alert, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const validate = (): string | null => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "メールアドレスの形式が正しくありません";
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください`;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return "パスワードは英字と数字を含めてください";
    }
    if (password !== passwordConfirm) {
      return "パスワードが一致しません";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    try {
      const sb = createClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { data, error: err } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (err) {
        setError(resolveSignupError(err.message));
        setLoading(false);
        return;
      }
      // Supabase returns user with empty `identities` array when the email is already registered.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setError("このメールアドレスは既に登録されています");
        setLoading(false);
        return;
      }
      router.replace(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="新規登録" subtitle="メールアドレスとパスワードで新規登録します。">
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
            description="英字と数字を含む8文字以上"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="new-password"
            required
          />
          <PasswordInput
            label="パスワード（確認）"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.currentTarget.value)}
            autoComplete="new-password"
            required
          />
          <Button type="submit" loading={loading} fullWidth mt="xs">
            登録する
          </Button>
        </Stack>
      </form>

      <Text size="sm" c="dimmed" ta="center" mt="md">
        既にアカウントをお持ちの方は{" "}
        <Link href="/login" style={{ color: "var(--info-700)", fontWeight: 600 }}>
          ログイン
        </Link>
      </Text>
    </AuthShell>
  );
}

function resolveSignupError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered"))
    return "このメールアドレスは既に登録されています";
  if (m.includes("password should be")) return "パスワードが安全性の条件を満たしていません";
  if (m.includes("unable to validate email"))
    return "メールアドレスが無効です";
  return message;
}
