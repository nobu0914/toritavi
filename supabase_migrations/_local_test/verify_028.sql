-- ============================================================================
-- 028（ゲストの身元）の検証。**ローカルのスタブ DB に対して流す。**
--
-- 🔴 見るのは 1 点に尽きる ——
--    **利用者が `attested = true` を自分で立てられないこと。**
--    立てられたら App Attest の検証そのものが無意味になる。
-- ============================================================================
\echo '──── 準備 ────'
insert into auth.users (id, is_anonymous) values
  ('aaaaaaaa-0000-0000-0000-000000000001', true),
  ('bbbbbbbb-0000-0000-0000-000000000002', true)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

-- サーバ（service_role 相当 = ここでは postgres）が入れる。
insert into toritavi_guest_grants (user_id, attested, environment)
values ('aaaaaaaa-0000-0000-0000-000000000001', true, 'production')
on conflict (user_id) do update set attested = true;
insert into toritavi_guest_grants (user_id, attested)
values ('bbbbbbbb-0000-0000-0000-000000000002', false)
on conflict (user_id) do update set attested = false;

grant usage on schema public to authenticated;
grant select, insert, update, delete on toritavi_guest_grants to authenticated;

\echo '──── ① 利用者は自分の行だけ読める（期待: 1 行）────'
create or replace function auth.uid() returns uuid language sql as
  $$ select 'bbbbbbbb-0000-0000-0000-000000000002'::uuid $$;
set role authenticated;
select count(*) as 読める行数 from toritavi_guest_grants;

\echo '──── ② 🔴 自分の attested を立てられない（期待: 0 行更新）────'
do $$
declare n int;
begin
  update toritavi_guest_grants set attested = true
   where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n > 0 then
    raise warning '🔴 % 行を更新できた —— 利用者が自分で検証済みにできる', n;
  else
    raise notice '✅ 更新できない（0 行）';
  end if;
exception when insufficient_privilege then
  raise notice '✅ 権限で拒否された: %', sqlerrm;
end $$;

\echo '──── ③ 🔴 行を新しく作れない ────'
do $$
begin
  insert into toritavi_guest_grants (user_id, attested)
  values ('bbbbbbbb-0000-0000-0000-000000000002', true);
  raise warning '🔴 挿入できた —— 自分で検証済みの行を作れる';
exception when others then
  raise notice '✅ 挿入できない: %', sqlerrm;
end $$;

\echo '──── ④ 🔴 他人の行を読めない（期待: 0 行）────'
select count(*) as 他人の行
  from toritavi_guest_grants
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

reset role;
create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;

\echo '──── ⑤ 退会で消える ────'
delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as 残った行
  from toritavi_guest_grants
 where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
