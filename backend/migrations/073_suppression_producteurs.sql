INSERT INTO permissions(code, description) VALUES ('producers:delete','Supprimer des producteurs (sans opération enregistrée)') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, 'producers:delete' FROM roles r WHERE r.code IN ('coop_admin','adg') ON CONFLICT DO NOTHING;
