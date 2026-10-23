-- La provenance est une information du profil du collecteur (saisie à sa création) : elle alimente automatiquement le bulletin de pesée.
BEGIN;
ALTER TABLE collectors ADD COLUMN origin text CHECK (origin IS NULL OR length(origin) BETWEEN 1 AND 80);
ALTER TABLE convoys DROP COLUMN origin;
COMMIT;
