-- 015 : espace du collecteur (achats, stock acheté, historique).
BEGIN;
INSERT INTO permissions(code, description) VALUES ('collector:stock','Consulter son propre stock acheté, ses convois et son compte (collecteur)');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT id, 'collector:stock' FROM roles WHERE code IN ('coop_admin','collecteur') ON CONFLICT DO NOTHING;
COMMIT;
