import 'dart:convert';

import '../main.dart';

/// Une question d'un questionnaire d'infrastructure (définie par l'ADG ou, à défaut, le modèle intégré).
class TemplateQuestion {
  final String key, label, type; // type : text | number | select
  final bool required;
  final List<String> options;
  const TemplateQuestion(this.key, this.label, this.type, {this.required = true, this.options = const []});
  factory TemplateQuestion.fromJson(Map<String, dynamic> j) => TemplateQuestion('${j['key']}', '${j['label']}', '${j['type']}',
      required: j['required'] != false, options: [for (final o in (j['options'] as List? ?? const [])) '$o']);
}

class InfraTemplate {
  final String category;
  final List<TemplateQuestion> questions;
  const InfraTemplate(this.category, this.questions);
}

class FieldTemplateSet {
  final List<InfraTemplate> infrastructures;
  /// thème de formation → modules (liste vide : le coach saisit le module librement)
  final Map<String, List<String>> themes;
  final bool fromServer;
  const FieldTemplateSet(this.infrastructures, this.themes, {this.fromServer = false});
}

const _yn = ['Oui', 'Non'];
const _builtinSchool = <TemplateQuestion>[
  TemplateQuestion('nom', "Nom de l'école", 'text'),
  TemplateQuestion('niveau', 'Niveau académique', 'select', options: ['Maternelle', 'Primaire']),
  TemplateQuestion('type', "Type d'école", 'select', options: ['Publique', 'Privée', 'Communautaire']),
  TemplateQuestion('capacite', 'Capacité totale', 'number'),
  TemplateQuestion('genre', 'Genre', 'select', options: ['Mixte', 'Filles', 'Garçons']),
  TemplateQuestion('classes', 'Nombre de classes', 'number'),
  TemplateQuestion('inscrits_garcons', "Nombre d'étudiants inscrits", 'number'),
  TemplateQuestion('inscrites_filles', "Nombre d'étudiantes inscrites", 'number'),
  TemplateQuestion('enseignants', "Nombre d'enseignants", 'number'),
  TemplateQuestion('frais', 'Frais de scolarité par an', 'number'),
  TemplateQuestion('cantine', "L'école dispose-t-elle d'une cantine opérationnelle ?", 'select', options: _yn),
  TemplateQuestion('latrines', "L'école dispose-t-elle des latrines fonctionnelles ?", 'select', options: _yn),
  TemplateQuestion('pct_classe_suivante', "Pourcentage d'élèves ayant passé à la classe suivante (au cours de la dernière année scolaire)", 'number'),
  TemplateQuestion('pct_examen', "Pourcentage d'élèves ayant passé l'examen CM2 ou ayant passé au lycée (au cours de la dernière année scolaire)", 'number'),
  TemplateQuestion('finance_partenaire', 'Financé par un partenaire ?', 'select', required: false, options: _yn),
  TemplateQuestion('annee_ouverture', "Année d'ouverture", 'number'),
  TemplateQuestion('finance_prime', 'Financé par la prime au cacao ?', 'select', required: false, options: _yn),
];
const _builtinThemes = <String, List<String>>{
  'Agriculture régénératrice': [
    'Actions paysagères', 'Agroforesterie et arbres à la ferme', "Conservation de l'eau après la récolte", "Conservation de l'eau avant la récolte",
    "Contrôle de l'érosion des sols", 'Correction du sol', 'Couverture permanente du sol', 'Cultures intercalaires et rotations des cultures',
    'Gestion des eaux usées', 'Gestion des résidus de récolte et des déchets',
  ],
  'Alimentation saine et nutrition': [], 'Collecte de documents et tenue de registres': [], 'Culture commerciale et financière': [], 'Diversification': [],
  'Eau, assainissement, et hygiène': [], "Entreprise responsable et droits de l'homme": [], 'Genre, jeunesse, et inclusion': [], 'Gestion des récoltes et des produits': [],
  'Gouvernance coopérative': [], 'Maladies transmissibles et non transmissibles': [], 'Normes et réglementations de certification': [], 'Santé et sécurité au travail': [],
  'Santé générale': [], 'Santé maternelle et reproductive': [],
};

/// Modèles de saisie déployés par l'ADG de la coopérative (réseau), mis en cache sur l'appareil ; à défaut, modèles intégrés.
class FieldTemplates {
  static const _kv = 'field_templates';

  static FieldTemplateSet parse(List<dynamic> rows, {bool fromServer = true}) {
    final infra = <InfraTemplate>[];
    final themes = <String, List<String>>{};
    for (final r in rows.cast<Map<String, dynamic>>()) {
      final def = (r['definition'] as Map?)?.cast<String, dynamic>() ?? const {};
      if (r['kind'] == 'infrastructure') {
        infra.add(InfraTemplate('${r['category']}', [for (final q in (def['questions'] as List? ?? const [])) TemplateQuestion.fromJson((q as Map).cast<String, dynamic>())]));
      } else if (r['kind'] == 'training_theme') {
        themes['${r['category']}'] = [for (final m in (def['modules'] as List? ?? const [])) '$m'];
      }
    }
    return FieldTemplateSet(infra.isEmpty ? const [InfraTemplate('École primaire', _builtinSchool)] : infra, themes.isEmpty ? _builtinThemes : themes, fromServer: fromServer);
  }

  static Future<FieldTemplateSet> load() async {
    try {
      final rows = await services.api.get('/field-templates') as List<dynamic>;
      await services.db.setKv(_kv, jsonEncode(rows));
      return parse(rows);
    } catch (_) {
      final c = await services.db.getKv(_kv);
      if (c != null) { try { return parse(jsonDecode(c) as List<dynamic>); } catch (_) {/* cache illisible : modèles intégrés */} }
      return parse(const [], fromServer: false);
    }
  }
}
