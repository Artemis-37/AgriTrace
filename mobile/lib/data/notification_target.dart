/// Écran de traitement d'une notification sur le mobile (selon son type).
enum NotificationTarget { missions, fiche, stock, none }

NotificationTarget notificationTarget(String? kind) {
  switch (kind) {
    case 'task_assigned':
    case 'task_overdue':
    case 'task_submitted':
    case 'task_to_correct':
    case 'task_request':
    case 'task_request_decided':
      return NotificationTarget.missions;
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
