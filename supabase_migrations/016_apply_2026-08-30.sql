-- ============================================================================
-- 016 の再適用（2026-08-30）—— cascade FK が本番に無いことを実測して流す
--
-- 🔴 **本番への適用は人が実行する**（CLAUDE.md §4）。Supabase SQL Editor へ。
--
-- ## なぜいま流すか
--
-- 2026-08-17 の検査で「未適用」と報告されていた（`JR000065`）。
-- **2026-08-30 に読み取り専用で実測し、主張が真であることを確認した:**
--
--   affiliate_clicks | (FK なし)
--   trip_contacts    | (FK なし)
--   trip_task_states | (FK なし)
--
-- 🔴 **マイグレーションのファイルがあることを、適用された根拠にしない**
--    （CLAUDE.md §6）。当時の検査はそれをやって「二重防御」と誤報した。
--
-- ## 何が起きているか
--
-- `/api/account/delete` は 3 表を `NON_CASCADING_USER_TABLES` として
-- **明示削除する**ので、アプリの退会経路では消える。
--
-- 🔴 **消えないのは、それ以外の経路。** Supabase ダッシュボードの
--    Delete user では 3 表とも残る。**`trip_contacts` は電話番号を持つ。**
--    Apple 5.1.1(v) は「アカウントと関連データの削除」を求めている。
--
-- ## 適用前の実測（2026-08-30・すべて確認済み）
--
--   孤立行: trip_contacts 0 / trip_task_states 0 / affiliate_clicks 0
--     → 1 件でもあると ALTER が失敗する。ゼロなので通る
--   user_id: 3 表とも NOT NULL
--   制約名の衝突: 無し（下の 3 つの名前は他所で使われていない）
--
-- ⚠️ **016 の `if not exists` は制約名だけを見る。** 別名で FK が張られて
--    いると素通りするので、上の実測（FK なし）と対で確認すること。
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trip_contacts_user_id_fkey'
  ) then
    alter table public.trip_contacts
      add constraint trip_contacts_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'trip_task_states_user_id_fkey'
  ) then
    alter table public.trip_task_states
      add constraint trip_task_states_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'affiliate_clicks_user_id_fkey'
  ) then
    alter table public.affiliate_clicks
      add constraint affiliate_clicks_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ── 確認 ──────────────────────────────────────────────────────────────
-- 🔴 **3 行とも on_delete が CASCADE になること。**
--    「制約が在る」だけでは足りない。NO ACTION だと消えない。
select c.relname as tbl,
       coalesce(con.conname, '🔴 FK なし') as fk,
       case con.confdeltype
         when 'c' then 'CASCADE'
         when 'a' then '🔴 NO ACTION（消えない）'
         when 'n' then '🔴 SET NULL（消えない）'
         else coalesce(con.confdeltype::text, '-')
       end as on_delete
from pg_class c
left join pg_constraint con
  on con.conrelid = c.oid and con.contype = 'f'
 and con.confrelid = 'auth.users'::regclass
where c.relname in ('affiliate_clicks','trip_contacts','trip_task_states')
order by c.relname;
