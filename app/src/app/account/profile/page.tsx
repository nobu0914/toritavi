"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Drawer,
  Loader,
  Progress,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCamera,
  IconFlask,
  IconInfoCircle,
  IconPhoto,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AvatarCropModal } from "@/components/AvatarCropModal";
import { createClient } from "@/lib/supabase-browser";
import { isGuestMode } from "@/lib/guest";
import { getSettings, updateSettings } from "@/lib/store-settings";
import {
  avatarPathFor,
  deleteAvatar,
  fileToObjectUrl,
  signedAvatarUrl,
  uploadAvatar,
} from "@/lib/avatar";
import type { UserSettings } from "@/lib/types";

/*
 * /account/profile — DS v2 §3 + §4
 *   基本情報 + 旅程サポート項目 + プロフィール画像フロー。
 *   ログイン済み: 全フィールド + 画像変更/削除 + "保存する"
 *   ゲスト: 表示名 / TZ / 出発地 のみ + 画像は flask アイコンで固定 +
 *          "無料で会員登録する"
 */

const TZ_OPTIONS = [
  { value: "Asia/Tokyo", label: "Asia/Tokyo (GMT+9)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (GMT+9)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (GMT+8)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (GMT+8)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (GMT+7)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GMT+4)" },
  { value: "Europe/London", label: "Europe/London (GMT+0/+1)" },
  { value: "Europe/Paris", label: "Europe/Paris (GMT+1/+2)" },
  { value: "America/New_York", label: "America/New_York (GMT-5/-4)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (GMT-8/-7)" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu (GMT-10)" },
];

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState<UserSettings>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // avatar display
  const [avatarSignedUrl, setAvatarSignedUrl] = useState<string | null>(null);

  // avatar flow state
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const guest = isGuestMode();
    setIsGuest(guest);
    (async () => {
      try {
        const sb = createClient();
        if (!guest) {
          const { data: { user } } = await sb.auth.getUser();
          setEmail(user?.email ?? null);
          setUserId(user?.id ?? null);
        }
        const s = await getSettings();
        setForm(s);
        if (!guest && s.avatarUrl) {
          const url = await signedAvatarUrl(sb, s.avatarUrl);
          setAvatarSignedUrl(url);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const patch = (p: Partial<UserSettings>) => {
    setForm((cur) => ({ ...cur, ...p }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Partial<UserSettings> = {
        displayName: form.displayName ?? "",
        timezone: form.timezone ?? "",
        defaultOrigin: form.defaultOrigin ?? "",
      };
      if (!isGuest) payload.emergencyContact = form.emergencyContact ?? "";
      await updateSettings(payload);
      setDirty(false);
      notifications.show({ message: "保存しました" });
    } catch (e) {
      console.error("[profile] save failed", e);
      notifications.show({ color: "red", message: "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  };

  // ---- avatar flow ----

  const pickFromCamera = () => {
    setActionSheetOpen(false);
    cameraInputRef.current?.click();
  };
  const pickFromLibrary = () => {
    setActionSheetOpen(false);
    libraryInputRef.current?.click();
  };
  const askDeleteAvatar = () => {
    setActionSheetOpen(false);
    setDeleteDialog(true);
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again re-fires onChange.
    e.target.value = "";
    if (!file) return;
    setCropSrc(fileToObjectUrl(file));
  };

  const cancelCrop = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const applyCrop = async (blob: Blob) => {
    if (!userId) return;
    // Close crop modal first; profile page shows an indeterminate
    // progress bar while the upload finishes.
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setUploading(true);
    try {
      const sb = createClient();
      const path = await uploadAvatar(sb, userId, blob);
      await updateSettings({ avatarUrl: path });
      // Re-sign so the new bytes are visible (old signed URL still
      // points at the same path but may be cached by the browser).
      const url = await signedAvatarUrl(sb, path);
      // Cache-bust the signed URL so the browser refetches.
      setAvatarSignedUrl(url ? `${url}&v=${Date.now()}` : null);
      notifications.show({ message: "プロフィール画像を更新しました" });
    } catch (e) {
      console.error("[profile] upload avatar failed", e);
      notifications.show({
        color: "red",
        message: "画像のアップロードに失敗しました。もう一度お試しください。",
      });
    } finally {
      setUploading(false);
    }
  };

  const confirmDeleteAvatar = async () => {
    if (!userId) return;
    setDeleteDialog(false);
    setUploading(true);
    try {
      const sb = createClient();
      await deleteAvatar(sb, userId);
      await updateSettings({ avatarUrl: "" });
      setAvatarSignedUrl(null);
      notifications.show({ message: "プロフィール画像を削除しました" });
    } catch (e) {
      console.error("[profile] delete avatar failed", e);
      notifications.show({ color: "red", message: "削除に失敗しました" });
    } finally {
      setUploading(false);
    }
  };

  // ---- render ----

  return (
    <>
      <AppHeader title="プロフィール設定" back backHref="/account" />
      <Box pb={110} style={{ paddingBottom: 110 + 72 }}>
        {loading ? (
          <Box style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader size="sm" />
          </Box>
        ) : isGuest ? (
          <>
            <GuestBanner />
            <Box
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 16px 0",
              }}
            >
              <AvatarCircle>
                <IconFlask size={36} color="#fff" />
              </AvatarCircle>
              <Text size="xs" c="dimmed" mt={10}>
                画像変更は本登録後に利用できます
              </Text>
            </Box>

            <Box style={{ padding: "14px 16px 4px" }}>
              <Text size="sm" c="dimmed" lh={1.6}>
                端末内のみに保存されます。本登録するとクラウドに同期されます。
              </Text>
            </Box>
            <SectionLabel>基本情報</SectionLabel>
            <Card>
              <Field label="表示名">
                <TextInput
                  value={form.displayName ?? ""}
                  onChange={(e) => patch({ displayName: e.currentTarget.value })}
                  placeholder="端末内のみに保存"
                  variant="unstyled"
                />
              </Field>
              <Field label="タイムゾーン">
                <Select
                  data={TZ_OPTIONS}
                  value={form.timezone ?? null}
                  onChange={(v) => patch({ timezone: v ?? "" })}
                  placeholder="選択してください"
                  variant="unstyled"
                  searchable
                />
              </Field>
              <Field label="よく使う出発地" last>
                <TextInput
                  value={form.defaultOrigin ?? ""}
                  onChange={(e) => patch({ defaultOrigin: e.currentTarget.value })}
                  placeholder="例: 東京駅, 羽田空港"
                  variant="unstyled"
                />
              </Field>
            </Card>
          </>
        ) : (
          <>
            {/* Avatar + action buttons */}
            <Box
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "20px 16px 0",
              }}
            >
              <AvatarCircle>
                {avatarSignedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarSignedUrl}
                    alt="プロフィール画像"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <IconUser size={36} color="#fff" />
                )}
              </AvatarCircle>
              {uploading && (
                <Box style={{ width: 220, marginTop: 10 }}>
                  <Progress value={100} animated size="xs" />
                </Box>
              )}
              <Box style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setActionSheetOpen(true)}
                  disabled={uploading}
                  style={ghostBtn(uploading)}
                >
                  画像を変更
                </button>
                {avatarSignedUrl && (
                  <button
                    type="button"
                    onClick={() => setDeleteDialog(true)}
                    disabled={uploading}
                    style={outlineDangerBtn(uploading)}
                  >
                    削除
                  </button>
                )}
              </Box>
            </Box>

            <Box style={{ padding: "14px 16px 4px" }}>
              <Text size="sm" c="dimmed" lh={1.6}>
                アプリ内で表示されるあなたの情報を管理します。
              </Text>
            </Box>
            <SectionLabel>基本情報</SectionLabel>
            <Card>
              <Field label="表示名">
                <TextInput
                  value={form.displayName ?? ""}
                  onChange={(e) => patch({ displayName: e.currentTarget.value })}
                  placeholder="例: 田中 太郎"
                  variant="unstyled"
                />
              </Field>
              <Field label="メールアドレス" hint="ログイン ID のため変更不可">
                <TextInput value={email ?? ""} readOnly variant="unstyled" />
              </Field>
              <Field label="タイムゾーン" last>
                <Select
                  data={TZ_OPTIONS}
                  value={form.timezone ?? null}
                  onChange={(v) => patch({ timezone: v ?? "" })}
                  placeholder="選択してください"
                  variant="unstyled"
                  searchable
                />
              </Field>
            </Card>

            <SectionLabel>旅程サポート</SectionLabel>
            <Card>
              <Field label="よく使う出発地">
                <TextInput
                  value={form.defaultOrigin ?? ""}
                  onChange={(e) => patch({ defaultOrigin: e.currentTarget.value })}
                  placeholder="例: 東京駅, 羽田空港"
                  variant="unstyled"
                />
              </Field>
              <Field label="緊急連絡先" last>
                <TextInput
                  value={form.emergencyContact ?? ""}
                  onChange={(e) => patch({ emergencyContact: e.currentTarget.value })}
                  placeholder="海外出張時に同行者に共有"
                  variant="unstyled"
                />
              </Field>
            </Card>
          </>
        )}
      </Box>

      {/* Hidden file inputs (camera / library) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp"
        capture="environment"
        onChange={onFilePicked}
        style={{ display: "none" }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp"
        onChange={onFilePicked}
        style={{ display: "none" }}
      />

      {/* Action sheet (member only) */}
      <Drawer
        opened={actionSheetOpen && !isGuest}
        onClose={() => setActionSheetOpen(false)}
        position="bottom"
        size="auto"
        withCloseButton={false}
        zIndex={400}
        removeScrollProps={{ gapMode: "padding" }}
        styles={{
          inner: { justifyContent: "center" },
          content: {
            flex: "0 0 auto",
            width: "100%",
            maxWidth: 430,
            borderRadius: "16px 16px 0 0",
          },
          body: { padding: 0 },
        }}
      >
        <Box style={{ padding: "10px 0" }}>
          <Box
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "var(--n-200)",
              margin: "0 auto 8px",
            }}
          />
          <ActionRow
            icon={<IconCamera size={20} color="var(--text)" />}
            label="写真を撮る"
            onClick={pickFromCamera}
          />
          <ActionRow
            icon={<IconPhoto size={20} color="var(--text)" />}
            label="ライブラリから選ぶ"
            onClick={pickFromLibrary}
          />
          {avatarSignedUrl && (
            <ActionRow
              icon={<IconTrash size={20} color="var(--danger-500)" />}
              label="現在の画像を削除"
              onClick={askDeleteAvatar}
              danger
            />
          )}
          <Box style={{ padding: "8px 16px 16px" }}>
            <button
              type="button"
              onClick={() => setActionSheetOpen(false)}
              style={{
                width: "100%",
                height: 44,
                background: "white",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              キャンセル
            </button>
          </Box>
        </Box>
      </Drawer>

      {/* Crop modal */}
      <AvatarCropModal
        opened={!!cropSrc}
        imageSrc={cropSrc}
        onCancel={cancelCrop}
        onApply={applyCrop}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        opened={deleteDialog}
        onClose={() => setDeleteDialog(false)}
        onConfirm={confirmDeleteAvatar}
        title="プロフィール画像を削除しますか？"
        message="デフォルトのアイコン表示に戻ります。"
        confirmLabel="削除"
        severity="danger"
      />

      {/* Footer CTA */}
      {!loading && (
        <Box
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
            padding: "12px 16px",
            background: "white",
            borderTop: "1px solid var(--border)",
            zIndex: 90,
            maxWidth: 430,
            marginInline: "auto",
          }}
        >
          {isGuest ? (
            <Link
              href="/signup"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 48,
                borderRadius: 10,
                background: "var(--accent-500)",
                color: "white",
                fontSize: 16,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              無料で会員登録する
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving || uploading}
              style={{
                width: "100%",
                height: 48,
                borderRadius: 10,
                background: "var(--info-700)",
                color: "white",
                border: "none",
                fontSize: 16,
                fontWeight: 700,
                cursor: dirty && !saving && !uploading ? "pointer" : "not-allowed",
                opacity: dirty && !saving && !uploading ? 1 : 0.5,
                fontFamily: "inherit",
              }}
            >
              {saving ? "保存中…" : "保存する"}
            </button>
          )}
        </Box>
      )}

      <TabBar />
    </>
  );
}

