// Logique pure de présentation et de décision de la synchronisation (testable sans Flutter).

/// Libellé affiché pour une déclaration. Une déclaration reste « locale » tant que le serveur ne l'a pas confirmée :
/// elle ne vaut ni réception physique ni paiement.
String declarationLabel({required String localState, String? status}) {
  switch (localState) {
    case 'local_only':
      return 'Brouillon local';
    case 'pending':
      return 'En attente de synchronisation';
    case 'pending_validation':
      return 'En attente de validation du serveur';
    case 'error':
      return 'À corriger ou rejetée';
  }
  switch (status) {
    case 'draft':
      return 'Brouillon (serveur)';
    case 'received':
      return 'Reçue par le serveur';
    case 'in_review':
      return 'En vérification';
    case 'to_correct':
      return 'À corriger';
    case 'accepted':
      return 'Acceptée pour réception';
    case 'partially_received':
      return 'Réception partielle';
    case 'received_confirmed':
      return 'Réception confirmée';
    case 'rejected':
      return 'Rejetée';
    case 'cancelled':
      return 'Annulée';
    default:
      return status ?? 'Inconnu';
  }
}

/// Statut d'opération renvoyé par POST /sync/batch → état local de la déclaration concernée.
/// Retourne null si l'état local ne doit pas changer (erreur temporaire : on réessaiera).
String? localStateAfterOperation({required String opType, required String opStatus}) {
  switch (opStatus) {
    case 'accepted':
      // Après l'envoi du brouillon, la déclaration n'est confirmée qu'à la soumission acceptée.
      return opType == 'purchase_declaration.submit' ? 'synced' : 'pending';
    case 'pending_validation':
      return 'pending_validation';
    case 'to_correct':
    case 'rejected':
    case 'conflict':
      return 'error';
    default:
      return null; // received / erreur temporaire
  }
}

/// Une photo ne peut partir que si la déclaration existe déjà sur le serveur (création acceptée) et n'est pas rejetée.
bool canUploadPhoto(String declarationLocalState) => const {'pending', 'pending_validation', 'synced'}.contains(declarationLocalState);

/// Une opération est à renvoyer tant qu'elle n'a pas reçu de résultat définitif.
bool isRetryable(String opStatus) => opStatus == 'pending' || opStatus == 'pending_validation';

/// Les données ne sont plus utilisables si la permission de synchroniser a été retirée.
bool canSync(List<String> permissions) => permissions.contains('sync:use');
bool canCreateDeclaration(List<String> permissions) => permissions.contains('declarations:create');
bool canSurveyParcel(List<String> permissions) => permissions.contains('parcels:create');
/// Reprendre le tracé d'une parcelle existante demande le droit de la modifier (le serveur le vérifie aussi).
bool canUpdateParcel(List<String> permissions) => permissions.contains('parcels:update');
/// Une photo de parcelle ou de mission vise un objet déjà connu du serveur ; une photo de reçu attend que sa déclaration y soit.
bool canUploadPhotoFor(String subjectType, String? declarationLocalState) =>
    subjectType == 'declaration' ? declarationLocalState != null && canUploadPhoto(declarationLocalState) : true;
bool canCreateConvoy(List<String> permissions) => permissions.contains('convoys:create');
bool canReadHistory(List<String> permissions) => permissions.contains('declarations:read') && permissions.contains('declarations:create');
bool canSeeFiche(List<String> permissions) => permissions.contains('collector:stock');
bool canSeeMissions(List<String> permissions) => permissions.contains('tasks:read');
/// Un coach demande une mission : elle ne devient officielle qu'après décision d'un responsable.
bool canRequestMission(List<String> permissions) => permissions.contains('tasks:request');
