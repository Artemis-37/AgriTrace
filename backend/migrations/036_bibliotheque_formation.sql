BEGIN;
-- Bibliothèque de modules de formation agricole (cacao en priorité, café ensuite), chargée par défaut pour chaque coopérative.
-- Les coachs la consultent ; l'ADG (ou l'administrateur) conserve, modifie ou supprime chaque module.
-- review_state : to_review (chargé par défaut, pas encore relu) · kept (relu et conservé tel quel) · edited (modifié) · custom (créé par la coopérative).
CREATE TABLE training_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text CHECK (code IS NULL OR code ~ '^[a-z0-9-]{3,60}$'),
  theme text NOT NULL CHECK (length(btrim(theme)) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  crops text[] NOT NULL DEFAULT '{cacao}',
  certifications text[] NOT NULL DEFAULT '{}',
  level text NOT NULL DEFAULT 'base' CHECK (level IN ('base','intermediaire','avance')),
  duration_min int NOT NULL DEFAULT 45 CHECK (duration_min BETWEEN 5 AND 600),
  content jsonb NOT NULL,
  sort int NOT NULL DEFAULT 0,
  review_state text NOT NULL DEFAULT 'to_review' CHECK (review_state IN ('to_review','kept','edited','custom')),
  version int NOT NULL DEFAULT 1,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX training_modules_org ON training_modules (organization_id, sort);
ALTER TABLE training_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON training_modules
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

-- Chargement initial : une seule fois par coopérative (une suppression par l'ADG n'est donc jamais annulée sans action explicite).
CREATE TABLE training_library_state (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  seeded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE training_library_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_library_state FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON training_library_state
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

INSERT INTO permissions(code, description) VALUES
 ('training:read','Consulter la bibliothèque de modules de formation agricole'),
 ('training:manage','Conserver, modifier, créer et supprimer les modules de formation de la bibliothèque');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r, unnest(ARRAY['training:read','training:manage']) p WHERE r.code IN ('coop_admin','adg') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'training:read' FROM roles r WHERE r.code = 'coach' ON CONFLICT DO NOTHING;
COMMIT;
