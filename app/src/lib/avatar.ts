"use client";

/**
 * Avatar upload / delete / URL helpers.
 *
 * Storage layout: bucket `toritavi-avatars`, path `<user_id>/avatar.jpg`.
 * The bucket is private (see supabase_migrations/008); object RLS pins
 * the first path segment to `auth.uid()::text` so no one can touch
 * another user's folder even with a valid JWT.
 *
 * The caller is always the authenticated browser client, not a server
 * route — the service role key stays out of the client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "toritavi-avatars";
const FILE_NAME = "avatar.jpg"; // client-side compression always outputs JPEG
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export function avatarPathFor(userId: string): string {
  return `${userId}/${FILE_NAME}`;
}

/**
 * Upload a cropped 512x512 blob for the authenticated user. Overwrites
 * any previous avatar.
 */
export async function uploadAvatar(
  sb: SupabaseClient,
  userId: string,
  blob: Blob
): Promise<string> {
  const path = avatarPathFor(userId);
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(path, blob, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "0",
    });
  if (error) throw error;
  return path;
}

export async function deleteAvatar(
  sb: SupabaseClient,
  userId: string
): Promise<void> {
  const path = avatarPathFor(userId);
  const { error } = await sb.storage.from(BUCKET).remove([path]);
  // "Object not found" is fine — the avatar was already absent.
  if (error && !/not found/i.test(error.message)) throw error;
}

/**
 * Create a short-lived signed URL for display. Returns null if the
 * object doesn't exist (first-time visitor / deleted) so callers can
 * fall back to the default avatar.
 */
export async function signedAvatarUrl(
  sb: SupabaseClient,
  path: string
): Promise<string | null> {
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Canvas-based crop → JPEG blob at a fixed output size (512x512).
 * `croppedAreaPixels` comes from react-easy-crop's onCropComplete.
 */
export async function cropImageToBlob(
  imageSrc: string,
  croppedAreaPixels: { x: number; y: number; width: number; height: number },
  outputSize = 512,
  quality = 0.85
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    outputSize,
    outputSize
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/jpeg",
      quality
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    // object URLs are same-origin; external URLs would need crossOrigin.
    img.src = src;
  });
}

/**
 * Read a File/Blob chosen from an <input type="file"> into an object URL.
 * Caller is responsible for revoking via URL.revokeObjectURL after use.
 */
export function fileToObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}
