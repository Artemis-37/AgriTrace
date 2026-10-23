-- Coût de transport et retenue (mise en compte) au kilo : préenregistrés dans le profil du délégué par l'administrateur de la coopérative ;
-- la caisse les reprend sans pouvoir les saisir. Valeur vide = tarif par défaut de la coopérative.
BEGIN;
ALTER TABLE collectors
  ADD COLUMN transport_per_kg numeric(18,4) CHECK (transport_per_kg IS NULL OR transport_per_kg >= 0),
  ADD COLUMN retention_per_kg numeric(18,4) CHECK (retention_per_kg IS NULL OR retention_per_kg >= 0);
INSERT INTO permissions(code, description) VALUES ('collectors:rates', 'Fixer le coût de transport et la retenue au kilo des délégués (administrateur)');
INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, 'collectors:rates' FROM roles r WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
