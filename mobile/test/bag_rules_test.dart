import 'package:flutter_test/flutter_test.dart';
import 'package:agritrace_mobile/data/bag_rules.dart';

void main() {
  test('2 sacs pour 11 kg (zéro oublié) : refusé', () {
    final m = bagCheck(quantity: '11', bags: 2);
    expect(m, isNotNull);
    expect(m, contains('entre 100 et 150 kg'));
  });
  test('2 sacs pour 110 kg : accepté', () => expect(bagCheck(quantity: '110', bags: 2), isNull));
  test('bornes incluses : 50 kg et 75 kg par sac', () {
    expect(bagCheck(quantity: '150', bags: 3), isNull);
    expect(bagCheck(quantity: '225', bags: 3), isNull);
    expect(bagCheck(quantity: '149', bags: 3), isNotNull);
    expect(bagCheck(quantity: '226', bags: 3), isNotNull);
  });
  test('virgule décimale, autre unité et sacs absents : pas de contrôle faussé', () {
    expect(bagCheck(quantity: '110,5', bags: 2), isNull);
    expect(bagCheck(quantity: '5', bags: 2, unit: 'sac'), isNull);
    expect(bagCheck(quantity: '110', bags: null), isNull);
  });
}
