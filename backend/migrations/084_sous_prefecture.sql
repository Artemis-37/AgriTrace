-- Localité du producteur : Région > Département (ville chef-lieu) > Sous-préfecture ; le village reste une information distincte.
BEGIN;
ALTER TABLE producers ADD COLUMN IF NOT EXISTS sub_prefecture text CHECK (sub_prefecture IS NULL OR length(sub_prefecture) BETWEEN 1 AND 100);
COMMIT;
