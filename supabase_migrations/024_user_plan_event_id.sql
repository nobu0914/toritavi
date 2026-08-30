-- ============================================================================
-- 024: `toritavi_user_plan` に `last_event_id` を足す（2026-08-30）
--
-- 🔴 **本番への適用は人が実行する**（CLAUDE.md §4）。Supabase SQL Editor へ。
--
-- ## なぜ要るか
--
-- RevenueCat の webhook は **at-least-once delivery**（best effort）で、
-- 公式は「同じイベントが複数回届くことがある」と明記し、
-- **イベント `id` を記録して冪等化せよ**と勧めている:
--
--   > RevenueCat makes our best effort for "at least one delivery" of webhooks
--   > ... maintain idempotent processing by tracking the event id
--
-- いまは `updated_at`（イベント発生時刻）の前後比較だけで順序を決めており、
-- 2026-08-30 の時点で 2 つ穴がある:
--
--   1. **同一ミリ秒の別イベント**は先着が勝つ。`event_timestamp_ms` が
--      別イベント間で一意になる保証は公式に無い（一意なのは `id`）。
--      いまは「失効優先」の暫定で凌いでいる
--   2. **同じイベントの再配送**は、同時刻なので失効側だけ再適用される。
--      結果は同じなので実害は小さいが、冪等ではない
--
-- ## なぜ「いま」か
--
-- **契約者がまだ 1 人もいないので、この変更は無害。** `kSubscriptionEnabled`
-- を開けた後に足すと、**イベントが流れている最中のスキーマ変更**になる。
--
-- ## 適用順序 🔴
--
-- **SQL（この列の追加）→ コード（読み書き）の順。** 逆にすると、
-- 存在しない列に書こうとして webhook が 500 を返し続ける
-- （CLAUDE.md §6「OCR クォータキーの変更順序」と同じ型）。
-- 列は nullable なので、**追加した時点では旧コードもそのまま動く**。
-- ============================================================================

alter table public.toritavi_user_plan
  add column if not exists last_event_id text;

comment on column public.toritavi_user_plan.last_event_id is
  '最後に適用した RevenueCat webhook イベントの id。'
  '同じ id のイベントは二度適用しない（at-least-once 配送への冪等化）。'
  '手動で行を入れた場合は null。';

-- 確認。列が増えていること、既存 2 行が null で無傷であること。
select user_id, plan, updated_at, last_event_id
from public.toritavi_user_plan
order by updated_at;
