-- ============================================================
-- Pipeline AI — Seed default inspection checklists per category
-- Migration 013
--
-- The new 30-category taxonomy (migration 012) shipped with empty
-- inspection_checklist values. This migration populates the most common
-- 15 categories with sensible default checklist items drawn from typical
-- HVAC field-service practice. Org admins can override later.
--
-- Categories left NULL on purpose (admins will fill in as needed):
--   chiller, ductwork, zone_valve, exhaust_fan, makeup_air, expansion_tank,
--   humidifier, dehumidifier, air_purifier, uv_light, zone_controller, bms,
--   window_ac, radiant_floor, space_heater
--
-- Checklist item shape: JSONB array of { label, notes_required_on_fail }.
-- The inspection-checklist component slugifies labels into the
-- checklist_item_code at submit time, so no codes are needed here.
-- ============================================================

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Operating pressure within range", "notes_required_on_fail": true},
  {"label": "Pressure relief valve tested", "notes_required_on_fail": true},
  {"label": "Expansion tank pre-charge OK", "notes_required_on_fail": false},
  {"label": "Flue/chimney inspected, no blockage", "notes_required_on_fail": true},
  {"label": "Low-water cutoff tested", "notes_required_on_fail": true},
  {"label": "No visible leaks at fittings/valves", "notes_required_on_fail": true},
  {"label": "Combustion / flame appearance OK", "notes_required_on_fail": true},
  {"label": "Heat exchanger inspected", "notes_required_on_fail": true},
  {"label": "CO levels within safe range", "notes_required_on_fail": true}
]'::jsonb WHERE code = 'boiler';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Air filter replaced or cleaned", "notes_required_on_fail": false},
  {"label": "Heat exchanger inspected (no cracks)", "notes_required_on_fail": true},
  {"label": "Burners cleaned and lit evenly", "notes_required_on_fail": true},
  {"label": "Flame sensor cleaned", "notes_required_on_fail": false},
  {"label": "Thermocouple / igniter tested", "notes_required_on_fail": true},
  {"label": "Blower motor lubricated (if applicable)", "notes_required_on_fail": false},
  {"label": "Safety controls tested", "notes_required_on_fail": true},
  {"label": "Thermostat operation verified", "notes_required_on_fail": true},
  {"label": "Vent / flue connections sealed", "notes_required_on_fail": true},
  {"label": "Condensate drain clear (high-efficiency)", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'furnace';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Air filter replaced or cleaned", "notes_required_on_fail": false},
  {"label": "Outdoor coil cleaned", "notes_required_on_fail": false},
  {"label": "Refrigerant pressures checked", "notes_required_on_fail": true},
  {"label": "Defrost cycle tested", "notes_required_on_fail": true},
  {"label": "Reversing valve operation verified", "notes_required_on_fail": true},
  {"label": "Electrical connections tight", "notes_required_on_fail": true},
  {"label": "Compressor amp draw within spec", "notes_required_on_fail": true},
  {"label": "Condensate drain clear", "notes_required_on_fail": false},
  {"label": "Outdoor fan motor / blades OK", "notes_required_on_fail": true}
]'::jsonb WHERE code = 'heat_pump';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Air filter replaced or cleaned", "notes_required_on_fail": false},
  {"label": "Outdoor coil cleaned", "notes_required_on_fail": false},
  {"label": "Refrigerant levels checked", "notes_required_on_fail": true},
  {"label": "Electrical connections tight", "notes_required_on_fail": true},
  {"label": "Capacitor tested", "notes_required_on_fail": true},
  {"label": "Compressor amp draw within spec", "notes_required_on_fail": true},
  {"label": "Condensate drain clear", "notes_required_on_fail": false},
  {"label": "Supply / return temperature split measured", "notes_required_on_fail": false},
  {"label": "Thermostat operation verified", "notes_required_on_fail": true}
]'::jsonb WHERE code = 'central_ac';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Indoor filters cleaned (all heads)", "notes_required_on_fail": false},
  {"label": "Indoor coil inspected, no mold", "notes_required_on_fail": true},
  {"label": "Drain pan and line clear", "notes_required_on_fail": true},
  {"label": "Refrigerant lines inspected, no damage / kinks", "notes_required_on_fail": true},
  {"label": "Outdoor unit fan / coil clean", "notes_required_on_fail": false},
  {"label": "Electrical connections at outdoor unit tight", "notes_required_on_fail": true},
  {"label": "Remote / wall controller tested", "notes_required_on_fail": false},
  {"label": "Mounting brackets / wall plate secure", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'mini_split';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Air filter replaced or cleaned", "notes_required_on_fail": false},
  {"label": "Indoor coil inspected", "notes_required_on_fail": true},
  {"label": "Blower motor lubricated (if applicable)", "notes_required_on_fail": false},
  {"label": "Blower wheel cleaned", "notes_required_on_fail": false},
  {"label": "Belt tension / condition checked", "notes_required_on_fail": false},
  {"label": "Condensate drain pan and line clear", "notes_required_on_fail": true},
  {"label": "Electrical connections tight", "notes_required_on_fail": true}
]'::jsonb WHERE code = 'air_handler';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Air filter replaced or cleaned", "notes_required_on_fail": false},
  {"label": "Heating section (gas/electric) tested", "notes_required_on_fail": true},
  {"label": "Cooling section / refrigerant pressures checked", "notes_required_on_fail": true},
  {"label": "Belts and pulleys inspected", "notes_required_on_fail": false},
  {"label": "Economiser / fresh-air damper operation", "notes_required_on_fail": false},
  {"label": "Condensate drain clear", "notes_required_on_fail": false},
  {"label": "Roof curb / flashing inspected for leaks", "notes_required_on_fail": true},
  {"label": "Unit disconnect / electrical OK", "notes_required_on_fail": true}
]'::jsonb WHERE code = 'rtu';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Temperature & pressure relief valve tested", "notes_required_on_fail": true},
  {"label": "Tank sediment flushed (if tank)", "notes_required_on_fail": false},
  {"label": "Anode rod inspected (every 2-3 years)", "notes_required_on_fail": false},
  {"label": "Thermostat setpoint verified (≤120°F)", "notes_required_on_fail": false},
  {"label": "No leaks at supply / drain / valves", "notes_required_on_fail": true},
  {"label": "Combustion vent / flue clear (if gas)", "notes_required_on_fail": true},
  {"label": "Expansion tank pre-charge (if installed)", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'water_heater';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Air filter cleaned", "notes_required_on_fail": false},
  {"label": "Evaporator coil inspected", "notes_required_on_fail": false},
  {"label": "Refrigerant levels checked", "notes_required_on_fail": true},
  {"label": "Compressor amp draw within spec", "notes_required_on_fail": true},
  {"label": "Condensate drain clear", "notes_required_on_fail": false},
  {"label": "T&P relief valve tested", "notes_required_on_fail": true},
  {"label": "No leaks at supply / drain", "notes_required_on_fail": true}
]'::jsonb WHERE code = 'hp_water_heater';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Setpoint accuracy tested (vs. reference thermometer)", "notes_required_on_fail": false},
  {"label": "Heat / cool / fan modes all tested", "notes_required_on_fail": true},
  {"label": "Batteries replaced (if applicable)", "notes_required_on_fail": false},
  {"label": "Schedule / programming verified", "notes_required_on_fail": false},
  {"label": "Wiring connections at base inspected", "notes_required_on_fail": false},
  {"label": "Wi-Fi / connectivity confirmed (smart stat)", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'thermostat';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Bleed valve operated, air purged", "notes_required_on_fail": false},
  {"label": "Fins / element cleaned", "notes_required_on_fail": false},
  {"label": "No leaks at supply / return / valve", "notes_required_on_fail": true},
  {"label": "Zone valve operation tested", "notes_required_on_fail": true},
  {"label": "Even heat distribution across length", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'baseboard';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Filters cleaned or replaced", "notes_required_on_fail": false},
  {"label": "Heat exchanger / wheel inspected", "notes_required_on_fail": true},
  {"label": "Condensate drain clear (if applicable)", "notes_required_on_fail": false},
  {"label": "Supply / exhaust airflow balanced", "notes_required_on_fail": false},
  {"label": "Defrost / freeze-protection tested", "notes_required_on_fail": true},
  {"label": "Controls / wall switch operation verified", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'erv_hrv';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Chimney swept / soot cleared", "notes_required_on_fail": false},
  {"label": "Liner condition inspected", "notes_required_on_fail": true},
  {"label": "Cap and screen secure", "notes_required_on_fail": false},
  {"label": "No cracks in masonry / mortar joints", "notes_required_on_fail": true},
  {"label": "Draft / spillage test passed", "notes_required_on_fail": true},
  {"label": "Flashing watertight", "notes_required_on_fail": true}
]'::jsonb WHERE code = 'chimney_flue';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Bearings checked / lubricated (if applicable)", "notes_required_on_fail": false},
  {"label": "Pump runs quietly, no cavitation", "notes_required_on_fail": true},
  {"label": "No leaks at flange / gasket", "notes_required_on_fail": true},
  {"label": "Amp draw within spec", "notes_required_on_fail": true},
  {"label": "Flow / pressure across pump checked", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'circulator_pump';

UPDATE equipment_categories SET inspection_checklist = '[
  {"label": "Detector responds to test button", "notes_required_on_fail": true},
  {"label": "Batteries replaced (if battery-powered)", "notes_required_on_fail": false},
  {"label": "Mounting and location verified per code", "notes_required_on_fail": false},
  {"label": "Manufacture date checked (replace at end of life)", "notes_required_on_fail": false}
]'::jsonb WHERE code = 'co_detector';
