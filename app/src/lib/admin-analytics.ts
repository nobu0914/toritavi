/**
 * Admin analytics aggregation for /admin/analytics.
 *
 * server-only, service-role (bypasses RLS). Callers must have passed
 * requireAdmin() first, mirroring admin-queries.ts.
 *
 * Sources:
 *  - affiliate_clicks  (Flutter-defined): per-click rows → clicks by day /
 *    program / type / surface / A/B bucket.
 *  - toritavi_ad_impressions: daily aggregate of Tier B card views → CTR.
 *  - toritavi_affiliate_rates: admin EPC (推定 1 クリック収益) → est. revenue.
 *  - toritavi_ocr_usage / toritavi_concierge_usage: daily request trend.
 *  - toritavi_ocr_budget / toritavi_concierge_budget: month AI spend (原価).
 *  - auth.users: signups / active (capped at 1000 — MVP, same as admin-queries).
 *
 * All money in ¥. AI cost の spend_cents は既存 UI 慣習に合わせ /100 で ¥ 換算。
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase-service";

type Client = ReturnType<typeof createServiceClient>;

const CLICKS_MAX_PAGES = 20; // 20 × 1000 = 2万クリックまで（超過は capped フラグ）
const PAGE = 1000;

export type DailyPoint = { day: string; value: number };

export type ProgramStat = {
  program: string;
  label: string;
  epcYen: number;
  commissionNote: string | null;
  active: boolean;
  /**
   * 提携承認済みか（`affiliate_programs.approved_at` 非 NULL）。
   * **false の間はアプリが広告を出さない**ので、クリックも売上も 0 のままになる。
   * 「設定したのに数字が動かない」の原因がこれだと画面で分かるようにする。
   */
  approved: boolean;
  clicks: number;
  impressions: number;
  ctr: number | null; // clicks / impressions（impressions=0 は null）
  revenueYen: number; // clicks × epcYen
};

export type AnalyticsData = {
  period: { days: number; startDay: string; endDay: string };
  affiliate: {
    hasData: boolean;
    totalClicks: number;
    totalImpressions: number;
    ctr: number | null;
    estRevenueYen: number;
    dailyClicks: DailyPoint[];
    byProgram: ProgramStat[];
    byType: { type: string; clicks: number }[];
    bySurface: { surface: string; clicks: number }[];
    byBucket: { bucket: string; clicks: number }[];
    clicksCapped: boolean;
  };
  usage: {
    dailySignups: DailyPoint[];
    dailyOcr: DailyPoint[];
    dailyConcierge: DailyPoint[];
    signupsCapped: boolean;
  };
  economics: {
    monthLabel: string;
    monthRevenueYen: number;
    monthAiCostYen: number;
    monthNetYen: number;
  };
  activeUsers: number; // 期間内にログインしたユーザー数（capped）
};

// ---- date helpers (UTC, matches admin-queries) ----
function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function monthFirstStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
/** N 日分の日付キー配列（古い順）。トレンドの穴埋め用。 */
function dayRange(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(dayStr(d));
  }
  return out;
}
function fillDaily(keys: string[], counts: Map<string, number>): DailyPoint[] {
  return keys.map((day) => ({ day, value: counts.get(day) ?? 0 }));
}

/** subid = {trip_id}.{type}.{surface}.{ab_bucket}。trip_id は UUID(ドット無し)。 */
function parseSubid(subid: string | null): { type: string; bucket: string } {
  if (!subid) return { type: "unknown", bucket: "-" };
  const parts = subid.split(".");
  // [uuid, type, surface, bucket]
  return { type: parts[1] || "unknown", bucket: parts[3] || "-" };
}

