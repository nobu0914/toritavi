-- ============================================================================
-- 027: ゲスト（匿名利用者）の OCR 枠を「生涯 3 件」にする土台
--
-- 🔴 **人が Supabase SQL Editor で実行する**（CLAUDE.md §4）。
--
-- ## なぜ要るか
--
-- `docs/guest-mode-spec.md` §2-1 の実測:
-- **ゲストはいま「予算の軸」にしか存在せず、「件数の軸」には存在しない。**
-- 匿名ユーザーは `toritavi_user_plan` に行を持たないので `resolvePlan` が
-- `free` を返し、**そのまま匿名ログインを開けると無料会員と同じ
-- 5 件 / 月（暦月リセット）**になる。「端末ごとに 1 回」も表現できない。
--
-- ## この SQL がやること
--
-- `ocr_period_start` に**匿名の分岐**を足す。匿名なら固定の番兵日付を返す。
-- 期間が動かない ＝ カウントが戻らない ＝ **生涯 3 件**。
-- 集計表（`toritavi_ocr_usage_monthly (user_id, month)`）はそのまま使える。
--
-- 🔴 **件数の上限（3）はここでは決めない。** サーバの `tiers.guest` が持つ。
--    ここが決めるのは「いつ戻るか（戻らない）」だけ。
--
-- ## 🔴 026 の関門を持ち越している
--
-- `create or replace` なので、**026 の呼び出し元ガードを書き写さないと
-- 静かに消える**（CLAUDE.md §6 の `ocr_hardening_phase1.sql` と同じ形）。
-- 下の `IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id` がそれ。
-- **消さないこと。** 消すと、ログイン済みの誰でも他人の期間開始日を引ける。
--
-- ## 適用の順序
--
-- **この SQL が先。サーバの `tiers.guest` は後。** 逆にすると、
-- 匿名ユーザーの 3 件が「暦月ごとに 3 件」になる期間ができる
-- （危険な向きではないが、仕様と違う状態を作らない）。
--
-- ## 適用前に確かめる
--
--   select proname, proacl::text from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and proname='ocr_period_start';
--   -- authenticated と service_role の両方が付いていること（026 の状態）
-- ============================================================================

create or replace function public.ocr_period_start(p_user_id uuid)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $$
DECLARE
  -- 🔴 **ゲストの番兵日付。** 「無効」ではなく「ここに積む」という意味。
  --    未来日や NULL にすると `on conflict (user_id, month)` が壊れる。
  --    動かない値でありさえすればよいので、明らかに実在しない過去日を置く。
  c_guest_epoch CONSTANT DATE := DATE '1970-01-01';
  v_today   DATE := (now() AT TIME ZONE 'Asia/Tokyo')::DATE;
  v_anon    BOOLEAN;
  v_anchor  DATE;
  v_k       INT;
  v_start   DATE;
BEGIN
  -- 🔴 **026 の関門。消さないこと。**
  --    利用者として呼ばれたら自分の分しか引けない。
  --    `auth.uid()` は service_role で呼ぶと null になるので、
  --    サーバ側の呼び出し（増分 RPC）はそのまま通る。
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 🔴 **匿名なら期間を動かさない（生涯 1 期間）。**
  --    正本は `auth.users.is_anonymous`（GoTrue が立てる）。
  --    端末の識別子や自前のフラグを見ない —— 偽装できる物を根拠にしない。
  SELECT is_anonymous INTO v_anon FROM auth.users WHERE id = p_user_id;
  IF COALESCE(v_anon, FALSE) THEN
    RETURN c_guest_epoch;
  END IF;

  -- 以下は 026 のまま（plan='pro' かつ anchor があれば契約日起点、他は暦月）。
  SELECT period_anchor INTO v_anchor
  FROM toritavi_user_plan
  WHERE user_id = p_user_id AND plan = 'pro';

  IF v_anchor IS NULL OR v_anchor > v_today THEN
    RETURN date_trunc('month', v_today)::DATE;
  END IF;

  v_k := (EXTRACT(YEAR FROM v_today)::INT - EXTRACT(YEAR FROM v_anchor)::INT) * 12
       + (EXTRACT(MONTH FROM v_today)::INT - EXTRACT(MONTH FROM v_anchor)::INT);
  v_start := (v_anchor + (v_k || ' month')::INTERVAL)::DATE;

  IF v_start > v_today THEN
    v_start := (v_anchor + ((v_k - 1) || ' month')::INTERVAL)::DATE;
  END IF;

  RETURN v_start;
END; $$;

-- 026 と同じ権限に戻す（authenticated は読み取り側が要る。関門で自分の分のみ）。
revoke all on function public.ocr_period_start(uuid) from public, anon;
grant execute on function public.ocr_period_start(uuid) to authenticated, service_role;

-- ============================================================================
-- 確認
-- ============================================================================

-- ① 権限（authenticated と service_role の両方が付くこと）
select proname, proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'ocr_period_start';

-- ② 関門が生きていること（本文に auth.uid() の比較があること）
select position('auth.uid() <> p_user_id' in pg_get_functiondef(p.oid)) > 0
         as 関門あり,
       position('is_anonymous' in pg_get_functiondef(p.oid)) > 0
         as ゲスト分岐あり
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ocr_period_start';

-- ③ 既存の会員に影響が無いこと（匿名は 0 人なので、いまは全員が従来どおり）
select
  (select count(*) from auth.users where is_anonymous) as 匿名の人数,
  (select count(*) from auth.users) as 全体;
