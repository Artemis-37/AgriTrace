-- 019 : rapports filtrables (CDC §26) : achats par période, section, collecteur, filière.
BEGIN;
INSERT INTO permissions(code, description) VALUES ('reports:read','Consulter et exporter les rapports d''achats (période, section, collecteur, filière)');
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'reports:read' FROM roles WHERE code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
