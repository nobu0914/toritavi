-- ============================================================
-- 032: `ocr_period_next` の実行権限から anon / PUBLIC を外す
--
-- 🔴 **031 の欠陥。** `grant execute ... to authenticated, service_role` は
--    書いたが、**既定で付く PUBLIC を revoke していなかった。**
--    Supabase は public スキーマの新しい関数に anon / authenticated の
--    EXECUTE を既定で与えるので、**匿名キーだけで呼べる状態**になっていた。
--
--    実測（2026-08-31・外部レビューの指摘を再現）:
--      anon キーで POST /rest/v1/rpc/ocr_period_next → "2026-09-01"
--      anon キーで POST /rest/v1/rpc/ocr_period_start → 42501 permission denied
--
--    **`ocr_period_start`（025/026）は正しく絞られていた。**
--    関数を複製したときに、権限の設定だけが付いてこなかった ——
--    `CLAUDE.md` §6「関数を複製したら、既知の修正が全部入っているかを確認する」。
--
-- 何が漏れていたか: 任意の user_id に対する「次に枠が戻る日」。
--   応当日が入った Pro なら、返る日付が月初でなくなるため
--   **契約プランと課金応当日が読める**。UUID を知っている必要はあるが、
--   認証は一切要らない。
--
-- 🔴 **呼び出し元の関門（026）は anon を止めない。**
--    `IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id` は
--    「auth.uid() が NULL ＝ サーバ」を前提にしているが、
--    **anon も NULL** なので素通りする。関門ではなく権限で止める。
-- ============================================================

revoke all on function public.ocr_period_next(uuid) from public;
revoke all on function public.ocr_period_next(uuid) from anon;
grant execute on function public.ocr_period_next(uuid) to authenticated, service_role;

-- 念のため対の関数も同じ形に揃える（既に絞られているので冪等）。
revoke all on function public.ocr_period_start(uuid) from public;
revoke all on function public.ocr_period_start(uuid) from anon;
grant execute on function public.ocr_period_start(uuid) to authenticated, service_role;

-- ============================================================
-- 適用後の確認（人が目で見る）
-- ============================================================
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as 関数,
       array_to_string(p.proacl, ' | ') as 権限,
       case when p.proacl is null then '🔴 既定（PUBLIC）'
            when array_to_string(p.proacl,',') like '%anon=X%' then '🔴 anon に EXECUTE'
            when array_to_string(p.proacl,',') ~ '(^|,)=X/'   then '🔴 PUBLIC に EXECUTE'
            else '✅ ok' end as 判定
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('ocr_period_start','ocr_period_next')
order by 1;
-- 期待: 2 行とも ✅ ok（anon も PUBLIC も無い）
