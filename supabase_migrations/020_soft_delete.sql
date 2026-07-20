-- ============================================================
-- Toritavi: 旅程・予定の論理削除（データ復旧性の確保）
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
--
-- 背景:
--   これまで旅程・予定の削除は物理削除で、コードのバグ1つでユーザーデータが
--   永久に失われた（実例: 「別の旅程に移動」が add+delete 実装だったため、
--   同一IDの upsert→即削除となり、行と一緒にスキャン画像まで消えていた）。
--   物理削除のままでは、次のバグでも同じ事故が起きる。
--
-- 方針（expand-contract の「拡張」フェーズ）:
--   deleted_at を追加するだけ。既存の物理削除コードも動き続けるため、
--   このマイグレーション単体では何も壊れない。アプリを論理削除対応版に
--   更新したあと、猶予期間を過ぎた行を消すバッチ（§3）を有効化する。
--
-- 適用順:
--   1. 本ファイルを実行（カラム追加・索引・ビュー）
--   2. 論理削除対応のアプリをリリース
--   3. 十分に浸透してから §3 のパージ関数を定期実行に載せる
-- ============================================================

-- ------------------------------------------------------------
-- 1) deleted_at の追加（NULL = 生きている行）
-- ------------------------------------------------------------
ALTER TABLE toritavi_journeys ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE toritavi_steps    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 生存行だけを引く問い合わせを速くする部分索引。
CREATE INDEX IF NOT EXISTS idx_journeys_alive
  ON toritavi_journeys (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_steps_alive
  ON toritavi_steps (journey_id) WHERE deleted_at IS NULL;
-- パージ用（削除済みを古い順に引く）。
CREATE INDEX IF NOT EXISTS idx_journeys_deleted ON toritavi_journeys (deleted_at)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_steps_deleted ON toritavi_steps (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------
-- 2) 旅程を論理削除すると配下の予定も一緒に落とす
--    （物理削除の ON DELETE CASCADE に相当する挙動を維持する）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cascade_soft_delete_steps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE toritavi_steps
       SET deleted_at = NEW.deleted_at
     WHERE journey_id = NEW.id AND deleted_at IS NULL;
  -- 復元（undo）時は配下も戻す。
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE toritavi_steps
       SET deleted_at = NULL
     WHERE journey_id = NEW.id AND deleted_at = OLD.deleted_at;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_cascade_soft_delete ON toritavi_journeys;
CREATE TRIGGER trg_cascade_soft_delete
  AFTER UPDATE OF deleted_at ON toritavi_journeys
  FOR EACH ROW EXECUTE FUNCTION cascade_soft_delete_steps();

-- ------------------------------------------------------------
-- 3) 猶予期間を過ぎた行の物理削除（アプリ浸透後に定期実行へ載せる）
--
--    ⚠️ この関数は不可逆。実行前に必ずバックアップの存在を確認すること。
--    Storage の写真は行削除では消えないため、パージ後に孤児掃除が必要
--    （supabase/inventory.sql の孤児検知クエリで残数を確認できる）。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_soft_deleted(p_retain_days INTEGER DEFAULT 30)
RETURNS TABLE(purged_journeys BIGINT, purged_steps BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - make_interval(days => p_retain_days);
  v_j BIGINT; v_s BIGINT;
BEGIN
  IF p_retain_days < 7 THEN
    RAISE EXCEPTION 'retain_days must be >= 7 (guard against accidental purge)';
  END IF;

  WITH d AS (
    DELETE FROM toritavi_steps
     WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff RETURNING 1
  ) SELECT count(*) INTO v_s FROM d;

  WITH d AS (
    DELETE FROM toritavi_journeys
     WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff RETURNING 1
  ) SELECT count(*) INTO v_j FROM d;

  RETURN QUERY SELECT v_j, v_s;
END; $$;

REVOKE ALL ON FUNCTION purge_soft_deleted(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_soft_deleted(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION purge_soft_deleted(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION purge_soft_deleted(INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 4) 確認クエリ
-- ------------------------------------------------------------
-- 削除済み（復元可能）の件数:
--   SELECT count(*) FROM toritavi_journeys WHERE deleted_at IS NOT NULL;
--   SELECT count(*) FROM toritavi_steps    WHERE deleted_at IS NOT NULL;
-- 手動での復元（ユーザーからの申し出に対応する場合）:
--   UPDATE toritavi_journeys SET deleted_at = NULL WHERE id = '<journey_id>';
