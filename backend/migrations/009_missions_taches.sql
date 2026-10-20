-- Missions et tâches de terrain (CDC §11) : tâches officielles, demandes de coach, historique, saisies hors connexion.
BEGIN;

CREATE TABLE task_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  last_no integer NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('mapping','visit','survey','collection','training','control','other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date date,
  section text,
  producer_id uuid REFERENCES producers(id),
  parcel_id uuid REFERENCES parcels(id),
  campaign_id uuid REFERENCES campaigns(id),
  assignee_id uuid REFERENCES users(id),
  team_ids uuid[] NOT NULL DEFAULT '{}',
  expected_result text,
  validation_criteria text,
  instructions text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','open','in_progress','pending_sync','submitted','to_correct','validated','completed','closed','cancelled')),
  request_id uuid,
  started_at timestamptz, submitted_at timestamptz, reviewed_at timestamptz, closed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, code)
);
CREATE INDEX idx_tasks_assignee ON tasks (organization_id, assignee_id, status);
CREATE INDEX idx_tasks_producer ON tasks (producer_id);

-- Demandes de mission faites par un coach : jamais une tâche officielle sans décision d'un rôle autorisé
CREATE TABLE task_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  title text NOT NULL, description text,
  category text NOT NULL DEFAULT 'other',
  producer_id uuid REFERENCES producers(id),
  parcel_id uuid REFERENCES parcels(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  task_id uuid REFERENCES tasks(id),
  decided_by uuid, decided_at timestamptz, decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

-- Historique des statuts : append-only
CREATE TABLE task_history (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  from_status text, to_status text NOT NULL,
  note text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_history_task ON task_history (task_id, id);
CREATE TRIGGER trg_task_history_immutable BEFORE UPDATE OR DELETE ON task_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Observations, résultats, positions GPS, photos et documents saisis par l'exécutant (append-only, idempotents)
CREATE TABLE task_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(id),
  kind text NOT NULL CHECK (kind IN ('observation','result','gps','photo','document')),
  content text,
  latitude numeric(9,6), longitude numeric(9,6), accuracy_m numeric(8,2),
  document_id uuid REFERENCES documents(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),   -- date de saisie sur l'appareil si fournie
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_task_entries_task ON task_entries (task_id, recorded_at);
CREATE TRIGGER trg_task_entries_immutable BEFORE UPDATE OR DELETE ON task_entries FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE documents DROP CONSTRAINT documents_subject_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_subject_type_check CHECK (subject_type IN
  ('producer','collector','declaration','lot','receipt','payment','inspection','certificate','loan','parcel','task'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_counters','tasks','task_requests','task_history','task_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('tasks:read','Consulter les tâches qui me sont attribuées'),
 ('tasks:read_all','Consulter toutes les tâches de la coopérative'),
 ('tasks:create','Créer des missions officielles'),
 ('tasks:update','Modifier les instructions officielles d''une mission'),
 ('tasks:assign','Attribuer ou réattribuer une mission'),
 ('tasks:execute','Exécuter une mission attribuée (observations, GPS, photos, soumission)'),
 ('tasks:review','Vérifier une mission soumise (valider ou renvoyer à corriger)'),
 ('tasks:close','Terminer, clôturer ou annuler une mission'),
 ('tasks:request','Demander la création d''une mission'),
 ('tasks:decide_requests','Accepter ou refuser les demandes de mission');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin' AND p.code LIKE 'tasks:%' ON CONFLICT DO NOTHING;
COMMIT;
