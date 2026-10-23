import 'package:agritrace_mobile/data/repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('les produits inactifs ne sont pas proposés au délégué', () {
    final r = activeProducts([{'id': 'a', 'name': 'Cacao', 'active': true}, {'id': 'b', 'name': 'Café', 'active': false}, {'id': 'c', 'name': 'Anacarde'}]);
    expect(r.map((e) => e['name']), ['Cacao', 'Anacarde']);
  });
}
