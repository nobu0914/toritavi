import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import {
  fetchTasks,
  TasksTableMissingError,
  isTaskService,
  taskNo,
  PRIORITIES,
  PRIORITY_LABEL,
  SERVICES,
  SERVICE_LABEL,
  STATUSES,
  STATUS_LABEL,
  type TaskRow,
  type TaskService,
} from "@/lib/admin-tasks";
import { addTask, editTask } from "./actions";

export const dynamic = "force-dynamic";

const DIM = "var(--text-dim)";

function fmt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRIORITY_BG: Record<string, string> = {
  high: "#fde8e8",
  mid: "#fef3e2",
  low: "#eef1f4",
};
const PRIORITY_FG: Record<string, string> = {
  high: "#a32d2d",
  mid: "#854f0b",
  low: "#5f5e5a",
};

/** 「済み」に見えるか。人と AI の両方が片付いて初めて閉じたとみなす。 */
function isClosed(t: TaskRow) {
  const done = (s: string) => s === "done" || s === "wontfix";
  return done(t.humanStatus) && done(t.aiStatus);
}

/** テーブル未適用のときに出す板。**何をすれば直るかまで書く。** */
function NotApplied() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>課題管理</h1>
      <div
        style={{
          padding: 16,
          border: "1px solid #f0c14b",
          background: "#fffaf0",
          borderRadius: 12,
          fontSize: 14,
          lineHeight: 1.8,
        }}
      >
        <strong>テーブルがまだ作られていません。</strong>
        <br />
        画面は配信済みですが、DDL は人が Supabase SQL Editor で流す決まりです。
        <br />
        <code>toritavi_app/supabase/admin_tasks.sql</code> を貼って実行し、
        このページを再読み込みしてください。
        <br />
        <span style={{ color: DIM, fontSize: 13 }}>
          適用後は同ファイル末尾の確認クエリ（RLS が t / ポリシー 0 件 /
          匿名キーで読めない）まで通すこと。
        </span>
      </div>
    </div>
  );
}

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; all?: string }>;
}) {
  const ctx = await requireAdmin("support_viewer");

  const h = await headers();
  await recordAuditLog(ctx, {
    action: "admin.tasks.viewed",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const sp = await searchParams;
  const service = isTaskService(sp.service)
    ? (sp.service as TaskService)
    : undefined;
  const showAll = sp.all === "1";

  // **テーブルがまだ無い場合を 500 にしない。** DDL は人が SQL Editor で
  // 流すので、配信と適用の順番は前後する。「壊れている」と「まだ作って
  // いない」を画面で区別する。
  let rows: TaskRow[];
  try {
    rows = await fetchTasks(300, { service });
  } catch (e) {
    if (e instanceof TasksTableMissingError) return <NotApplied />;
    throw e;
  }
  const shown = showAll ? rows : rows.filter((t) => !isClosed(t));
  const openCount = rows.filter((t) => !isClosed(t)).length;

  const qs = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const s = next.service ?? service;
    const a = next.all ?? (showAll ? "1" : undefined);
    if (s) p.set("service", s);
    if (a) p.set("all", a);
    const q = p.toString();
    return q ? `/admin/tasks?${q}` : "/admin/tasks";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>課題管理</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: DIM }}>
          JUNROS・Maptint・コーポレートサイトの課題をここに集める。
          <strong>「私判断」と「AI判断」は別々に持つ</strong>
          ——AI が直したつもりでも、人が確認するまで閉じない。
        </p>
      </section>

      {/* 登録 */}
      <form
        action={addTask}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
          border: "1px solid var(--n-200, #e3e8ee)",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>
            対象{" "}
            <select name="service" defaultValue="junros" style={{ padding: 6 }}>
              {SERVICES.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            優先度{" "}
            <select name="priority" defaultValue="mid" style={{ padding: 6 }}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          name="title"
          required
          maxLength={400}
          placeholder="修正してほしい内容"
          style={{ padding: 8, fontSize: 14 }}
        />
        <textarea
          name="detail"
          rows={2}
          maxLength={8000}
          placeholder="補足（任意）"
          style={{ padding: 8, fontSize: 13 }}
        />
        <button type="submit" style={{ padding: "8px 16px", alignSelf: "flex-start" }}>
          登録
        </button>
      </form>

      {/* 絞り込み */}
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
        <a href={qs({ service: undefined })} style={{ fontWeight: service ? 400 : 700 }}>
          すべて
        </a>
        {SERVICES.map((s) => (
          <a key={s} href={qs({ service: s })} style={{ fontWeight: service === s ? 700 : 400 }}>
            {SERVICE_LABEL[s]}
          </a>
        ))}
        <span style={{ marginLeft: "auto", color: DIM }}>
          未完了 {openCount} 件 / 全 {rows.length} 件{" "}
          <a href={qs({ all: showAll ? undefined : "1" })}>
            {showAll ? "未完了だけ表示" : "完了も表示"}
          </a>
        </span>
      </nav>

      {shown.length === 0 && (
        <p style={{ fontSize: 13, color: DIM }}>
          {showAll ? "課題がありません。" : "未完了の課題はありません。"}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((t) => (
          <form
            key={t.id}
            action={editTask}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 14,
              border: "1px solid var(--n-200, #e3e8ee)",
              borderRadius: 12,
              opacity: isClosed(t) ? 0.55 : 1,
            }}
          >
            <input type="hidden" name="id" value={t.id} />

            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 12, color: "var(--brand, #0e72ae)" }}>
                {SERVICE_LABEL[t.service]}
              </strong>
              <span style={{ fontSize: 12, color: DIM }}>管理番号 {taskNo(t.seq)}</span>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 10,
                  background: PRIORITY_BG[t.priority],
                  color: PRIORITY_FG[t.priority],
                }}
              >
                優先度 {PRIORITY_LABEL[t.priority]}
              </span>
              <span style={{ fontSize: 12, color: DIM, marginLeft: "auto" }}>
                {fmt(t.createdAt)}
              </span>
            </div>

            <div style={{ fontSize: 15 }}>{t.title}</div>
            {t.detail && (
              <div style={{ fontSize: 13, color: DIM, whiteSpace: "pre-wrap" }}>
                {t.detail}
              </div>
            )}

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 12, color: DIM }}>
                私判断
                <br />
                <select name="humanStatus" defaultValue={t.humanStatus} style={{ padding: 5 }}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: DIM }}>
                AI判断
                <br />
                <select name="aiStatus" defaultValue={t.aiStatus} style={{ padding: 5 }}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: DIM, flex: 1, minWidth: 220 }}>
                根拠（コミットハッシュなど）
                <br />
                <input
                  name="note"
                  defaultValue={t.note ?? ""}
                  maxLength={2000}
                  placeholder="例: db32fc3"
                  style={{ padding: 6, fontSize: 13, width: "100%" }}
                />
              </label>
              <button type="submit" style={{ padding: "6px 14px" }}>
                更新
              </button>
            </div>
          </form>
        ))}
      </div>

      <p style={{ fontSize: 12, color: DIM, marginTop: 4 }}>
        添付ファイルはまだ扱えない。移行元（修正管理サイト）に残っているものは、
        必要なら根拠欄に置き場所を書いておく。
      </p>
    </div>
  );
}
