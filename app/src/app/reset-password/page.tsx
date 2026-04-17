"use client";

import { Alert, Button, PasswordInput, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  // Ensure we arrived with a recovery session.
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        setError("再設定リンクが無効か期限切れです。もう一度リンクを発行してください。");
      }
      setReady(true);
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください`);
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("パスワードは英字と数字を含めてください");
      return;
    }
    if (password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    setLoading(true);
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.updateUser({ password });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      await sb.auth.signOut();
      setDone(true);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "パスワード更新に失敗しました");
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell
        title="パスワードを再設定しました"
        subtitle="新しいパスワードでログインしてください。"
      >
        <Stack gap="md" align="center" py="md">
          <IconCircleCheck size={48} color="var(--mantine-color-teal-6)" />
          <Button component={Link} href="/login" fullWidth>
            ログイン画面へ
          </Button>
        </Stack>
      </AuthShell>
    );
  }

  if (!ready) {
    return (
      <AuthShell title="パスワード再設定">
        <Text size="sm" c="dimmed" ta="center" py="md">
          読み込み中...
        </Text>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="新しいパスワード" subtitle="新しいパスワードを設定してください。">
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" p="xs">
              <Text size="sm">{error}</Text>
            </Alert>
          )}
          <PasswordInput
            label="新しいパスワード"
            description="英字と数字を含む8文字以上"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="new-password"
            required
          />
          <PasswordInput
            label="新しいパスワード（確認）"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.currentTarget.value)}
            autoComplete="new-password"
            required
          />
          <Button type="submit" loading={loading} fullWidth mt="xs">
            パスワードを更新
          </Button>
        </Stack>
      </form>

      <Text size="sm" c="dimmed" ta="center" mt="md">
        <Link href="/login" style={{ color: "var(--mantine-color-blue-7)" }}>
          ログイン画面に戻る
        </Link>
      </Text>
    </AuthShell>
  );
}
