-- ============================================================================
-- 025: OCR の上限期間を「暦月」から「契約日起点」へ（2026-08-30）
--
-- 🔴 **本番への適用は人が実行する**（CLAUDE.md §4）。Supabase SQL Editor へ。
-- 🔴 **SQL（書き）→ コード（読み）の順で適用する。** 逆にすると上限が
--    効かない期間ができる（CLAUDE.md §6「OCR クォータキーの変更順序」）。
--
-- ## なぜ変えるか
--
-- 「¥780 / **月**」と「50 件 / **月**」で**月の意味が違っていた。**
-- 課金は Apple が購入日の毎月同日に請求し、上限は暦月でリセットしていた。
-- 月末に契約した人は最初の請求期間に最大 100 件使えた（利用者に有利な
-- ずれなので実害は無かったが、約束と実装が一致していない）。
--
-- ## 🔴 この変更でいちばん危ないこと
--
-- **書く側（この関数）と読む側（`ai-guard.ts`）が別々にキーを計算していた。**
-- 過去に実際の事故がある —— `019` の関数に `013` の JST 修正が入っておらず、
-- **上限が毎日 9 時間まったく効いていなかった**（2 か月気づかず）。
--
-- そこで**キーの計算を `ocr_period_start()` 1 か所に寄せる。**
-- 読む側もこの関数を RPC で呼ぶ。**二重実装をやめることが本題**で、
-- 契約日起点はその上に乗せる。
--
-- ## 🔴 `v_month` は 2 つの意味で使われていた
--
--   - `toritavi_ocr_usage_monthly` … 利用者ごとの上限   → **契約日起点へ**
--   - `toritavi_ocr_budget`        … サービス全体の月予算 → **暦月のまま**
--
-- 単純置換すると全体予算の集計が人によってずれる。変数を分けてある。
--
-- ## 適用対象
--
-- 契約日起点になるのは **`plan='pro'` かつ `period_anchor` が入っている人**だけ。
-- 無料利用者は起点日を持たないので**暦月のまま**。手動付与など anchor が
-- null の Pro も暦月にフォールバックする（フェイルクローズではなく、
-- **既存の挙動を変えない**側に倒す）。
-- ============================================================================

-- ① 契約期間の起点日（JST の日付）。webhook が購入時に記録する。
alter table public.toritavi_user_plan
  add column if not exists period_anchor date;

comment on column public.toritavi_user_plan.period_anchor is
  'サブスクの契約期間の起点日（JST）。RevenueCat の purchased_at から webhook が記録する。'
  'null なら暦月で集計する（無料利用者・手動付与）。';

-- ② 上限期間の開始日。**書く側も読む側もこれだけを使う。**
create or replace function public.ocr_period_start(p_user_id uuid)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $$
DECLARE
  v_today  DATE := (now() AT TIME ZONE 'Asia/Tokyo')::DATE;
  v_anchor DATE;
  v_k      INT;
  v_start  DATE;
BEGIN
  -- plan='pro' かつ anchor がある人だけ契約日起点。それ以外は暦月。
  SELECT period_anchor INTO v_anchor
  FROM toritavi_user_plan
  WHERE user_id = p_user_id AND plan = 'pro';

  IF v_anchor IS NULL OR v_anchor > v_today THEN
    RETURN date_trunc('month', v_today)::DATE;
  END IF;

  -- 経過した「月」の数だけ anchor を進める。
  -- `date + interval 'N month'` は月末を丸めてくれる
  -- （2026-01-31 + 1 month = 2026-02-28）。
  v_k := (EXTRACT(YEAR FROM v_today)::INT - EXTRACT(YEAR FROM v_anchor)::INT) * 12
       + (EXTRACT(MONTH FROM v_today)::INT - EXTRACT(MONTH FROM v_anchor)::INT);
  v_start := (v_anchor + (v_k || ' month')::INTERVAL)::DATE;

  -- 進めすぎたら 1 つ戻す（例: anchor が 25 日で今日が 10 日）。
  IF v_start > v_today THEN
    v_start := (v_anchor + ((v_k - 1) || ' month')::INTERVAL)::DATE;
  END IF;

  RETURN v_start;
