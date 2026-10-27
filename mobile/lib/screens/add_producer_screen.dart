import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../main.dart';
import 'field_widgets.dart';
import 'photo_capture.dart';

const consentText =
    "Déclaration de consentement\n\n"
    "J'accepte que la coopérative enregistre mes informations (identité, contacts, localisation de mon exploitation et de mes parcelles, photos) "
    "afin de gérer mon adhésion, suivre mes livraisons, assurer la traçabilité du cacao et répondre aux exigences de certification et de conformité "
    "(dont la réglementation européenne sur la déforestation).\n\n"
    "Ces informations peuvent être partagées, dans ce but seulement, avec les acheteurs, les organismes de certification et les autorités compétentes. "
    "Je peux demander à tout moment à consulter ou corriger mes informations auprès de la coopérative.\n\n"
    "(Texte type à faire valider par la coopérative avant usage.)";

const _idTypes = [
  "Carte nationale d'identité", 'CNI ivoirienne', 'CNI malienne', 'CNI burkinabé', 'CNI nigérienne', 'CNI togolaise', 'CNI béninoise', 'CNI sénégalaise', 'CNI guinéenne', 'CNI ghanéenne',
  'Passeport', "Attestation d'identité", 'Carte consulaire', 'Permis de conduire', 'Numéro matricule CCC du producteur', 'Pas de CNI ni matricule CCC',
];

/// Régions et districts de Côte d'Ivoire : liste de base, complétée par les localités déjà enregistrées par la coopérative.
const _regionsCI = [
  'Abidjan', 'Yamoussoukro', 'Agnéby-Tiassa', 'Bafing', 'Bagoué', 'Bélier', 'Béré', 'Bounkani', 'Cavally', 'Folon', 'Gbêkê', 'Gbôklé', 'Gôh', 'Gontougo',
  'Grands-Ponts', 'Guémon', 'Hambol', 'Haut-Sassandra', 'Iffou', 'Indénié-Djuablin', 'Kabadougou', 'La Mé', 'Lôh-Djiboua', 'Marahoué', 'Moronou', "N'Zi",
  'Nawa', 'Poro', 'San-Pédro', 'Sud-Comoé', 'Tchologo', 'Tonkpi', 'Worodougou',
];
const _other = 'Autre (saisir)…';

/// Ajouter un nouveau producteur sur le terrain (hors connexion possible) : identité, naissance, pièce d'identité, téléphone,
/// localité, coopérative, consentement signé. Le producteur est utilisable tout de suite ; le serveur lui attribue son code à l'envoi.
class AddProducerScreen extends StatefulWidget {
  const AddProducerScreen({super.key});
  @override
  State<AddProducerScreen> createState() => _AddProducerScreenState();
}

class _AddProducerScreenState extends State<AddProducerScreen> {
  final _last = TextEditingController(), _first = TextEditingController(), _idNo = TextEditingController(), _phone = TextEditingController();
  String? _region, _quartier, _lieu, _section;
  List<String> _sections = [];
  List<Map<String, dynamic>> _known = [];
  String _gender = 'Homme';
  DateTime? _birth;
  bool _noId = false, _noPhone = false, _consent = false, _busy = false;
  String? _idType, _photo, _msg;
  Uint8List? _signature;
  String _org = '';

  @override
  void initState() {
    super.initState();
    services.repo.identity().then((i) { if (mounted) setState(() => _org = i.org); });
    _loadLocalities();
    _loadSections();
  }

  /// Sections de la coopérative (copie gardée sur l'appareil pour le travail hors connexion).
  Future<void> _loadSections() async {
    final r = await services.repo.cachedGet('sections', () => services.api.get('/producers/sections'));
    if (r == null || !mounted) return;
    setState(() => _sections = _distinct([for (final e in (r.data as List)) (e as Map)['section'] as String?]));
  }

  /// Localités déjà connues (copie gardée sur l'appareil : les listes restent disponibles hors connexion).
  Future<void> _loadLocalities() async {
    final r = await services.repo.cachedGet('localities', () => services.api.get('/producers/localities'));
    if (r == null || !mounted) return;
    setState(() => _known = [for (final e in (r.data as List)) Map<String, dynamic>.from(e as Map)]);
  }

