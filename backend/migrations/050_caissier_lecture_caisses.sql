-- Le caissier doit voir les caisses pour ouvrir sa session, payer un délégué et saisir ses mouvements.
BEGIN;
INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, 'cash:read' FROM roles r WHERE r.code = 'caissier' ON CONFLICT DO NOTHING;
COMMIT;
