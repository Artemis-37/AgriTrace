-- Coachs, collecteurs et agents de terrain : connexion par l'application mobile uniquement (le portail web leur est fermé).
BEGIN;
ALTER TABLE roles ADD COLUMN mobile_only boolean NOT NULL DEFAULT false;
UPDATE roles SET mobile_only = true WHERE code IN ('coach', 'collecteur', 'agent_terrain');
COMMIT;
