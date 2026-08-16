/**
 * 課題管理（管理基幹）の読み書き。
 *
 * server-only: service-role クライアントを使う。**呼び出し元は必ず先に
 * `requireAdmin()` を通していること。**
 *
 * テーブルの定義と権限は `toritavi_app/supabase/admin_tasks.sql`。
 * RLS を有効にしてポリシーを 1 つも作っていないので、利用者のキーからは
 * 0 行になる。ここだけが触れる。
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase-service";

const TABLE = "toritavi_admin_tasks";

/** 課題を出すサービス。🔴 `maptint` が正（`mapint` ではない）。 */
export type TaskService = "junros" | "maptint" | "corporate" | "other";
export type TaskPriority = "low" | "mid" | "high";
export type TaskStatus = "todo" | "doing" | "done" | "wontfix";

export type TaskRow = {
  id: string;
  seq: number;
  service: TaskService;
  title: string;
  detail: string | null;
  priority: TaskPriority;
  humanStatus: TaskStatus;
  aiStatus: TaskStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export const SERVICE_LABEL: Record<TaskService, string> = {
  junros: "JUNROS",
  maptint: "Maptint",
  corporate: "コーポレートサイト",
  other: "その他",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "低",
  mid: "中",
  high: "高",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "未対応",
  doing: "対応中",
  done: "対応済み",
  wontfix: "対応しない",
};

export const SERVICES: TaskService[] = [
  "junros",
  "maptint",
  "corporate",
  "other",
];
export const PRIORITIES: TaskPriority[] = ["high", "mid", "low"];
export const STATUSES: TaskStatus[] = ["todo", "doing", "done", "wontfix"];

/** 管理番号。DB の連番をゼロ詰めして出す（000001）。 */
export function taskNo(seq: number): string {
  return String(seq).padStart(6, "0");
}

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}
export function isTaskService(v: unknown): v is TaskService {
  return typeof v === "string" && (SERVICES as string[]).includes(v);
}
export function isTaskPriority(v: unknown): v is TaskPriority {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v);
}

type Row = {
  id: string;
  seq: number;
  service: string;
  title: string;
  detail: string | null;
  priority: string;
  human_status: string;
  ai_status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

function toTask(r: Row): TaskRow {
  return {
    id: r.id,
    seq: r.seq,
    service: r.service as TaskService,
    title: r.title,
    detail: r.detail,
    priority: r.priority as TaskPriority,
    humanStatus: r.human_status as TaskStatus,
    aiStatus: r.ai_status as TaskStatus,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLUMNS =
  "id,seq,service,title,detail,priority,human_status,ai_status,note,created_at,updated_at";

export type TaskFilter = {
  service?: TaskService;
  /** 未完了だけ（人・AI のどちらかが done/wontfix でない）。 */
  openOnly?: boolean;
};

/**
 * テーブルがまだ無い、を表すエラー。
 *
 * **DDL は人が Supabase SQL Editor で流す**（`CLAUDE.md` §4）ので、
 * 画面の配信と適用の順番は前後しうる。そのとき 500 を返すと
 * 「壊れている」と「まだ作っていない」が区別できない。**名指しで伝える。**
 */
export class TasksTableMissingError extends Error {
  constructor() {
    super("課題管理のテーブルがまだ作られていません");
    this.name = "TasksTableMissingError";
  }
}

/** PostgREST が返す「テーブルが無い」。42P01 = undefined_table。 */
function isMissingTable(e: { code?: string; message?: string }): boolean {
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    /relation .* does not exist|could not find the table/i.test(e.message ?? "")
  );
}

/**
 * 一覧。新しい順。
 *
 * **失敗を握りつぶさない。** 読めなかったときに空配列を返すと、画面には
 * 「0 件」と出て、課題が無いのと区別が付かなくなる（`CLAUDE.md` §5
 * 「安全装置は静かに嘘をつかせない」）。
 */
export async function fetchTasks(
  limit = 200,
  filter: TaskFilter = {}
): Promise<TaskRow[]> {
  const sb = createServiceClient();
  let q = sb.from(TABLE).select(COLUMNS).order("seq", { ascending: false });
  if (filter.service) q = q.eq("service", filter.service);
  const { data, error } = await q.limit(limit);
  if (error) {
    if (isMissingTable(error)) throw new TasksTableMissingError();
    throw new Error(`課題を読めませんでした: ${error.message}`);
  }
  const rows = (data ?? []).map((r) => toTask(r as Row));
  return filter.openOnly
    ? rows.filter((t) => t.humanStatus !== "done" || t.aiStatus !== "done")
    : rows;
}

export async function fetchTask(id: string): Promise<TaskRow | null> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from(TABLE)
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new TasksTableMissingError();
    throw new Error(`課題を読めませんでした: ${error.message}`);
  }
  return data ? toTask(data as Row) : null;
}

/** サービス別の未完了件数。ダッシュボードの数字に使う。 */
export async function countOpenByService(): Promise<
  Record<TaskService, number>
> {
  const rows = await fetchTasks(1000, { openOnly: true });
  const out: Record<TaskService, number> = {
    junros: 0,
    maptint: 0,
    corporate: 0,
    other: 0,
  };
  for (const r of rows) out[r.service] += 1;
  return out;
}

export type CreateTaskInput = {
  service: TaskService;
  title: string;
  detail?: string | null;
  priority?: TaskPriority;
};

export async function createTask(input: CreateTaskInput): Promise<TaskRow> {
  const title = input.title.trim();
  if (!title) throw new Error("内容が空です");
  const sb = createServiceClient();
  const { data, error } = await sb
    .from(TABLE)
    .insert({
      service: input.service,
      title,
      detail: input.detail?.trim() || null,
      priority: input.priority ?? "mid",
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`登録できませんでした: ${error.message}`);
  return toTask(data as Row);
}

export type UpdateTaskInput = {
  humanStatus?: TaskStatus;
  aiStatus?: TaskStatus;
  priority?: TaskPriority;
  note?: string | null;
};

/**
 * 状態などの更新。
 *
 * 🔴 **更新できたことを確かめる。** `.select()` を付けないと、対象が
 * 見つからなくても成功として返り、呼び出し元は「変えました」と出す
 * （アプリ側の `moveStep` で同じ穴を踏んでいる）。
 */
export async function updateTask(
  id: string,
  input: UpdateTaskInput
): Promise<TaskRow> {
  const patch: Record<string, unknown> = {};
  if (input.humanStatus) patch.human_status = input.humanStatus;
  if (input.aiStatus) patch.ai_status = input.aiStatus;
  if (input.priority) patch.priority = input.priority;
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (Object.keys(patch).length === 0) throw new Error("変更がありません");

  const sb = createServiceClient();
  const { data, error } = await sb
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select(COLUMNS);
  if (error) throw new Error(`更新できませんでした: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) throw new Error("対象の課題が見つかりませんでした");
  return toTask(rows[0]);
}
