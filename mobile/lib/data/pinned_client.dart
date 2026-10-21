import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import '../config.dart';

/// Normalise une empreinte saisie ou affichée (« AB:12:… », majuscules, espaces) en 64 caractères hexadécimaux minuscules.
String normalizeFingerprint(String f) => f.replaceAll(RegExp(r'[^0-9a-fA-F]'), '').toLowerCase();

/// Vrai si le certificat (DER) a exactement l'empreinte SHA-256 attendue. Le nom d'hôte n'est pas contrôlé : l'adresse du serveur peut changer.
bool certificateMatchesPin(Uint8List der, String pin) {
  final expected = normalizeFingerprint(pin);
  return expected.length == 64 && sha256.convert(der).toString() == expected;
}

/// Client HTTP de l'application. Avec [Config.apiCertSha256], seul le serveur dont le certificat a cette empreinte est accepté
/// (certificat auto-signé du serveur de la coopérative) ; tout autre certificat invalide est refusé, comme avant.
http.Client createHttpClient({String pin = Config.apiCertSha256}) {
  if (pin.isEmpty) return http.Client();
  final hc = HttpClient()..badCertificateCallback = (X509Certificate cert, String host, int port) => certificateMatchesPin(cert.der, pin);
  return IOClient(hc);
}
