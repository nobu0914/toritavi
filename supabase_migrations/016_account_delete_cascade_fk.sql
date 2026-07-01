-- 016_account_delete_cascade_fk.sql
-- アカウント削除時の取りこぼし対策（防御の多重化・任意）。
--
-- 背景: trip_contacts / trip_task_states / affiliate_clicks は user_id を持つが
-- auth.users への外部キーが無く、auth ユーザー削除で自動削除されなかった
-- （他の toritavi_* テーブルは ON DELETE CASCADE 済み）。trip_contacts は
-- 電話番号等の PII を含むため、削除後の残存はプライバシー/App Store 5.1.1(v) の懸念。
--
-- /api/account/delete は当該3テーブルを明示削除するよう修正済み。本マイグレーションは
-- DB レベルでも CASCADE を張り、どの削除経路（管理者削除等）でも確実に消えるようにする。
--
-- 安全性: 適用前チェックで null/孤立 user_id = 0 を確認済み。near-empty テーブルのため即時。
-- 冪等（再実行可）。

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