  List<String> _distinct(Iterable<String?> v, {Iterable<String> base = const []}) {
    final seen = <String, String>{};
    for (final x in [...base, ...v]) {
      final t = (x ?? '').trim();
      if (t.isNotEmpty) seen.putIfAbsent(t.toLowerCase(), () => t);
    }
    final l = seen.values.toList()..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return l;
  }

  bool _same(String? a, String? b) => (a ?? '').trim().toLowerCase() == (b ?? '').trim().toLowerCase();
  List<String> get _regions => _distinct(_known.map((e) => e['region'] as String?), base: _regionsCI);
  List<String> get _quartiers => _distinct(_known.where((e) => _same(e['region'] as String?, _region)).map((e) => e['department'] as String?));
  List<String> get _lieux => _distinct(_known.where((e) => _same(e['region'] as String?, _region) && _same(e['department'] as String?, _quartier)).map((e) => e['village'] as String?));

  Future<String?> _askName(String title) async {
    final c = TextEditingController();
    final v = await showDialog<String>(context: context, builder: (d) => AlertDialog(
      title: Text(title), content: TextField(controller: c, autofocus: true, textCapitalization: TextCapitalization.characters, decoration: fieldDeco('Nom')),
      actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Valider'))]));
    return (v == null || v.isEmpty) ? null : v;
  }

  /// Liste déroulante de localité : permet aussi de saisir un nom absent de la liste (nouveau quartier ou nouveau lieu).
  Widget _loc(String hint, String? value, List<String> items, ValueChanged<String?> set, String askTitle, {bool enabled = true}) {
    final all = [...items, if (value != null && !items.any((i) => _same(i, value))) value];
    return DropdownButtonFormField<String>(
      key: ValueKey('$hint-$value-${all.length}'), value: all.contains(value) ? value : null, isExpanded: true, decoration: fieldDeco(hint).copyWith(filled: true, fillColor: Colors.white), hint: Text(hint),
      items: [for (final i in all) DropdownMenuItem(value: i, child: Text(i, overflow: TextOverflow.ellipsis)), const DropdownMenuItem(value: _other, child: Text(_other, style: TextStyle(fontStyle: FontStyle.italic)))],
      onChanged: !enabled ? null : (v) async {
        if (v == _other) { final n = await _askName(askTitle); if (n != null) set(n); return; }
        set(v);
      });
  }

  @override
  void dispose() {
    for (final c in [_last, _first, _idNo, _phone]) { c.dispose(); }
    super.dispose();
  }

  String? get _phoneE164 {
    final d = _phone.text.replaceAll(RegExp(r'\D'), '');
    return d.isEmpty ? null : '+225$d';
  }

  String? get _problem {
    if (_last.text.trim().isEmpty || _first.text.trim().isEmpty) return 'Le nom et les prénoms sont obligatoires.';
    if (!_noPhone && _phone.text.trim().isNotEmpty && !RegExp(r'^\d{8,12}$').hasMatch(_phone.text.replaceAll(RegExp(r'\D'), ''))) return 'Numéro de téléphone invalide.';
    if (!_noId && _idNo.text.trim().isNotEmpty && _idType == null) return "Choisissez le type de pièce d'identité.";
    if (!_consent) return 'La déclaration de consentement doit être lue et validée.';
    if (_signature == null) return 'La signature du producteur est obligatoire.';
    return null;
  }

  Future<void> _pickBirth() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _birth ?? DateTime(now.year - 40), firstDate: DateTime(1900), lastDate: now);
    if (d != null) setState(() => _birth = d);
  }