export async function fetchAnalytics(days = 30): Promise<AnalyticsData> {
  const admin = createServiceClient();
  const now = new Date();
  const keys = dayRange(days);
  const periodStart = keys[0];
  const endDay = keys[keys.length - 1];
  const monthStart = monthFirstStr(now);
  // union window = 期間開始と月初の早い方（月次経済指標も同じ取得で賄う）
  const windowStart = periodStart < monthStart ? periodStart : monthStart;

  const [rates, clicksRes, impressions, usage, economicsMonth, users] =
    await Promise.all([
      fetchRates(admin),
      fetchClicks(admin, windowStart),
      fetchImpressions(admin, windowStart, keys),
      fetchDailyUsage(admin, periodStart, keys),
      fetchMonthAiCost(admin, monthStart),
      fetchUsers(admin, periodStart),
    ]);

  const { clicks, capped: clicksCapped } = clicksRes;

  // --- 期間内 / 月内のクリックを JS で切り分け ---
  const periodClicks = clicks.filter((c) => c.day >= periodStart);
  const monthClicks = clicks.filter((c) => c.day >= monthStart);

  // 日次クリック（期間）
  const clickByDay = new Map<string, number>();
  for (const c of periodClicks) clickByDay.set(c.day, (clickByDay.get(c.day) ?? 0) + 1);

  // プログラム別（期間）
  const clickByProgram = new Map<string, number>();
  for (const c of periodClicks)
    clickByProgram.set(c.program, (clickByProgram.get(c.program) ?? 0) + 1);

  // 種別 / 面 / バケット（期間）
  const byTypeM = new Map<string, number>();
  const bySurfaceM = new Map<string, number>();
  const byBucketM = new Map<string, number>();
  for (const c of periodClicks) {
    const { type, bucket } = parseSubid(c.subid);
    byTypeM.set(type, (byTypeM.get(type) ?? 0) + 1);
    bySurfaceM.set(c.surface || "unknown", (bySurfaceM.get(c.surface || "unknown") ?? 0) + 1);
    byBucketM.set(bucket, (byBucketM.get(bucket) ?? 0) + 1);
  }

  // プログラム集合 = 正本の一覧 ∪ 実クリックのあった program。
  // 後者を含めるのは、正本から消した後もその期間の実績を落とさないため。
  const rateByProg = new Map(rates.map((r) => [r.program, r]));
  const allProgs = new Set<string>([...rateByProg.keys(), ...clickByProgram.keys()]);

  const byProgram: ProgramStat[] = [...allProgs].map((program) => {
    const r = rateByProg.get(program);
    const clicksN = clickByProgram.get(program) ?? 0;
    const imps = impressions.byProgram.get(program) ?? 0;
    const epcYen = r?.epcYen ?? 0;
    return {
      program,
      label: r?.label ?? program,
      epcYen,
      commissionNote: r?.commissionNote ?? null,
      active: r?.active ?? true,
      // 正本に無い program（過去のクリックのみ）は未承認扱いにする。
      approved: r?.approved ?? false,
      clicks: clicksN,
      impressions: imps,
      ctr: imps > 0 ? clicksN / imps : null,
      revenueYen: clicksN * epcYen,
    };
  });
  byProgram.sort((a, b) => b.clicks - a.clicks || b.revenueYen - a.revenueYen);

  const totalClicks = periodClicks.length;
  const totalImpressions = impressions.total;
  const estRevenueYen = byProgram.reduce((s, p) => s + p.revenueYen, 0);

  // 月次経済（純収益）: 月内クリック × EPC vs 月次AI原価
  let monthRevenueYen = 0;
  const monthClickByProg = new Map<string, number>();
  for (const c of monthClicks)
    monthClickByProg.set(c.program, (monthClickByProg.get(c.program) ?? 0) + 1);
  for (const [prog, n] of monthClickByProg) {
    monthRevenueYen += n * (rateByProg.get(prog)?.epcYen ?? 0);
  }

  return {
    period: { days, startDay: periodStart, endDay },
    affiliate: {
      hasData: totalClicks > 0 || totalImpressions > 0,
      totalClicks,
      totalImpressions,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : null,
      estRevenueYen,
      dailyClicks: fillDaily(keys, clickByDay),
      byProgram,
      byType: [...byTypeM.entries()]
        .map(([type, clicks]) => ({ type, clicks }))
        .sort((a, b) => b.clicks - a.clicks),
      bySurface: [...bySurfaceM.entries()]
        .map(([surface, clicks]) => ({ surface, clicks }))
        .sort((a, b) => b.clicks - a.clicks),
      byBucket: [...byBucketM.entries()]
        .map(([bucket, clicks]) => ({ bucket, clicks }))
        .sort((a, b) => b.clicks - a.clicks),
      clicksCapped,
    },
    usage: {
      dailySignups: users.dailySignups,
      dailyOcr: usage.ocr,
      dailyConcierge: usage.concierge,
      signupsCapped: users.capped,
    },
    economics: {
      monthLabel: monthStart.slice(0, 7),
      monthRevenueYen,
      monthAiCostYen: economicsMonth,
      monthNetYen: monthRevenueYen - economicsMonth,
    },
    activeUsers: users.activeInPeriod,
  };
}

