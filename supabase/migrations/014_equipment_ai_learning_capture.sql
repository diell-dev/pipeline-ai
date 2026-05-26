-- ============================================================
-- Pipeline AI — Equipment AI Learning-Loop Data Capture
-- Migration 014
--
-- Adds the data-capture columns on equipment_scans so every confirmed
-- registration produces a (photo, ai_extraction, confirmed_extraction)
-- training row for the AI learning loop described in AI_LEARNING_LOOP.md.
-- Also creates equipment_catalog: an auto-built database of known
-- (brand, model) combos, populated as techs confirm registrations.
--
-- Why these columns specifically:
--   ai_extraction         — the raw structured output from extractDataPlate()
--                           with per-field confidence + verbatim source quotes.
--                           This is the "AI guess".
--   confirmed_extraction  — what the human actually accepted/typed in the
--                           confirmation UI. This is the "ground truth".
--   field_corrections     — per-field diff so the weekly accuracy report can
--                           ask "which fields were wrong, by brand?"
--                           Shape: { make: { was_corrected, ai_value,
--                                            human_value, ai_confidence } }
--   photo_url             — explicit Supabase Storage URL of the plate photo.
--                           Same value also stored on equipment.data_plate_photo_url
--                           but copied here so the audit table is self-contained.
--
-- All four columns are nullable so existing scan rows remain valid.
-- ============================================================

ALTER TABLE equipment_scans
  ADD COLUMN IF NOT EXISTS ai_extraction JSONB,
  ADD COLUMN IF NOT EXISTS confirmed_extraction JSONB,
  ADD COLUMN IF NOT EXISTS field_corrections JSONB,
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ─────────────────────────────────────────────────────────────
-- equipment_catalog: one row per known (brand, model) combo,
-- populated as techs confirm registrations. Powers Level-2 of the
-- learning loop ("equipment catalog that builds itself"): once
-- enough confirmations exist for a model, we auto-suggest the
-- common values instead of asking the AI to re-extract them.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  -- How many separate confirmations have rolled into this entry.
  -- Higher = more trustworthy when we auto-suggest field values.
  confirmed_count INT NOT NULL DEFAULT 1,
  -- Histogram of values seen per non-identifier field.
  -- e.g. { voltage: { "208/230V": 12 }, refrigerant: { "R-410A": 10 } }
  -- We don't enforce a shape here because the field set will grow as
  -- the extractor learns to capture more attributes (NEC, refrigerant,
  -- weight, etc.) — JSONB keeps the catalog forward-compatible.
  common_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Cached manufacturer metadata (mirrors equipment.ai_metadata for
  -- the most recently looked-up record of this model).
  ai_metadata JSONB,
  first_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand, model)
);

CREATE INDEX IF NOT EXISTS idx_equipment_catalog_brand_model
  ON equipment_catalog (brand, model);

-- equipment_catalog is shared across orgs (the catalog is a brand-level
-- asset, not a per-tenant record). No RLS — readable/writable from server
-- code via service role; no client-side direct access expected.
COMMENT ON TABLE equipment_catalog IS
  'Cross-org catalog of known (brand, model) HVAC equipment. Populated automatically as techs confirm scan registrations. Powers Level-2 of the AI learning loop.';

COMMENT ON COLUMN equipment_scans.ai_extraction IS
  'Raw structured output from extractDataPlate() — per-field { value, source_text, confidence } plus manufacture_date.decoded_from. Treat as immutable: this is the AI guess.';
COMMENT ON COLUMN equipment_scans.confirmed_extraction IS
  'Human-confirmed values from the confirmation UI. This is the ground truth used for the learning loop.';
COMMENT ON COLUMN equipment_scans.field_corrections IS
  'Per-field diff between ai_extraction and confirmed_extraction. Shape: { field_name: { was_corrected: bool, ai_value, human_value, ai_confidence } }';
COMMENT ON COLUMN equipment_scans.photo_url IS
  'Explicit Supabase Storage URL of the data-plate photo for this scan. Copied here so the audit row is self-contained even if the equipment row is mutated later.';
