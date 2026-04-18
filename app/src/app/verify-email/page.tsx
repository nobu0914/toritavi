"use client";

import { Alert, Button, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconMailCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase-browser";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const handleResend = async () => {
    if (!email) {
      setError("メールアドレスが指定されていません");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const sb = createClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: err } = await sb.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (err) {
        setError(err.message);
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
      setStatus("error");
    }
  };

  return (
    <AuthShell
      title="メールをご確認ください"
      subtitle="登録いただいたメールアドレス宛に認証リンクをお送りしました。リンクをタップすると登録が完了します。"
    >
      <Stack gap="md">
        <Stack gap={4} align="center" py="md">
          <IconMailCheck size={48} color="var(--info-500)" />
          {email && (
            <Text size="sm" fw={600} mt={8}>
              {email}
            </Text>
          )}
        </Stack>

        {status === "sent" && (
          <Alert color="teal" variant="light" p="xs">
            <Text size="sm">認証メールを再送信しました</Text>
          </Alert>
        )}
        {status === "error" && error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" p="xs">
            <Text size="sm">{error}</Text>
          </Alert>
        )}

        <Button
          variant="light"
          onClick={handleResend}
          loading={status === "sending"}
          fullWidth
        >
          認証メールを再送する
        </Button>

        <Text size="xs" c="dimmed" lh={1.6} ta="center">
          メールが届かない場合は迷惑メールフォルダもご確認ください。
          <br />
          認証が完了したらログイン画面からサインインしてください。
        </Text>

        <Button component={Link} href="/login" variant="subtle" fullWidth>
          ログイン画面へ
        </Button>
      </Stack>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
