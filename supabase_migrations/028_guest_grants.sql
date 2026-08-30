-- ============================================================================
-- 028: ゲスト（匿名利用者）の身元を保持する
--
-- 🔴 **人が Supabase SQL Editor で実行する**（CLAUDE.md §4）。
--
-- ## なぜ要るか
--
-- App Attest の検証は起動時に 1 回だけ行う（毎回やると遅く、Apple も想定して
-- いない）。**結果をどこかに置かないと、次の要求で「検証済みか」が分からない。**
-- 置かないと毎回 `failed` 扱い＝ゲストは永久に 1 件になる。
--
-- ## 何を持ち、何を持たないか
--
-- | 持つ | 持たない |
-- |---|---|
-- | 検証が通ったか（`attested`） | **端末のフィンガープリント** |
-- | App Attest の keyId の**ハッシュ** | keyId そのもの |
-- | 以後の assertion 検証に使う公開鍵 | 秘密鍵（そもそもサーバに来ない） |
--
-- 🔴 **端末を識別する値を作らない。** `docs/ocr-abuse-design-2026-08-22.md` §6 が
--    「端末フィンガープリントは作らない —— 保持するのは keyId のハッシュのみ」
--    と定めている。件数を数えるのは DeviceCheck（Apple 側）の役目で、
--    こちらが端末を追跡する必要は無い。
--
-- ## 消えるとき
--
-- `auth.users` への CASCADE。**退会・匿名の掃除で一緒に消える。**
-- ここだけ残ると「消えたはずの端末の記録」が残る。
--
-- ## 適用前に確かめる
--
--   select to_regclass('public.toritavi_guest_grants');   -- null なら未作成
--   select count(*) from auth.users where is_anonymous;   -- いまは 0
-- ============================================================================

create table if not exists public.toritavi_guest_grants (
  user_id      uuid primary key
                 references auth.users(id) on delete cascade,
  -- App Attest が通ったか。**既定は false**（フェイルクローズ）。
  attested     boolean     not null default false,
  -- keyId の SHA-256（16 進）。**keyId そのものは持たない。**
  -- 同じ端末から作り直された鍵を見分けるためだけに使う。
  key_hash     text,
  -- 以後の assertion 検証に使う公開鍵（PEM）。秘密鍵は来ない。
  public_key   text,
  -- 検証した環境。development が本番に混ざっていないかを後から見るため。
  environment  text        check (environment in ('development','production')),
  attested_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.toritavi_guest_grants is
  'ゲスト（匿名利用者）の App Attest 検証結果。端末フィンガープリントは持たない。'
  '件数は DeviceCheck（Apple 側の 2 bit）と toritavi_ocr_usage_monthly が数える。';

-- ============================================================================
-- RLS —— **本人が読めるだけ。書けない。**
--
-- 🔴 書き込みはサーバ（service_role）だけ。利用者が書けると
--    `attested = true` を自分で立てられ、**検証そのものが無意味になる。**
-- ============================================================================
alter table public.toritavi_guest_grants enable row level security;

drop policy if exists "own guest grant read" on public.toritavi_guest_grants;
create policy "own guest grant read" on public.toritavi_guest_grants
  for select using (auth.uid() = user_id);

-- **insert / update / delete のポリシーを作らない** = 利用者は書けない。
-- service_role は RLS を素通りする。

-- 更新時刻。
create or replace function public.toritavi_guest_grants_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guest_grants_touch on public.toritavi_guest_grants;
create trigger trg_guest_grants_touch
  before update on public.toritavi_guest_grants
  for each row execute function public.toritavi_guest_grants_touch();

-- ============================================================================
-- 確認
-- ============================================================================

-- ① 表と RLS
select
  to_regclass('public.toritavi_guest_grants') is not null as 表あり,
  (select relrowsecurity from pg_class where relname = 'toritavi_guest_grants') as RLS有効;

-- ② ポリシーは select だけ（書き込みのポリシーが無いこと）
select cmd, policyname from pg_policies
where tablename = 'toritavi_guest_grants' order by cmd;

-- ③ 退会で消える経路があること（CASCADE）
select confdeltype = 'c' as 退会で消える
from pg_constraint
where conrelid = 'public.toritavi_guest_grants'::regclass and contype = 'f';