// ---------- sub-fetchers ----------

type RateRow = {
  program: string;
  label: string | null;
  epcYen: number;
  commissionNote: string | null;
  active: boolean;
  /** 提携承認済みか。false = 未承認 → アプリは広告を出さない。 */
  approved: boolean;
};

/**
 * プログラム一覧を組み立てる。
 *
 * **正本は `affiliate_programs`**（program / active / commission_note / approved_at）。
 * `toritavi_affiliate_rates` からは**分析固有の EPC 単価だけ**を取る。
 *
 * 以前は rates 側にも program / label / active / commission_note があり、同じ属性が
 * 2 箇所に存在していた。片方だけ更新されると管理画面の表示と実際の配信状態がずれる
 * ため、表示のもとになる属性は正本へ一本化した。
 * （正本仕様: toritavi_app/docs/monetization-spec.md §4）
 */
async function fetchRates(admin: Client): Promise<RateRow[]> {
  // 1) 正本: プログラムの素性と承認状態
  const { data: progs } = await admin
    .from("affiliate_programs")
    .select("program, category, commission_note, active, approved_at");

  // 2) 分析固有: EPC 単価のみ
  const { data: rates } = await admin
    .from("toritavi_affiliate_rates")
    .select("program, epc_yen");

  const epcByProg = new Map<string, number>(
    (rates ?? []).map((r) => [r.program as string, Number(r.epc_yen ?? 0)])
  );

  // 正本が引けないとき（テーブル未作成・障害）は EPC だけで組み立てる。
  // 承認状態が分からないので approved=false に倒す（フェイルクローズ）。
  if (!progs) {
    return [...epcByProg].map(([program, epcYen]) => ({
      program,
      label: null,
      epcYen,
      commissionNote: null,
      active: true,
      approved: false,
    }));
  }

  return progs.map((p) => {
    const program = p.program as string;
    return {
      program,
      // 正本に表示名の列は無いため category を補助ラベルに使う。
      label: (p.category as string | null) ?? null,
      epcYen: epcByProg.get(program) ?? 0,
      commissionNote: (p.commission_note as string | null) ?? null,
      active: p.active !== false,
      // approved_at が入っている行だけが実際の配信対象（§4 のフェイルクローズ条件）。
      approved: p.approved_at != null,
    };
  });
}

type ClickRow = { day: string; program: string; subid: string | null; surface: string };

