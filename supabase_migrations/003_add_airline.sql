-- 2026-04-19: Add airline column to toritavi_steps.
-- Used to store the operating airline (コードシェア便の実運航キャリア) for
-- 飛行機 category steps. Enables auto-link to airline official website from
-- the 基本情報 row. See app/src/lib/step-links.ts + DS v2 §14.
alter table toritavi_steps add column if not exists airline text;
