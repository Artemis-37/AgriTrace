-- 022 : envoi de pièces depuis le mobile — clé du client pour qu'un renvoi (réponse perdue, réseau coupé) ne crée pas de doublon.
BEGIN;
ALTER TABLE documents ADD COLUMN client_key text;
CREATE UNIQUE INDEX uq_documents_client_key ON documents (organization_id, client_key) WHERE client_key IS NOT NULL;
COMMIT;
