import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:agritrace_mobile/data/photo_vault.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

class _Mem extends FlutterSecureStorage {
  final m = <String, String>{};
  @override
  Future<String?> read({required String key, IOSOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, MacOsOptions? mOptions, WindowsOptions? wOptions}) async => m[key];
  @override
  Future<void> write({required String key, required String? value, IOSOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, MacOsOptions? mOptions, WindowsOptions? wOptions}) async { m[key] = value!; }
}

void main() {
  test('la photo en attente est chiffrée sur le disque et retrouvée à l\'identique', () async {
    final dir = await Directory.systemTemp.createTemp('vault');
    addTearDown(() => dir.delete(recursive: true));
    final img = Uint8List.fromList(utf8.encode('JFIF-IMAGE-SECRETE-') + List<int>.generate(2000, (i) => i % 251));
    await File('${dir.path}/in.jpg').writeAsBytes(img);
    final v = PhotoVault(_Mem());
    await v.encryptTo('${dir.path}/in.jpg', '${dir.path}/out.enc');
    final raw = await File('${dir.path}/out.enc').readAsBytes();
    expect(utf8.decode(raw.sublist(0, 4)), 'AGP1');
    expect(String.fromCharCodes(raw).contains('IMAGE-SECRETE'), isFalse, reason: 'rien en clair dans le fichier');
    expect(await v.decrypt('${dir.path}/out.enc'), img);
    final bad = Uint8List.fromList(raw)..[raw.length - 1] ^= 1;
    await File('${dir.path}/bad.enc').writeAsBytes(bad);
    expect(() => v.decrypt('${dir.path}/bad.enc'), throwsA(anything), reason: 'fichier altéré refusé');
  });
}