/* ---------- UI primitives ---------- */

function AvatarCircle({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        width: 96,
        height: 96,
        borderRadius: "50%",
        background: "var(--ink-700)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        border: "2px solid white",
        boxShadow: "0 4px 14px rgba(15,27,45,0.18)",
      }}
    >
      {children}
    </Box>
  );
}

function GuestBanner() {
  return (
    <Box
      style={{
        margin: "16px 16px 0",
        padding: "12px 14px",
        background: "var(--warn-50)",
        border: "1px solid rgba(245,176,65,0.3)",
        borderRadius: 10,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <IconInfoCircle
        size={18}
        color="var(--warn-700)"
        style={{ flexShrink: 0, marginTop: 2 }}
      />
      <Box>
        <Text size="xs" fw={700} c="var(--warn-700)" lh={1.55}>
          ゲストモードです
        </Text>
        <Text size="xs" c="var(--warn-700)" lh={1.55} mt={2}>
          本登録すると画像と設定がクラウドに保存されます。
        </Text>
      </Box>
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

function Field({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        padding: "10px 14px",
        borderBottom: last ? "none" : "1px solid var(--n-100)",
      }}
    >
      <Text size="11px" fw={600} c="dimmed" mb={2}>
        {label}
      </Text>
      {children}
      {hint && (
        <Text size="11px" c="dimmed" mt={4}>
          {hint}
        </Text>
      )}
    </Box>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 20px",
        width: "100%",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--n-100)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 15,
        color: danger ? "var(--danger-500)" : "var(--text)",
        textAlign: "left",
      }}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    height: 36,
    padding: "0 14px",
    background: "transparent",
    color: "var(--info-700)",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
  };
}

function outlineDangerBtn(disabled: boolean): React.CSSProperties {
  return {
    height: 36,
    padding: "0 14px",
    background: "transparent",
    color: "var(--danger-500)",
    border: "1px solid rgba(231,76,60,0.3)",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
  };
}
