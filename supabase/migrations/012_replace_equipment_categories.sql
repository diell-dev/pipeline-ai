-- ============================================================
-- Pipeline AI — Replace equipment categories with simplified set
-- Migration 012
--
-- The original 15 categories were too granular (fuel type baked into the
-- category name, split-systems split into outdoor + indoor heads) and
-- stored Lucide icon names that were rendered as raw text in the UI.
--
-- New design:
--   - 30 categories organised by function (heating, cooling, air handling,
--     ventilation, hot water, air quality, controls)
--   - One category per system; granularity via parent_equipment_id when
--     the user wants to track outdoor + indoor units separately
--   - Fuel type (gas/oil/electric) becomes a free-text field on the
--     equipment record, not part of the category name
--   - Icons are emoji that render natively — no Lucide mapping required
--
-- Migration strategy:
--   1. Insert new categories with `tmp_` prefix to avoid unique-code
--      clashes with old categories that share a name (thermostat,
--      heat_pump, air_handler)
--   2. Remap the existing equipment rows from old → new categories
--   3. Delete the old categories (now unreferenced)
--   4. Strip the `tmp_` prefix on the new categories
-- ============================================================

-- Step 1: insert new categories with tmp_ prefix
INSERT INTO equipment_categories (code, name, icon, default_service_interval_months, typical_lifespan_years) VALUES
  -- Heating
  ('tmp_boiler',          'Boiler',                     '🔥', 12, 25),
  ('tmp_furnace',         'Furnace',                    '🔥', 12, 20),
  ('tmp_heat_pump',       'Heat Pump',                  '🌡️', 12, 15),
  ('tmp_baseboard',       'Baseboard / Radiator',       '➖', 24, 30),
  ('tmp_radiant_floor',   'Radiant Floor',              '🟧', 24, 30),
  ('tmp_space_heater',    'Space / Wall Heater',        '🔌', 12, 15),
  -- Cooling
  ('tmp_central_ac',      'Central AC',                 '❄️', 12, 15),
  ('tmp_mini_split',      'Mini-Split / Ductless',      '🌬️', 12, 15),
  ('tmp_window_ac',       'Window / Through-Wall AC',   '🪟', 12, 10),
  ('tmp_chiller',         'Chiller',                    '🧊', 12, 20),
  -- Air handling & distribution
  ('tmp_air_handler',     'Air Handler (AHU)',          '🌀', 12, 15),
  ('tmp_rtu',             'Rooftop Unit (RTU)',         '🏢', 12, 15),
  ('tmp_ductwork',        'Ductwork',                   '🛠', 60, 30),
  ('tmp_circulator_pump', 'Circulator Pump',            '⚙️', 12, 15),
  ('tmp_zone_valve',      'Zone Valve / Damper',        '🔧', 24, 15),
  -- Ventilation
  ('tmp_erv_hrv',         'ERV / HRV',                  '🔁', 12, 15),
  ('tmp_exhaust_fan',     'Exhaust Fan',                '💨', 24, 10),
  ('tmp_makeup_air',      'Make-Up Air Unit',           '⬆️', 12, 15),
  ('tmp_chimney_flue',    'Chimney / Flue',             '🧱', 24, 30),
  -- Hot water
  ('tmp_water_heater',    'Water Heater',               '💧', 12, 12),
  ('tmp_hp_water_heater', 'Heat Pump Water Heater',     '🌡', 12, 15),
  ('tmp_expansion_tank',  'Expansion Tank',             '🛢', 24, 10),
  -- Air quality
  ('tmp_humidifier',      'Humidifier',                 '💦', 12, 10),
  ('tmp_dehumidifier',    'Dehumidifier',               '🌵', 12, 10),
  ('tmp_air_purifier',    'Air Purifier / Filter',      '🌫',  6, 10),
  ('tmp_uv_light',        'UV Light',                   '☢️', 12,  5),
  ('tmp_co_detector',     'CO Detector',                '🚨', 12,  7),
  -- Controls
  ('tmp_thermostat',      'Thermostat',                 '🌡️', 24, 10),
  ('tmp_zone_controller', 'Zone Controller',            '🎛️', 24, 15),
  ('tmp_bms',             'Building Management System', '🖥', 12, 15);

-- Step 2: remap existing equipment from old categories to new
UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_boiler')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code IN ('boiler_gas', 'boiler_oil'));

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_furnace')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code IN ('furnace_gas', 'furnace_electric'));

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_heat_pump')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code = 'heat_pump');

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_baseboard')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code = 'hydronic_baseboard');

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_central_ac')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code = 'central_ac_condenser');

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_mini_split')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code IN ('mini_split_head', 'mini_split_condenser'));

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_air_handler')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code = 'air_handler');

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_rtu')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code = 'rooftop_unit');

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_thermostat')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code = 'thermostat');

UPDATE equipment SET category_id = (SELECT id FROM equipment_categories WHERE code = 'tmp_water_heater')
  WHERE category_id IN (SELECT id FROM equipment_categories WHERE code IN ('water_heater_electric', 'water_heater_gas', 'water_heater_tankless'));

-- Step 3: delete the old categories (now unreferenced)
DELETE FROM equipment_categories WHERE code NOT LIKE 'tmp_%';

-- Step 4: strip the tmp_ prefix
UPDATE equipment_categories SET code = SUBSTRING(code FROM 5) WHERE code LIKE 'tmp_%';
