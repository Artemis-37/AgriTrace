-- Missions validées par l'ADG : grisées et non cliquables, puis retirées de la file une fois ce délai écoulé (jours après la validation ou la clôture).
BEGIN;
ALTER TABLE organization_profile ADD COLUMN tasks_done_visible_days int NOT NULL DEFAULT 7 CHECK (tasks_done_visible_days BETWEEN 0 AND 365);
COMMIT;
