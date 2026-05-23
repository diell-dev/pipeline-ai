-- ============================================================
-- Pipeline AI — equipment.updated_at trigger
-- Migration 011
--
-- The equipment table (added in 008) was missing the standard
-- update_updated_at trigger that every other domain table uses. As a
-- result, /api/equipment/[id] PATCH was setting updated_at manually in
-- application code on every save — fragile and easy to forget for any
-- future code path that updates equipment.
--
-- This wires equipment into the same trigger every other table uses
-- (defined in migration 001). The route's manual updated_at write is
-- removed in the same commit so we don't double-set the value.
-- ============================================================

DROP TRIGGER IF EXISTS trg_equipment_updated ON equipment;

CREATE TRIGGER trg_equipment_updated
  BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
