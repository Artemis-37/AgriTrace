import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Photos en attente d'envoi (pièces d'identité, signatures, reçus, parcelles) : chiffrées sur l'appareil (AES-256-GCM).
/// La clé reste dans le stockage sécurisé d'Android (Keystore) ; le fichier ne contient jamais l'image en clair.
/// Format : « AGP1 » | nonce (12) | étiquette (16) | données chiffrées.
class PhotoVault {
  static final _magic = utf8.encode('AGP1');
  static const _alg = 'photo_key';
  final FlutterSecureStorage _s;
  PhotoVault([FlutterSecureStorage? s]) : _s = s ?? const FlutterSecureStorage();

  static bool isEncrypted(String path) => path.endsWith('.enc');

  Future<SecretKey> _key() async {
    var k = await _s.read(key: _alg);
    if (k == null) {
      k = base64Encode(SecretKeyData.random(length: 32).bytes);
      await _s.write(key: _alg, value: k);
    }
    return SecretKey(base64Decode(k));
  }

  /// Chiffre `source` vers `dest` (fichier .enc). Le fichier d'origine n'est pas touché ici.
  Future<void> encryptTo(String source, String dest) async {
    final plain = await File(source).readAsBytes();
    final box = await AesGcm.with256bits().encrypt(plain, secretKey: await _key());
    final out = BytesBuilder()..add(_magic)..add(box.nonce)..add(box.mac.bytes)..add(box.cipherText);
    await File(dest).writeAsBytes(out.toBytes(), flush: true);
  }

  Future<Uint8List> decrypt(String path) async {
    final b = await File(path).readAsBytes();
    if (b.length < 32 || !utf8.decode(b.sublist(0, 4), allowMalformed: true).startsWith('AGP1')) throw const FormatException('photo illisible');
    final box = SecretBox(b.sublist(32), nonce: b.sublist(4, 16), mac: Mac(b.sublist(16, 32)));
    return Uint8List.fromList(await AesGcm.with256bits().decrypt(box, secretKey: await _key()));
  }
}
