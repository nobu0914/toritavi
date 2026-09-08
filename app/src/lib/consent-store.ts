/**
 * 同意の記録を、**クライアントから書き換えられない場所**から読む（§5.1）。
 *
 * ## なぜ要るか
 *
 * `ai-consent.ts` の `classifyAiConsent` は `raw_user_meta_data` を見る。
 * そこは **利用者自身が `supabase.auth.updateUser(data:)` で書き換えられる。**
 * あちらのコメントも「🔴 これは悪意ある利用者を止めない」と明記している。
 *
 * ここは `public.toritavi_consent_records` を **service role で**読む。
 * その表は RLS に書き込みポリシーを 1 つも持たないので、
 * **書けるのはサーバだけ。**
 *
 * ## 🔴 フェイルクローズ
 *
 * 記録が無い・撤回済み・版が違う・**読めない**のいずれも `ok` にしない。
 * 特に「読めない」を通してはいけない —— 表が消えた・権限が落ちた・DB が
 * 落ちた、のどれでも「同意がある」ことにはならない（`CLAUDE.md` §5）。
 *
 * ## 🔴 クライアントの申告を材料にしない
 *
 * リクエストボディの `consent: true` のような値は**一切見ない。**
 * 引数は `userId` だけで、それは認証から来る。
 */
import { createServiceClient } from "@/lib/supabase-service";
import { AI_CONSENT_VERSION } from "@/lib/ai-consent";

export const CONSENT_TABLE = "toritavi_consent_records";

export type ServerConsentState =
  | { state: "ok"; version: string; locale: string }
  | { state: "missing" }
  | { state: "withdrawn"; withdrawnAt: string }
  | { state: "stale"; recorded: string }
  /** 🔴 表が無い・権限が無い・DB が落ちている。**通さない。** */
  | { state: "unavailable"; reason: string };

/**
 * その利用者の、いちばん新しい AI 送信の許諾。
 *
 * 🔴 **投げない。** 呼ぶ側が「通す／通さない」を決める。
 * ここで投げると、`/api/ocr` の他の関門より先に 500 になり、
 * 何が起きたか分からなくなる。
 */
export async function readAiConsent(userId: string): Promise<ServerConsentState> {
  let svc;
  try {
    svc = createServiceClient();
  } catch (e) {
    return { state: "unavailable", reason: `service_client:${(e as Error).name}` };
  }

  const { data, error } = await svc
    .from(CONSENT_TABLE)
    .select("document_version, legal_locale, accepted_at, withdrawn_at")
    .eq("user_id", userId)
    .eq("consent_type", "ai_processing")
    // 🔴 **`created_at desc, seq desc` で引く**（2026-09-08）。
    //    `accepted_at` だけだと、同じ時刻の行が 2 つあったときに
    //    **順序が決まらず、日によって違う行が「最新」になる。**
    .order("created_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(1);

  if (error) {
    // 🔴 **表が未適用のあいだもここへ来る。** それは「同意がある」ではない。
    //    移行中は AI_CONSENT_ENFORCE = false なので通るが、
    //    **観測ログには必ず残る**（貯まり具合を見るため）。
    return { state: "unavailable", reason: error.code ?? "query_error" };
  }
  const row = data?.[0];
  if (!row) return { state: "missing" };
  if (row.withdrawn_at) {
    // 🔴 **撤回後は新しい画像を送らない。** 行は消さずに残っているので、
    //    「いつ撤回したか」も分かる。
    return { state: "withdrawn", withdrawnAt: String(row.withdrawn_at) };
  }
  if (row.document_version !== AI_CONSENT_VERSION) {
    return { state: "stale", recorded: String(row.document_version) };
  }
  return {
    state: "ok",
    version: String(row.document_version),
    locale: String(row.legal_locale),
  };
}

/**
 * 記録する。**service role でのみ書ける。**
 *
 * 🔴 **版はサーバが決める。** クライアントから受け取らない ——
 * 受け取ると「古い版に同意した」と申告できてしまい、専用表にした意味が消える。
 */
export async function recordAiConsent(args: {
  userId: string;
  legalLocale: "ja" | "en";
  /** クライアントが申告した時刻。**参考情報。正式な受付時刻にしない。** */
  clientReportedAt?: string;
  appVersion?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const svc = createServiceClient();
    const { error } = await svc.from(CONSENT_TABLE).insert({
      user_id: args.userId,
      consent_type: "ai_processing",
      document_version: AI_CONSENT_VERSION, // 🔴 サーバの定数
      legal_locale: args.legalLocale,
      // 🔴 **`accepted_at` を渡さない**（2026-09-08）。DB の `default now()`
      //    が入る。端末の時計は利用者が変えられるので、クライアントの値を
      //    正式な受付時刻にすると**同意した時刻を自分で決められる。**
      client_reported_at: args.clientReportedAt ?? null,
      recipient: "Anthropic PBC",
      destination_country: "US",
      app_version: args.appVersion ?? null,
    });
    if (error) return { ok: false, reason: error.code ?? "insert_error" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).name };
  }
}

