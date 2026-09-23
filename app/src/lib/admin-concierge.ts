/**
 * 管理画面から、コンシェルジュの利用を見る。
 *
 * ## 🔴 2 つに分けてある（2026-09-23・利用者の指示で A と B の両方）
 *
 * | | 見えるもの | 役割 |
 * |---|---|---|
 * | **B 集約** | 件数・文字数・上限に当たった回数・最終時刻。**内容なし** | `support_viewer` |
 * | **A 明細** | **利用者が書いた質問文そのもの** | 🔴 `super_admin` のみ |
 *
 * **分けた理由**: いまの管理画面は `/admin/abuse` を見ても分かるとおり、
 * **集約した信号と状態だけを見せ、利用者のコンテンツは見せない**設計だった。
 * 内容を出すのはその方針を変えることなので、**同じ扱いにしない。**
 *
 * ## 🔴 出さないもの
 *
 * - **AI の返答**（求められたのは「質問した内容」）
 * - **旅程データ**（確認番号・メモを含む。質問文の判断には要らない）
 *
 * ## 🔴 公開文書の判断は済んでいない
 *
 * 公開プライバシーポリシーは第 3 条 6 に
 * 「不正利用の検知・防止、利用量・コストの管理」を利用目的として挙げるが、
 * **「運営者が利用者の入力内容を閲覧する」とは書いていない。**
 * 記載が要るかどうかは**法務の判断で、AI は決めない**（`CLAUDE.md` §4-1）。
 * **決まるまで A は `CONCIERGE_ADMIN_CONTENT` で閉じてある。**
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase-service";

/**
 * 🔴 **質問文の閲覧を開けるスイッチ。既定は閉じている。**
 *
 * 公開プライバシーポリシーへの記載が要るかの判断が済むまで、
 * **実装はあっても画面には出さない。** 決まったら env で開ける。
 * （`CLAUDE.md` §5「文言が実装に先行してはならない」の裏側 ——
 * **開示より先に閲覧を始めない。**）
 */
export const CONCIERGE_ADMIN_CONTENT =
  process.env.CONCIERGE_ADMIN_CONTENT === "true";

export type ConciergeUserSummary = {
  userId: string;
  email: string | null;
  messages: number;
  totalChars: number;
  maxChars: number;
  tokensIn: number;
  tokensOut: number;
  rejections: number;
  lastAt: string | null;
};

export type ConciergeMessageRow = {
  id: string;
  userId: string;
  email: string | null;
  createdAt: string;
  chars: number;
  /** 🔴 `CONCIERGE_ADMIN_CONTENT` が閉じているときは null。 */
  text: string | null;
};

/**
 * メールを引く（無ければ null）。`/admin/abuse` と同じやり方。
 *
 * 🔴 **`toritavi_user_status` には email 列が無い**（2026-09-23 に本番で確認）。
 *    そちらから引こうとすると**静かに全部 null になる** ——
 *    落ちも警告も出ないので気づけない（`CLAUDE.md` §6-1）。
 *    `admin-moderation.ts` の注記どおり、**1 件ずつ `getUserById`** で引く
 *    （`listUsers` はメール検索ができない）。
 */
async function emailsOf(userIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (userIds.length === 0) return out;
  const admin = createServiceClient();
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        out.set(id, data?.user?.email ?? null);
      } catch {
        out.set(id, null);
      }
    }),
  );
  return out;
}

/**
 * **B: 集約。内容は含まない。**
 *
 * 誰が・何通・どれくらいの長さを・いつ投げたか、上限に何回当たったか。
 */
export async function fetchConciergeSummary(
  days = 7,
  limit = 200,
): Promise<ConciergeUserSummary[]> {
  const admin = createServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // 🔴 **`content` を select しない。** 集約に本文は要らない ——
  //    要らないものを取らないのが、いちばん確実な漏れ防止。
  const { data: msgs } = await admin
    .from("toritavi_concierge_messages")
    .select("user_id, role, created_at, tokens_in, tokens_out")
    .gte("created_at", since)
    .limit(20000);

  // 本文の長さだけは別に取る（利用者メッセージのみ）。
  const { data: lens } = await admin
    .from("toritavi_concierge_messages")
    .select("user_id, content, created_at")
    .eq("role", "user")
    .gte("created_at", since)
    .limit(20000);

  const agg = new Map<string, ConciergeUserSummary>();
  const get = (uid: string) => {
    let v = agg.get(uid);
    if (!v) {
      v = {
        userId: uid, email: null, messages: 0, totalChars: 0, maxChars: 0,
        tokensIn: 0, tokensOut: 0, rejections: 0, lastAt: null,
      };
      agg.set(uid, v);
    }
    return v;
  };

  for (const m of msgs ?? []) {
    const uid = m.user_id as string | null;
    if (!uid) continue;
    const v = get(uid);
    if (m.role === "user") {
      v.messages += 1;
      const at = m.created_at as string;
      if (!v.lastAt || at > v.lastAt) v.lastAt = at;
    }
    v.tokensIn += Number(m.tokens_in ?? 0);
    v.tokensOut += Number(m.tokens_out ?? 0);
  }

  for (const m of lens ?? []) {
    const uid = m.user_id as string | null;
    if (!uid) continue;
    const n = String(m.content ?? "").length;
    const v = get(uid);
    v.totalChars += n;
    if (n > v.maxChars) v.maxChars = n;
  }

  const { data: rej } = await admin
    .from("toritavi_ai_rejections")
    .select("user_id")
    .eq("feature", "concierge")
    .gte("created_at", since)
    .limit(20000);
  for (const r of rej ?? []) {
    const uid = r.user_id as string | null;
    if (uid) get(uid).rejections += 1;
  }

  const rows = [...agg.values()]
    .sort((a, b) => b.messages - a.messages || b.rejections - a.rejections)
    .slice(0, limit);

  const mails = await emailsOf(rows.map((r) => r.userId));
  for (const r of rows) r.email = mails.get(r.userId) ?? null;
  return rows;
}

/**
 * **A: 明細。利用者が書いた質問文そのもの。**
 *
 * 🔴 **`CONCIERGE_ADMIN_CONTENT` が閉じていれば本文を返さない。**
 *    呼び出し側の規律に任せない —— **入口が増えたときに 1 つだけ
 *    通し忘れる形**が最も多い（`ocr_service.dart` の注記）。
 * 🔴 **`role='user'` のみ。** AI の返答は出さない。
 */
export async function fetchConciergeMessages(
  opts: { userId?: string; limit?: number; days?: number } = {},
): Promise<ConciergeMessageRow[]> {
  const { userId, limit = 100, days = 7 } = opts;
  const admin = createServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let q = admin
    .from("toritavi_concierge_messages")
    .select("id, user_id, created_at, content")
    .eq("role", "user")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 500));
  if (userId) q = q.eq("user_id", userId);

  const { data } = await q;
  const rows = (data ?? []).map((m) => ({
    id: m.id as string,
    userId: (m.user_id as string) ?? "",
    email: null as string | null,
    createdAt: m.created_at as string,
    chars: String(m.content ?? "").length,
    text: CONCIERGE_ADMIN_CONTENT ? ((m.content as string) ?? "") : null,
  }));

  const mails = await emailsOf([...new Set(rows.map((r) => r.userId))]);
  for (const r of rows) r.email = mails.get(r.userId) ?? null;
  return rows;
}