async function fetchClicks(
  admin: Client,
  sinceDay: string
): Promise<{ clicks: ClickRow[]; capped: boolean }> {
  const since = `${sinceDay}T00:00:00Z`;
  const clicks: ClickRow[] = [];
  let capped = false;
  try {
    for (let page = 0; page < CLICKS_MAX_PAGES; page++) {
      const { data, error } = await admin
        .from("affiliate_clicks")
        .select("program, subid, surface, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error || !data) break;
      for (const r of data) {
        clicks.push({
          day: String(r.created_at).slice(0, 10),
          program: (r.program as string) || "unknown",
          subid: (r.subid as string | null) ?? null,
          surface: (r.surface as string) || "unknown",
        });
      }
      if (data.length < PAGE) break;
      if (page === CLICKS_MAX_PAGES - 1) capped = true;
    }
  } catch (e) {
    console.warn("[analytics] fetchClicks failed", e);
  }
  return { clicks, capped };
}

async function fetchImpressions(
  admin: Client,
  sinceDay: string,
  periodKeys: string[]
): Promise<{ total: number; byProgram: Map<string, number>; daily: DailyPoint[] }> {
  const byProgram = new Map<string, number>();
  const byDay = new Map<string, number>();
  const periodSet = new Set(periodKeys);
  let total = 0;
  try {
    const { data } = await admin
      .from("toritavi_ad_impressions")
      .select("day, program, count")
      .gte("day", sinceDay);
    for (const r of data ?? []) {
      const day = String(r.day).slice(0, 10);
      const n = Number(r.count ?? 0);
      // 期間内のみを total / byProgram に算入（union window で余分に引くため）
      if (periodSet.has(day)) {
        total += n;
        byProgram.set(r.program as string, (byProgram.get(r.program as string) ?? 0) + n);
        byDay.set(day, (byDay.get(day) ?? 0) + n);
      }
    }
  } catch (e) {
    console.warn("[analytics] fetchImpressions failed", e);
  }
  return { total, byProgram, daily: fillDaily(periodKeys, byDay) };
}

async function fetchDailyUsage(
  admin: Client,
  sinceDay: string,
  keys: string[]
): Promise<{ ocr: DailyPoint[]; concierge: DailyPoint[] }> {
  const sum = async (table: string): Promise<DailyPoint[]> => {
    const byDay = new Map<string, number>();
    try {
      const { data } = await admin
        .from(table)
        .select("day, requests_count")
        .gte("day", sinceDay);
      for (const r of data ?? []) {
        const day = String(r.day).slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + Number(r.requests_count ?? 0));
      }
    } catch (e) {
      console.warn(`[analytics] usage(${table}) failed`, e);
    }
    return fillDaily(keys, byDay);
  };
  const [ocr, concierge] = await Promise.all([
    sum("toritavi_ocr_usage"),
    sum("toritavi_concierge_usage"),
  ]);
  return { ocr, concierge };
}

async function fetchMonthAiCost(admin: Client, monthStart: string): Promise<number> {
  const read = async (table: string): Promise<number> => {
    try {
      const { data } = await admin
        .from(table)
        .select("spend_cents")
        .eq("month", monthStart)
        .maybeSingle();
      return Number(data?.spend_cents ?? 0);
    } catch {
      return 0;
    }
  };
  const [ocr, concierge] = await Promise.all([
    read("toritavi_ocr_budget"),
    read("toritavi_concierge_budget"),
  ]);
  // spend_cents → ¥（既存 UI 慣習: /100）
  return (ocr + concierge) / 100;
}

async function fetchUsers(
  admin: Client,
  periodStart: string
): Promise<{ dailySignups: DailyPoint[]; activeInPeriod: number; capped: boolean }> {
  const keys = periodStartToKeys(periodStart);
  const byDay = new Map<string, number>();
  let activeInPeriod = 0;
  let capped = false;
  const startMs = new Date(`${periodStart}T00:00:00Z`).getTime();
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const users = data?.users ?? [];
    // @ts-expect-error supabase exposes total on the payload
    const total = (data && (data.total ?? users.length)) as number;
    capped = total > 1000;
    for (const u of users) {
      if (u.created_at) {
        const t = new Date(u.created_at).getTime();
        if (t >= startMs) {
          const day = new Date(u.created_at).toISOString().slice(0, 10);
          byDay.set(day, (byDay.get(day) ?? 0) + 1);
        }
      }
      if (u.last_sign_in_at && new Date(u.last_sign_in_at).getTime() >= startMs) {
        activeInPeriod += 1;
      }
    }
  } catch (e) {
    console.warn("[analytics] fetchUsers failed", e);
  }
  return { dailySignups: fillDaily(keys, byDay), activeInPeriod, capped };
}

/** periodStart(YYYY-MM-DD) から今日までの日付キー。 */
function periodStartToKeys(periodStart: string): string[] {
  const out: string[] = [];
  const start = new Date(`${periodStart}T00:00:00Z`);
  const today = new Date();
  for (let d = new Date(start); dayStr(d) <= dayStr(today); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(dayStr(d));
  }
  return out;
}

// ---------- rate mutation ----------

export async function updateAffiliateRate(
  program: string,
  epcYen: number,
  actorUserId: string
): Promise<void> {
  const admin = createServiceClient();
  const { error } = await admin.from("toritavi_affiliate_rates").upsert(
    {
      program,
      epc_yen: epcYen,
      updated_by: actorUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program" }
  );
  if (error) throw error;
}
