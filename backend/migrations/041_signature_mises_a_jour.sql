-- Signature détachée (Ed25519) de chaque installateur : les postes la vérifient avec la clé publique embarquée dans l'application,
-- si bien qu'un serveur compromis ou un intrus sur le réseau ne peut pas leur faire exécuter un faux installateur.
BEGIN;
ALTER TABLE app_releases ADD COLUMN signature text;
COMMIT;
