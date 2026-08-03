"use client";

import { Alert, Button, PasswordInput, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Supabase の英語メッセージを日本語に直す。
 *
 * **そのまま出さない。** 実機で "New password should be different from the
 * old password." が赤枠に英語のまま出た（2026-08-03）。他は日本語なので、
 * ここだけ英語だと「壊れている」と読まれる。
 *
 * 一致しないものは原文を捨てて汎用文にする。訳せない英語を出すくらいなら、
 * 何が起きたか分かる日本語のほうがよい。
 */
function friendlyUpdateError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("different from the old password")) {
    return "いま使っているパスワードと同じです。別のパスワードを入力してください。";
  }
  if (m.includes("should be at least") || m.includes("password is too short")) {
    return `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。`;
  }
  if (m.includes("expired") || m.includes("invalid")) {
    return "再設定リンクの有効期限が切れています。もう一度リンクを発行してください。";
  }
  if (m.includes("weak") || m.includes("pwned")) {
    return "推測されやすいパスワードです。別のパスワードを入力してください。";
  }
  return "パスワードを更新できませんでした。時間をおいて、もう一度お試しください。";
}

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
        setError(friendlyUpdateError(err.message));
        setLoading(false);
        return;
      }
      // Clear the recovery-pin cookie set by /auth/callback so middleware
      // stops forcing the user back to /reset-password. Non-HttpOnly for
      // this purpose — it is only a navigation signal, not a credential.
      document.cookie = "toritavi_recovery=; path=/; max-age=0; secure; samesite=lax";
      await sb.auth.signOut();
      setDone(true);
      setLoading(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? friendlyUpdateError(err.message)
          : "パスワード更新に失敗しました"
      );
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell
        title="パスワードを再設定しました"
        subtitle="アプリに戻って、新しいパスワードでログインしてください。"
      >
        <Stack gap="md" align="center" py="md">
          <IconCircleCheck size={48} color="var(--success-500)" />
          {/*
            Use a native anchor (full page load) instead of Mantine Button +
            Link. After signOut we want a clean navigation — client-side
            routing was silently failing on iOS Safari post-CSP-nonce.
          */}
          {/*
            **アプリに戻す。** ここに来る人の大半は iOS アプリから
            「パスワードをお忘れですか？」を押して飛んできている
            （アプリから送ると PKCE の verifier が合わず失敗するので、
            Web で始める設計）。それなのに導線が /login しか無かったため、
            再設定のあとそのまま**Web版にログインしてしまう**
            （2026-08-03 実機で判明）。Web版は開発を止めているので、
            アプリの利用者が着地する場所ではない。
            junros:// は iOS 側で登録済みのカスタム URL スキーム。
          */}
          <Button component="a" href="junros://open" fullWidth>
            JUNROS アプリに戻る
          </Button>
          <Button
            component="a"
            href="/login"
            variant="subtle"
            fullWidth
            onClick={() => {
              // Belt-and-suspenders: if the anchor is swallowed by some
              // event handler, force the navigation ourselves.
              window.location.href = "/login";
            }}
          >
            ブラウザで続ける
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
        <Link href="/login" style={{ color: "var(--info-700)" }}>
          ログイン画面に戻る
        </Link>
      </Text>
    </AuthShell>
  );
}
