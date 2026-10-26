-- « Service » : nouvelle nature d'élément ajouté au profil des producteurs (appui technique, crédit d'intrants, traitement groupé, transport…).
BEGIN;
ALTER TABLE producer_assignments DROP CONSTRAINT IF EXISTS producer_assignments_kind_check;
ALTER TABLE producer_assignments ADD CONSTRAINT producer_assignments_kind_check CHECK (kind IN ('formation','distribution','tache','inspection','service'));
COMMIT;
