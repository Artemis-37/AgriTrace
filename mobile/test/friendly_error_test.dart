// Les pages HTML ou messages techniques du serveur ne doivent jamais atteindre l'écran.
import 'package:agritrace_mobile/config.dart';
import 'package:agritrace_mobile/data/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('page HTML 502 : message clair, sans code', () {
    final m = friendlyServerMessage(502, '<!DOCTYPE html><html lang="en"><head><title>502</title><style>@font-face{}</style></head></html>');
    expect(m.contains('<'), isFalse);
    expect(m, contains('momentanément indisponible'));
  });
  test('erreur 500 et page HTML inattendue', () {
    expect(friendlyServerMessage(500, '{"statusCode":500}'), contains('problème'));
    expect(friendlyServerMessage(404, '<html>Not found</html>'), contains('inattendue'));
  });
  test('message métier du serveur conservé', () {
    expect(friendlyServerMessage(409, 'Ce numéro existe déjà'), 'Ce numéro existe déjà');
  });
  test('adresse du serveur : toujours propre et terminée par /v1', () {
    expect(Config.normalizeBase('https://x.onrender.com/'), 'https://x.onrender.com/v1');
    expect(Config.normalizeBase('https://x.onrender.com'), 'https://x.onrender.com/v1');
    expect(Config.normalizeBase('https://x.onrender.com/v1/'), 'https://x.onrender.com/v1');
    expect(friendlyServerMessage(404, 'Cannot POST //auth/login'), contains('Adresse du serveur'));
  });
}
