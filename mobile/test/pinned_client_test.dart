import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:agritrace_mobile/data/pinned_client.dart';

void main() {
  final der = Uint8List.fromList(List.generate(300, (i) => i % 251));
  final hex = sha256.convert(der).toString();

  test('le certificat dont l\'empreinte correspond est accepté, quelle que soit la présentation', () {
    expect(certificateMatchesPin(der, hex), isTrue);
    expect(certificateMatchesPin(der, hex.toUpperCase()), isTrue);
    expect(certificateMatchesPin(der, RegExp('.{2}').allMatches(hex).map((m) => m[0]!).join(':')), isTrue);
  });

  test('un autre certificat, une empreinte vide ou tronquée sont refusés', () {
    expect(certificateMatchesPin(Uint8List.fromList([...der, 1]), hex), isFalse);
    expect(certificateMatchesPin(der, ''), isFalse);
    expect(certificateMatchesPin(der, hex.substring(0, 40)), isFalse);
  });

  test('normalisation de l\'empreinte', () {
    expect(normalizeFingerprint('AB:cd ef'), 'abcdef');
  });
}
