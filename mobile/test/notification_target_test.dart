import 'package:flutter_test/flutter_test.dart';
import 'package:agritrace_mobile/data/notification_target.dart';

void main() {
  test('chaque type de notification mène à son écran de traitement', () {
    expect(notificationTarget('task_assigned'), NotificationTarget.missions);
    expect(notificationTarget('task_request_decided'), NotificationTarget.missions);
    expect(notificationTarget('convoy_settled'), NotificationTarget.fiche);
    expect(notificationTarget('collector_advance'), NotificationTarget.fiche);
    expect(notificationTarget('convoy_received_mine'), NotificationTarget.stock);
    expect(notificationTarget('role_changed'), NotificationTarget.none);
    expect(notificationTarget(null), NotificationTarget.none);
  });
}
