-- ============================================================
-- 014_merge_category_appointment.sql
-- カテゴリ再整理: 病院 + 商談 → アポ（予約・アポ）へ統合
--
-- 背景: スキャン種類カテゴリの再整理に伴い、利用頻度の低い「病院」と
--       「その他」とほぼ同型だった「商談」を、汎用の「アポ（予約・アポ）」へ統合する。
--       医療/商談固有項目（診療科・先方担当 等）は可変項目側へ寄せる。
--
-- 対象列: toritavi_steps.category（text not null・CHECK/enum 制約なし）
-- 適用方法: Supabase SQL Editor で手動実行。
-- 注意: 旧クライアント（モバイル未更新）は移行後も 病院/商談 を書き込みうる。
--       サーバ/新クライアントは既定フォールバックで破綻せず表示できる。
-- ============================================================

-- 実行前の件数確認（任意・記録用）:
--   select category, count(*) from toritavi_steps group by category order by 2 desc;

begin;

update toritavi_steps
set category = 'アポ'
where category in ('病院', '商談');

commit;

-- 実行後の確認:
--   select category, count(*) from toritavi_steps
--   where category in ('病院', '商談', 'アポ') group by category;
--   -- 病院 / 商談 が 0 件、アポ に統合されていれば成功。
