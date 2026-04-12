-- toritavi テーブル作成
-- Supabase SQL Editor で実行してください

-- Journeys テーブル
create table if not exists toritavi_journeys (
  id text primary key,
  title text not null,
  start_date text not null,
  end_date text not null,
  memo text,
  created_at text not null,
  updated_at text not null,
  device_id text not null,
  synced_at timestamptz default now()
);

-- Steps テーブル
create table if not exists toritavi_steps (
  id text primary key,
  journey_id text not null references toritavi_journeys(id) on delete cascade,
  category text not null,
  title text not null,
  date text,
  end_date text,
  time text not null default '',
  end_time text,
  "from" text,
  "to" text,
  detail text,
  conf_number text,
  memo text,
  source text,
  source_image_url text,
  source_image_urls jsonb,
  timezone text,
  status text not null default '未開始',
  inferred jsonb,
  needs_review boolean default false,
  information jsonb default '[]'::jsonb,
  sort_order integer default 0,
  synced_at timestamptz default now()
);

-- インデックス
create index if not exists idx_steps_journey on toritavi_steps(journey_id);
create index if not exists idx_journeys_device on toritavi_journeys(device_id);

-- RLS (Row Level Security) を無効化（匿名アクセス許可）
-- 認証実装後に有効化する
alter table toritavi_journeys enable row level security;
alter table toritavi_steps enable row level security;

-- 匿名アクセスポリシー
create policy "Allow anonymous access to journeys"
  on toritavi_journeys for all
  using (true) with check (true);

create policy "Allow anonymous access to steps"
  on toritavi_steps for all
  using (true) with check (true);