/** 撤回。**行を消さず `withdrawn_at` を立てる。** */
export async function withdrawAiConsent(
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const svc = createServiceClient();
    const { error } = await svc
      .from(CONSENT_TABLE)
      // 🔴 **DB の時刻で立てる**（2026-09-08）。サーバのプロセス時刻でも
      //    ずれうるので `now()` を使う。`.is("withdrawn_at", null)` により
      //    **何度呼んでも結果が変わらない**（冪等）。
      .update({ withdrawn_at: "now()" })
      .eq("user_id", userId)
      .eq("consent_type", "ai_processing")
      .is("withdrawn_at", null)
      .select("id");
    if (error) return { ok: false, reason: error.code ?? "update_error" };
    // 🔴 **0 行でも成功。** 既に撤回済み＝目的は達している（冪等）。
    //    ここで失敗にすると、再送のたびにエラーになる。
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).name };
  }
}

// ---------------------------------------------------------------------------
// 🔴 規約・プライバシーポリシーの同意（§5・2026-09-08）
// ---------------------------------------------------------------------------

/**
 * サーバが認める文書の版。**クライアントの申告値は使わない。**
 *
 * 🔴 **日英で別の文書。** 日本語 PP は Maptint と共有する `shared-privacy`、
 * 英語 PP は JUNROS 専用の `junros-privacy` で、訳ではない。
 * **片方の日付をもう片方へ写すと必ず間違う。**
 *
 * 🔴 **アプリ側の `legal_consent.dart` と同じ値。** ずれると、
 * 記録した版と画面に出した版が食い違う。`legal-versions.test.ts` が
 * アプリ側のファイルを読んで突き合わせる。
 */
export const TERMS_VERSIONS = { ja: "2026-08-30", en: "2026-09-07" } as const;
export const PRIVACY_VERSIONS = { ja: "2026-08-31", en: "2026-09-07" } as const;

export type LegalLocale = keyof typeof TERMS_VERSIONS;

/**
 * 規約とプライバシーポリシーの同意を**まとめて**記録する。
 *
 * 🔴 **片方だけ入る状態を作らない。** 1 回の insert で 2 行を入れる ——
 * PostgREST の複数行 insert は 1 文なので、**どちらか失敗すれば両方入らない。**
 * 別々に呼ぶと「規約だけ記録されて PP は失敗」が起こりうる。
 *
 * 🔴 **版も受付時刻もサーバが決める。** 引数は言語とアプリの版だけ。
 */
export async function recordLegalConsent(args: {
  userId: string;
  legalLocale: LegalLocale;
  clientReportedAt?: string;
  appVersion?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const common = {
    user_id: args.userId,
    legal_locale: args.legalLocale,
    client_reported_at: args.clientReportedAt ?? null,
    app_version: args.appVersion ?? null,
  };
  try {
    const svc = createServiceClient();
    const { error } = await svc.from(CONSENT_TABLE).insert([
      {
        ...common,
        consent_type: "terms",
        document_version: TERMS_VERSIONS[args.legalLocale],
      },
      {
        ...common,
        consent_type: "privacy",
        document_version: PRIVACY_VERSIONS[args.legalLocale],
      },
    ]);
    if (error) return { ok: false, reason: error.code ?? "insert_error" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).name };
  }
}
