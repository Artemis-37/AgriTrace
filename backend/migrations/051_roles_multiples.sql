-- Plusieurs rôles par utilisateur : le journal des accès accepte l'ajout et le retrait d'un rôle.
ALTER TABLE user_access_events DROP CONSTRAINT IF EXISTS user_access_events_action_check;
ALTER TABLE user_access_events ADD CONSTRAINT user_access_events_action_check
  CHECK (action IN ('suspend','reactivate','role_change','revoke_sessions','role_add','role_remove'));
