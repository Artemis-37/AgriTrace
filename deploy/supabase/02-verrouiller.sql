-- À exécuter UNE FOIS après la première migration : retire aux rôles publics de Supabase l'accès aux tables déjà créées.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
-- Contrôle : doit renvoyer rolbypassrls = false pour agritrace_app.
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('agritrace_app', 'postgres');
