-- Inspection interne : score de conformité enregistré, et reprise demandée au coach lorsque le score est sous le seuil d'approbation.
BEGIN;
ALTER TABLE questionnaire_answers ADD COLUMN score numeric(5,1);
ALTER TABLE producer_assignment_targets ADD COLUMN needs_redo boolean NOT NULL DEFAULT false;
ALTER TABLE producer_assignment_targets ADD COLUMN redo_reason text;
COMMIT;