END; $$;

-- 🔴 **`authenticated` も落とす。** 2026-08-30 に一度これを書き忘れ、
--    `revoke ... from public, anon` だけにしたところ、Supabase が既定で
--    付ける `authenticated=X` が残った。隣の `increment_ocr_usage_srv` は
--    `{postgres, service_role}` だけで、**同じ表を触る関数どうしで権限が
--    食い違う**状態になった。実害は小さい（他人の期間開始日という日付が
--    引ける程度）が、**次に見た人が「これが正しい形」と読む**。
revoke all on function public.ocr_period_start(uuid) from public, anon, authenticated;
grant execute on function public.ocr_period_start(uuid) to service_role;

-- ③ 書く側。**本番の実定義（pg_get_functiondef）を写し、期間の 1 行だけ変えた。**
--    🔴 既存の検査（user_id / トークン / cost / units の範囲）と日次・予算・
--    イベントの更新は**そのまま残す**。CLAUDE.md §6 の「関数を複製したら
--    既知の修正が全部入っているかを確認する」。
CREATE OR REPLACE FUNCTION public.increment_ocr_usage_srv(
  p_user_id uuid, p_tokens_in integer, p_tokens_out integer,
  p_cost_cents integer, p_units integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now_jst TIMESTAMP := (now() AT TIME ZONE 'Asia/Tokyo');
  v_day     DATE := v_now_jst::DATE;
  -- 🔴 全体予算は**暦月**。利用者ごとの上限とは別物なので分けてある。
  v_month   DATE := date_trunc('month', v_now_jst)::DATE;
  -- 🔴 利用者ごとの上限は**契約日起点**（anchor が無ければ暦月に落ちる）。
  v_period  DATE := ocr_period_start(p_user_id);
  v_tokens  INTEGER := p_tokens_in + p_tokens_out;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
  END IF;
  IF p_cost_cents > 1000 THEN RAISE EXCEPTION 'cost_cents out of range'; END IF;
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 THEN
    RAISE EXCEPTION 'units out of range';
  END IF;

  INSERT INTO toritavi_ocr_usage_monthly (user_id, month, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, v_period, p_units, v_tokens, now())
  ON CONFLICT (user_id, month) DO UPDATE SET
    requests_count  = toritavi_ocr_usage_monthly.requests_count + p_units,
    tokens_total    = toritavi_ocr_usage_monthly.tokens_total + v_tokens,
    last_request_at = now();

  INSERT INTO toritavi_ocr_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, v_day, p_units, v_tokens, now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    requests_count  = toritavi_ocr_usage.requests_count + p_units,
    tokens_total    = toritavi_ocr_usage.tokens_total + v_tokens,
    last_request_at = now();

  INSERT INTO toritavi_ocr_budget (month, spend_cents, request_count)
    VALUES (v_month, p_cost_cents, p_units)
  ON CONFLICT (month) DO UPDATE SET
    spend_cents   = toritavi_ocr_budget.spend_cents + p_cost_cents,
    request_count = toritavi_ocr_budget.request_count + p_units,
    updated_at    = now();

  INSERT INTO toritavi_ocr_events (user_id) VALUES (p_user_id);
  DELETE FROM toritavi_ocr_events
   WHERE user_id = p_user_id AND created_at < now() - INTERVAL '30 days';
END; $function$;

-- ④ 確認。**この 4 つを目で見てから終わる。**
--    a) 列が増えたこと
select column_name, data_type from information_schema.columns
where table_name = 'toritavi_user_plan' order by ordinal_position;

--    b) anchor が無い人は暦月になること（＝今月 1 日）
select ocr_period_start(id) as 無料の期間開始, date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date as 今月1日
from auth.users where email = '010jg7e6@coyoteandpowell.com';

--    c) 予算の集計が暦月のままであること（関数定義に v_month が残っている）
select position('v_month   DATE := date_trunc' in pg_get_functiondef(p.oid)) > 0 as 予算は暦月のまま
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'increment_ocr_usage_srv';

--    d) 実行権限が service_role だけであること
select proname, proacl::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ocr_period_start';
