-- Le modèle d'infrastructure « École » devient « École primaire » (les collèges et lycées ont leurs propres modèles).
-- Les relevés déjà saisis gardent leur catégorie d'origine ; seul le modèle est renommé, et seulement si « École primaire » n'existe pas déjà dans la coopérative.
BEGIN;
UPDATE field_templates t SET category = 'École primaire', updated_at = now()
 WHERE t.kind = 'infrastructure' AND t.category = 'École'
   AND NOT EXISTS (SELECT 1 FROM field_templates x WHERE x.organization_id = t.organization_id AND x.kind = 'infrastructure' AND x.category = 'École primaire');
COMMIT;
