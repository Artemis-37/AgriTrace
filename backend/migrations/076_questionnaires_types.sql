-- Questionnaires (tâches) pré-chargés : chaque coopérative reçoit des modèles types (coaching, CLMRS, enquête de base, travail des enfants…)
-- que l'ADG peut modifier, dupliquer, archiver ou garder tels quels. Le code du modèle évite de les recharger en double.
BEGIN;
ALTER TABLE questionnaires ADD COLUMN template_code text;
ALTER TABLE questionnaires ADD COLUMN updated_at timestamptz;
CREATE UNIQUE INDEX uq_questionnaires_template ON questionnaires (organization_id, template_code) WHERE template_code IS NOT NULL;
COMMIT;
