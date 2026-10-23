-- Superficie et estimation de production du producteur : colonnes de la base importée par la coopérative.
ALTER TABLE producers ADD COLUMN IF NOT EXISTS area_ha numeric(12,4) CHECK (area_ha IS NULL OR area_ha >= 0);
ALTER TABLE producers ADD COLUMN IF NOT EXISTS estimated_kg numeric(14,2) CHECK (estimated_kg IS NULL OR estimated_kg >= 0);
