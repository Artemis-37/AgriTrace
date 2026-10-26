/// Écran de traitement d'une notification sur le mobile (selon son type).
enum NotificationTarget { fiche, stock, none }

NotificationTarget notificationTarget(String? kind) {
  switch (kind) {
    case 'convoy_settled':
    case 'collector_advance':
      return NotificationTarget.fiche;
    case 'convoy_received_mine':
    case 'convoy_created':
      return NotificationTarget.stock;
    default:
      return NotificationTarget.none;
  }
}
