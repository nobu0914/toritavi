-- ============================================================
-- 031: 次に枠が戻る日を返す（`ocr_period_start` の対）
--
-- なぜ要るか:
--   `/api/ai-usage` は `resetAt` を **常に翌月 1 日**で返していた
--   （`nextResetIso` は user_id を取らないので契約応当日を知らない）。
--   Pro に契約応当日が入ると、**画面が嘘の日付を出す**。
--   外部レビュー（2026-08-31）P1 の指摘。
--
-- 🔴 **サーバ側で計算しない。** 開始日 +1 か月では月末起点がずれる ——
--    anchor=1/31 なら現在の開始は 2/28（Postgres が丸める）で、
--    そこへ +1 か月すると 3/28。正しくは anchor + 2 か月 = 3/31。
--    **同じ丸めを 2 か所で書くと必ず食い違う**（CLAUDE.md §6 の複製の型）。
--
-- 🔴 **026 の関門をそのまま引き継ぐ。** 利用者として呼ばれたら
--    自分の分しか引けない。service_role（auth.uid() が null）は通る。
--
-- 匿名（ゲスト）は生涯 1 期間なので **NULL**（＝リセットしない）を返す。
-- 呼び出し側はこれを「日付なし」として出す。
-- ============================================================

create or replace function public.ocr_period_next(p_user_id uuid)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  v_today   DATE := (now() AT TIME ZONE 'Asia/Tokyo')::DATE;
  v_anon    BOOLEAN;
  v_anchor  DATE;
  v_k       INT;
  v_start   DATE;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- ゲストはリセットしない。**「翌月 1 日」と言わせない。**
  SELECT is_anonymous INTO v_anon FROM auth.users WHERE id = p_user_id;
  IF COALESCE(v_anon, FALSE) THEN
    RETURN NULL;
  END IF;

  SELECT period_anchor INTO v_anchor
  FROM toritavi_user_plan
  WHERE user_id = p_user_id AND plan = 'pro';

  -- Pro でない／応当日が無い／未来日 → 暦月。次は翌月 1 日。
  IF v_anchor IS NULL OR v_anchor > v_today THEN
    RETURN (date_trunc('month', v_today) + INTERVAL '1 month')::DATE;
  END IF;

  -- `ocr_period_start` と**同じ k** を出し、その次の応当日を返す。
  v_k := (EXTRACT(YEAR FROM v_today)::INT - EXTRACT(YEAR FROM v_anchor)::INT) * 12
       + (EXTRACT(MONTH FROM v_today)::INT - EXTRACT(MONTH FROM v_anchor)::INT);
  v_start := (v_anchor + (v_k || ' month')::INTERVAL)::DATE;

  IF v_start > v_today THEN
    v_k := v_k - 1;
  END IF;

  RETURN (v_anchor + ((v_k + 1) || ' month')::INTERVAL)::DATE;
END; $function$;

grant execute on function public.ocr_period_next(uuid) to authenticated, service_role;

-- 確認（人が目で見る）
--   select public.ocr_period_start(id), public.ocr_period_next(id)
--   from auth.users where email = '...';