  Future<void> _read() async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: const Text('Déclaration de consentement'), content: SingleChildScrollView(child: Text(consentText)),
      actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Fermer')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text("J'ai lu et je valide"))]));
    if (ok == true) setState(() => _consent = true);
  }

  Future<void> _sign() async {
    final b = await askSignature(context);
    if (b != null) setState(() => _signature = b);
  }

  Future<void> _save() async {
    final p = _problem;
    if (p != null) { setState(() => _msg = p); return; }
    setState(() { _busy = true; _msg = null; });
    String two(int n) => n.toString().padLeft(2, '0');
    final id = await services.repo.queueProducer(
      lastName: _last.text.trim(), firstNames: _first.text.trim(), gender: _gender == 'Homme' ? 'male' : 'female',
      birthDate: _birth == null ? null : '${_birth!.year}-${two(_birth!.month)}-${two(_birth!.day)}',
      idDocType: _noId || _idNo.text.trim().isEmpty ? null : _idType, idDocNumber: _noId || _idNo.text.trim().isEmpty ? null : _idNo.text.trim(),
      phone: _noPhone ? null : _phoneE164, region: _region, department: _quartier,
      section: _section, village: _lieu, consent: true);
    if (_photo != null) await services.repo.queuePhoto(subjectType: 'producer', subjectId: id, kind: 'Photo du producteur', sourcePath: _photo!);
    final sig = File('${Directory.systemTemp.path}/signature-$id.png');
    await sig.writeAsBytes(_signature!);
    await services.repo.queuePhoto(subjectType: 'producer', subjectId: id, kind: 'Signature de consentement', sourcePath: sig.path);
    services.sync.run();
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Ajouter un nouveau producteur')),
      body: Column(children: [
        Expanded(child: ListView(padding: const EdgeInsets.only(bottom: 16), children: [
          FieldBand('Ajouter un producteur', children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: Column(children: [
                TextField(controller: _last, textCapitalization: TextCapitalization.characters, decoration: fieldDeco('Nom du producteur').copyWith(filled: true, fillColor: Colors.white)),
                const SizedBox(height: 8),
                TextField(controller: _first, textCapitalization: TextCapitalization.words, decoration: fieldDeco('Prénoms').copyWith(filled: true, fillColor: Colors.white)),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(value: _gender, decoration: fieldDeco('Genre').copyWith(filled: true, fillColor: Colors.white),
                    items: const [DropdownMenuItem(value: 'Homme', child: Text('Homme')), DropdownMenuItem(value: 'Femme', child: Text('Femme'))], onChanged: (v) => setState(() => _gender = v ?? _gender)),
              ])),
              const SizedBox(width: 12),
              GestureDetector(
                onTap: () async { final p = await takePhotoPath(); if (p != null && mounted) setState(() => _photo = p); },
                child: SizedBox(width: 104, height: 128, child: Stack(clipBehavior: Clip.none, children: [
                  Positioned.fill(child: Container(color: const Color(0xFFE6E6E6),
                      child: _photo == null ? const Icon(Icons.person, size: 72, color: Colors.black38) : Image.file(File(_photo!), fit: BoxFit.cover))),
                  Positioned(right: -8, bottom: -8, child: Container(width: 40, height: 40, decoration: const BoxDecoration(color: Color(0xFFF28C1E), shape: BoxShape.circle),
                      child: const Icon(Icons.add_a_photo_outlined, color: Colors.white, size: 22))),
                ])),
              ),
            ]),
          ]),
          FieldCard(title: 'Date de naissance', child: InkWell(
            onTap: _pickBirth,
            child: InputDecorator(decoration: fieldDeco('JJ/MM/AAAA').copyWith(suffixIcon: const Icon(Icons.calendar_month_outlined)),
                child: Text(_birth == null ? 'JJ/MM/AAAA' : '${_birth!.day.toString().padLeft(2, '0')}/${_birth!.month.toString().padLeft(2, '0')}/${_birth!.year}')),
          )),
          FieldCard(title: "Carte nationale d'identité", child: Column(children: [
            CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, title: const Text('Aucun identifiant national applicable !'), value: _noId, onChanged: (v) => setState(() => _noId = v ?? false)),
            if (!_noId) ...[
              FieldDropdown(value: _idType, hint: 'Type de pièce', items: _idTypes, onChanged: (v) => setState(() => _idType = v)),
              const SizedBox(height: 8),
              TextField(controller: _idNo, decoration: fieldDeco("Numéro de la pièce d'identité")),
            ],
          ])),
          FieldCard(title: 'Numéros de téléphone', child: Column(children: [
            CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, title: const Text('Aucun numéro de téléphone applicable !'), value: _noPhone, onChanged: (v) => setState(() => _noPhone = v ?? false)),
            if (!_noPhone) Row(children: [
              const SizedBox(width: 70, child: InputDecorator(decoration: InputDecoration(isDense: true, border: OutlineInputBorder(), contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)), child: Text('+225'))),
              const SizedBox(width: 8),
              Expanded(child: TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: fieldDeco('Numéro de téléphone'))),
            ]),
          ])),
          FieldCard(title: 'Localité', child: Column(children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: DropdownButtonFormField<String>(value: "CÔTE D'IVOIRE", isExpanded: true, decoration: fieldDeco('Pays'),
                  items: const [DropdownMenuItem(value: "CÔTE D'IVOIRE", child: Text("CÔTE D'IVOIRE", overflow: TextOverflow.ellipsis))], onChanged: (_) {})),
              const SizedBox(width: 8),
              Expanded(child: _loc('Région', _region, _regions, (v) => setState(() { _region = v; _quartier = null; _lieu = null; }), 'Nouvelle région')),
            ]),
            const SizedBox(height: 8),
            _loc('Sélectionnez le quartier', _quartier, _quartiers, (v) => setState(() { _quartier = v; _lieu = null; }), 'Nouveau quartier', enabled: _region != null),
            const SizedBox(height: 8),
            Align(alignment: Alignment.centerLeft, child: FractionallySizedBox(widthFactor: 0.6,
                child: _loc('Sélectionnez lieu', _lieu, _lieux, (v) => setState(() => _lieu = v), 'Nouveau lieu', enabled: _quartier != null))),
          ])),
          FieldCard(title: "Informations sur l'exploitation agricole", child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            fieldLabel("Rôle de l'agriculteur"),
            InputDecorator(decoration: fieldDeco('').copyWith(filled: true, fillColor: const Color(0xFFEEEEEE)), child: const Text('Agriculteur principal')),
          ])),
          FieldCard(title: 'Coopérative', child: Row(children: [
            Expanded(child: InputDecorator(decoration: fieldDeco('').copyWith(filled: true, fillColor: const Color(0xFFEEEEEE)), child: Text(_org.isEmpty ? 'Ma coopérative' : _org))),
            const SizedBox(width: 8),
            Expanded(child: FieldDropdown(value: _section, hint: 'Sélectionnez la section', items: _sections, onChanged: (v) => setState(() => _section = v))),
          ])),
          if (_msg != null) Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 0), child: Text(_msg!, style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.w600))),
        ])),
        Material(color: Colors.white, elevation: 8, child: Padding(padding: const EdgeInsets.all(10), child: Column(mainAxisSize: MainAxisSize.min, children: [
          OutlinedButton(
            onPressed: _read, style: OutlinedButton.styleFrom(minimumSize: const Size(double.infinity, 48), side: BorderSide(color: _consent ? fieldAction : fieldGreen, width: 2), foregroundColor: fieldGreen),
            child: Text(_consent ? 'Déclaration de consentement validée ✓' : 'VEUILLEZ LIRE ET VALIDER LA DÉCLARATION DE CONSENTEMENT', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: FilledButton.icon(onPressed: _consent ? _sign : null, icon: const Icon(Icons.edit), label: const Text('SIGNATURE'), style: FilledButton.styleFrom(backgroundColor: Colors.grey.shade800, minimumSize: const Size(0, 48)))),
            const SizedBox(width: 8),
            if (_signature != null) Container(width: 90, height: 48, color: Colors.white, child: Image.memory(_signature!, fit: BoxFit.contain)),
            const SizedBox(width: 8),
            Expanded(child: FilledButton(onPressed: _busy ? null : _save, style: FilledButton.styleFrom(backgroundColor: fieldAction, minimumSize: const Size(0, 48)), child: const Text('SAUVEGARDER'))),
          ]),
        ]))),
      ]),
    );
  }
}
