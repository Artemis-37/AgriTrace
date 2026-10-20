-- 017 : une notification adressée « par droit » n'est visible que tant que son destinataire détient encore ce droit.
BEGIN;
ALTER TABLE notifications ADD COLUMN permission_code text;
COMMIT;
