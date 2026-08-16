"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import {
  createTask,
  isTaskPriority,
  isTaskService,
  isTaskStatus,
  updateTask,
  type TaskPriority,
  type TaskService,
  type TaskStatus,
} from "@/lib/admin-tasks";

const TITLE_MAX = 400;
const DETAIL_MAX = 8000;
const NOTE_MAX = 2000;

async function clientMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

function str(fd: FormData, key: string, max: number): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * 課題を登録する。
 *
 * **入力は必ず検証してから書く。** 選択肢の値は画面から来るが、
 * Server Action は URL を知っていれば誰でも叩ける前提で書く
 * （`requireAdmin` は通すが、値の妥当性は別の話）。
 */
export async function addTask(formData: FormData) {
  const ctx = await requireAdmin("support_viewer");

  const service = formData.get("service");
  const priority = formData.get("priority");
  const title = str(formData, "title", TITLE_MAX);
  const detail = str(formData, "detail", DETAIL_MAX);

  if (!isTaskService(service)) throw new Error("対象サービスが不正です");
  if (priority && !isTaskPriority(priority)) throw new Error("優先度が不正です");
  if (!title) throw new Error("内容が空です");

  const row = await createTask({
    service: service as TaskService,
    title,
    detail: detail || null,
    priority: (priority as TaskPriority) || "mid",
  });

  await recordAuditLog(ctx, {
    action: "admin.tasks.created",
    // 🔴 本文は監査ログに写さない。件名も入れず、管理番号だけにする。
    // 自由記述を要約へコピーしない方針（2026-08-16 の `2c5fdbc`）。
    targetId: row.id,
    ...(await clientMeta()),
  });

  revalidatePath("/admin/tasks");
}

/** 状態・優先度・根拠メモの更新。 */
export async function editTask(formData: FormData) {
  const ctx = await requireAdmin("support_viewer");

  const id = str(formData, "id", 64);
  if (!id) throw new Error("対象が指定されていません");

  const human = formData.get("humanStatus");
  const ai = formData.get("aiStatus");
  const priority = formData.get("priority");
  const hasNote = formData.has("note");
  const note = str(formData, "note", NOTE_MAX);

  if (human && !isTaskStatus(human)) throw new Error("状態が不正です");
  if (ai && !isTaskStatus(ai)) throw new Error("状態が不正です");
  if (priority && !isTaskPriority(priority)) throw new Error("優先度が不正です");

  await updateTask(id, {
    humanStatus: (human as TaskStatus) || undefined,
    aiStatus: (ai as TaskStatus) || undefined,
    priority: (priority as TaskPriority) || undefined,
    ...(hasNote ? { note } : {}),
  });

  await recordAuditLog(ctx, {
    action: "admin.tasks.updated",
    targetId: id,
    ...(await clientMeta()),
  });

  revalidatePath("/admin/tasks");
}
