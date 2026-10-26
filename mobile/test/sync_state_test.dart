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

  group('photos et parcelles', () {
    test('une photo de reçu attend sa déclaration, une photo de parcelle part tout de suite', () {
      expect(canUploadPhotoFor('declaration', 'local_only'), isFalse);
      expect(canUploadPhotoFor('declaration', null), isFalse);
      expect(canUploadPhotoFor('declaration', 'synced'), isTrue);
      expect(canUploadPhotoFor('parcel', null), isTrue);
    });
    test('reprendre un tracé demande parcels:update', () {
      expect(canUpdateParcel(['parcels:create']), isFalse);
      expect(canUpdateParcel(['parcels:create', 'parcels:update']), isTrue);
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

  test('menus du collecteur et du coach selon les droits', () {
    expect(canReadHistory(['declarations:read', 'declarations:create']), isTrue);
    expect(canReadHistory(['declarations:read']), isFalse);
    expect(canSeeFiche(['collector:stock']), isTrue);
    expect(canSeeFiche(['convoys:read']), isFalse);
  });

  test('le relevé de parcelle demande le droit de créer des parcelles', () {
    expect(canSurveyParcel(['parcels:create']), isTrue);
    expect(canSurveyParcel(['declarations:create']), isFalse);
  });

  test("la photo d'un reçu ne part qu'une fois la déclaration créée sur le serveur", () {
    expect(canUploadPhoto('local_only'), isFalse);
    expect(canUploadPhoto('error'), isFalse);
    expect(canUploadPhoto('pending'), isTrue);
    expect(canUploadPhoto('synced'), isTrue);
  });
}
