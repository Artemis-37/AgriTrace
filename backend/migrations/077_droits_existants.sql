-- Rattrapage des droits pour les coopératives déjà existantes : les migrations 073 (suppression de producteurs) et 074 (questionnaires)
-- ajoutaient leurs droits par un INSERT … SELECT sur « roles », que la sécurité par organisation masque tant qu'aucune coopérative n'est
-- sélectionnée : sur une base déjà peuplée, aucun rôle n'était alors modifié. On repasse ici coopérative par coopérative.
BEGIN;
DO $$
DECLARE o record;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.current_org', o.id::text, true);
    INSERT INTO role_permissions(role_id, permission_code)
      SELECT r.id, p FROM roles r, unnest(ARRAY['producers:delete', 'questionnaires:manage']) p WHERE r.code IN ('coop_admin', 'adg') ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.current_org', '', true);
END $$;
COMMIT;
