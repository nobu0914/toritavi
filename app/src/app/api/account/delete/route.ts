import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import {
  DELETION_FAILURE_TABLE,
  NON_CASCADING_USER_TABLES,
  USER_OWNED_BUCKETS,
  type UserOwnedBucket,
} from "@/lib/user-data-ledger";

/**
 * POST /api/account/delete
 *
 * 退会。ブラウザのセッション Cookie（Web）か Bearer JWT（アプリ）で本人を
 * 確認し、service-role で後始末してから `auth.users` を消す。
 * 大半のテーブルは `auth.users` への `ON DELETE CASCADE` FK を持つので
 * 自動で消える。持たないもの（`user-data-ledger.ts` の台帳）だけ明示的に消す。
 *
 * ## 「消せたときだけ成功」ではない。「必ず出られる。ただし黙って残さない」
 *
 * 以前はすべての後始末が best-effort で、失敗しても警告を出して先へ進み、
 * 最後に `auth.users` を消して `ok` を返していた。コメントには
 * 「so the user is never left in a half-deleted state」とあったが、因果が
 * 逆だった —— **先に持ち主を消すから、残った写真を誰も再試行できなくなる。**
 *
 * かといって「失敗したら 500 を返してアカウントを残す」にも倒せない。
 * 消せないオブジェクトが 1 つあるだけで、押しても押しても消えない
 * アカウントができる。個人情報保護法・GDPR 17 条の削除請求に
 * 「スクリプトが失敗した」は理由にならない。
 *
 * よって:
 *
 * 1. 後始末を全部試す（1 つ失敗しても残りは続ける）
 * 2. 失敗があれば `toritavi_deletion_failures` に記録する
 * 3. **記録できたら** `auth.users` を消して `ok` を返す
 * 4. **記録にすら失敗したら消さない**（500）。痕跡なく残るのが最悪の結果で、
 *    ここだけはフェイルクローズにする
 *
 * ## 配備の順序
 *
 * `toritavi_deletion_failures` の DDL を**先に**適用すること。逆順にすると、
 * 後始末が失敗した退会が 3 で必ず 500 になる（安全側ではあるが退会できない）。
 * OCR クォータキーで学んだ「SQL（書き）→ コード（読み）の順」と同じ。
 */

const PAGE = 1000; // Supabase Storage list() の 1 ページあたり上限

/**
 * `prefix` 配下を全件返す。短いページが返るまで捲る。
 * list() は 1 回 1000 件で頭打ちなので、捲らないと重い利用者のフォルダが
 * 黙って消し残る。
 */
async function listAll(
  bucket: ReturnType<ReturnType<typeof createServiceClient>["storage"]["from"]>,
  prefix: string
): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw error; // 呼び出し元で捕捉し、削除不完全として記録する
    if (!data?.length) break;
    names.push(...data.map((e) => e.name));
    if (data.length < PAGE) break;
  }
  return names;
}

/** バケット内の `{userId}/` 配下を、台帳の depth に従って全部消す。 */
async function removeUserObjects(
  admin: ReturnType<typeof createServiceClient>,
  spec: UserOwnedBucket,
  userId: string
): Promise<void> {
  const bucket = admin.storage.from(spec.id);
  const paths: string[] = [];

  if (spec.depth === 1) {
    for (const name of await listAll(bucket, userId)) {
      paths.push(`${userId}/${name}`);
    }
  } else {
    for (const folder of await listAll(bucket, userId)) {
      for (const f of await listAll(bucket, `${userId}/${folder}`)) {
        paths.push(`${userId}/${folder}/${f}`);
      }
    }
  }

  // remove() も一度に渡せる件数に上限があるためチャンクで消す。
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await bucket.remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
}

/** 記録に残す失敗。`resource` は台帳のどれで失敗したかが分かる形にする。 */
type Failure = { resource: string; error: string };

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) return String(e.message);
  return String(e);
}

export async function POST(request: NextRequest) {
  // Reject cross-site browser callers. Origin is absent on native (mobile)
  // requests, so skip the check when it is not present.
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { sb, userId } = auth;

  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error("[account/delete] service client unavailable", e);
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const failures: Failure[] = [];

  // 1 つの失敗で残りを諦めない。消せるものは全部消してから判断する。
  for (const table of NON_CASCADING_USER_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      console.warn(`[account/delete] table ${table} failed`, error);
      failures.push({ resource: `table:${table}`, error: error.message });
    }
  }

  for (const spec of USER_OWNED_BUCKETS) {
    try {
      await removeUserObjects(admin, spec, userId);
    } catch (e) {
      console.warn(`[account/delete] bucket ${spec.id} failed`, e);
      failures.push({ resource: `bucket:${spec.id}`, error: describe(e) });
    }
  }

  // 消し残しがあるなら、**消す前に**記録する。ここが唯一のフェイルクローズ:
  // 記録できないまま持ち主を消すと、誰にも辿れないデータが残る。
  if (failures.length > 0) {
    const { error: logErr } = await admin.from(DELETION_FAILURE_TABLE).insert(
      failures.map((f) => ({
        user_id: userId,
        resource: f.resource,
        error: f.error.slice(0, 1000),
      }))
    );
    if (logErr) {
      console.error("[account/delete] could not record cleanup failures", logErr);
      return NextResponse.json(
        {
          error:
            "退会処理を完了できませんでした。お手数ですが時間をおいて再度お試しください。",
        },
        { status: 500 }
      );
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[account/delete] deleteUser failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort: clear the caller's cookie session (web). Mobile clients
  // sign out locally after a successful response.
  try {
    await sb.auth.signOut();
  } catch {
    /* session cookie clearing is nice-to-have */
  }

  // 消し残しの件数は返すが、利用者向けの文言にはしない（退会は成功している）。
  // 運用が拾うのは `toritavi_deletion_failures` の方。
  return NextResponse.json({ ok: true, pendingCleanup: failures.length });
}
