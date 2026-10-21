import 'package:flutter_test/flutter_test.dart';
import 'package:agritrace_mobile/data/field_templates.dart';

void main() {
  test('sans modèle déployé : modèles intégrés (École, thèmes)', () {
    final t = FieldTemplates.parse(const [], fromServer: false);
    expect(t.infrastructures.single.category, 'École');
    expect(t.themes.containsKey('Agriculture régénératrice'), isTrue);
  });

  test("les modèles de l'ADG remplacent les modèles intégrés", () {
    final t = FieldTemplates.parse([
      {'kind': 'infrastructure', 'category': 'Centre de santé', 'definition': {'questions': [
        {'key': 'nom', 'label': 'Nom', 'type': 'text', 'required': true, 'options': []},
        {'key': 'eau', 'label': 'Eau potable ?', 'type': 'select', 'required': false, 'options': ['Oui', 'Non']},
      ]}},
      {'kind': 'training_theme', 'category': 'Cacaoculture durable', 'definition': {'modules': ['Taille', 'Greffage']}},
    ]);
    expect(t.infrastructures.map((c) => c.category), ['Centre de santé']);
    expect(t.infrastructures.first.questions[1].required, isFalse);
    expect(t.infrastructures.first.questions[1].options, ['Oui', 'Non']);
    expect(t.themes.keys, ['Cacaoculture durable']);
    expect(t.themes['Cacaoculture durable'], ['Taille', 'Greffage']);
  });
}
