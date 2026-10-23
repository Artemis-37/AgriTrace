-- Code (identifiant) de chaque intervenant de la coopérative : collecteurs, magasiniers, caissiers, coachs, administrateurs…
-- Attribué automatiquement à l'arrivée dans la coopérative (<code coopérative>-0001…), ou saisi à la main à la création.
BEGIN;
CREATE TABLE member_codes (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,29}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  UNIQUE (organization_id, code)
);
CREATE TABLE member_code_counters (organization_id uuid PRIMARY KEY REFERENCES organizations(id), last_no int NOT NULL DEFAULT 0);
ALTER TABLE member_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON member_codes
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
ALTER TABLE member_code_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON member_code_counters
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

-- Attribution automatique (déclencheur : couvre toutes les voies de création d'un membre, y compris la réplication).
CREATE FUNCTION assign_member_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; oc text; c text;
BEGIN
  IF EXISTS (SELECT 1 FROM member_codes WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RETURN NEW; END IF;
  SELECT upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')) INTO oc FROM organizations WHERE id = NEW.organization_id;
  LOOP
    INSERT INTO member_code_counters(organization_id, last_no) VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id) DO UPDATE SET last_no = member_code_counters.last_no + 1 RETURNING last_no INTO n;
    c := left(oc, 14) || '-' || lpad(n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM member_codes WHERE organization_id = NEW.organization_id AND code = c);
  END LOOP;
  INSERT INTO member_codes(organization_id, user_id, code) VALUES (NEW.organization_id, NEW.user_id, c);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assign_member_code AFTER INSERT ON user_organizations FOR EACH ROW EXECUTE FUNCTION assign_member_code();

-- Membres existants : codes dans l'ordre d'arrivée.
INSERT INTO member_codes(organization_id, user_id, code)
  SELECT m.organization_id, m.user_id, left(upper(regexp_replace(o.code, '[^A-Za-z0-9]', '', 'g')), 14) || '-' || lpad(row_number() OVER (PARTITION BY m.organization_id ORDER BY m.first_at, m.user_id)::text, 4, '0')
    FROM (SELECT organization_id, user_id, min(created_at) AS first_at FROM user_organizations GROUP BY 1, 2) m JOIN organizations o ON o.id = m.organization_id;
INSERT INTO member_code_counters(organization_id, last_no) SELECT organization_id, count(*) FROM member_codes GROUP BY 1;
COMMIT;
