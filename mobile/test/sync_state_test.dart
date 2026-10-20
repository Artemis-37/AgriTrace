import 'package:agritrace_mobile/sync/sync_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('localStateAfterOperation', () {
    test('la soumission acceptée confirme la déclaration', () {
      expect(localStateAfterOperation(opType: 'purchase_declaration.submit', opStatus: 'accepted'), 'synced');
    });
    test('la création acceptée laisse la déclaration en attente de soumission', () {
      expect(localStateAfterOperation(opType: 'purchase_declaration.create', opStatus: 'accepted'), 'pending');
    });
    test('rejet, correction et conflit passent en erreur', () {
      for (final s in ['rejected', 'to_correct', 'conflict']) {
        expect(localStateAfterOperation(opType: 'purchase_declaration.submit', opStatus: s), 'error');
      }
    });
    test('une erreur temporaire ne change rien', () {
      expect(localStateAfterOperation(opType: 'purchase_declaration.submit', opStatus: 'received'), isNull);
    });
    test('pending_validation reste réessayable', () {
      expect(isRetryable('pending_validation'), isTrue);
      expect(isRetryable('accepted'), isFalse);
    });
  });

  group('declarationLabel', () {
    test("une déclaration non confirmée est signalée comme locale", () {
      expect(declarationLabel(localState: 'local_only'), 'Brouillon local');
      expect(declarationLabel(localState: 'pending'), 'En attente de synchronisation');
    });
    test("une fois synchronisée, l'état serveur est affiché", () {
      expect(declarationLabel(localState: 'synced', status: 'received_confirmed'), 'Réception confirmée');
    });
  });

  test('permissions', () {
    expect(canSync(['sync:use']), isTrue);
    expect(canSync(['declarations:create']), isFalse);
  });
}
