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

const _idTypes = ["Carte nationale d'identité", 'Passeport', "Attestation d'identité", 'Carte consulaire', 'Permis de conduire'];

/// Ajouter un nouveau producteur sur le terrain (hors connexion possible) : identité, naissance, pièce d'identité, téléphone,
/// localité, coopérative, consentement signé. Le producteur est utilisable tout de suite ; le serveur lui attribue son code à l'envoi.
class AddProducerScreen extends StatefulWidget {
  const AddProducerScreen({super.key});
  @override
  State<AddProducerScreen> createState() => _AddProducerScreenState();
}

class _AddProducerScreenState extends State<AddProducerScreen> {
  final _last = TextEditingController(), _first = TextEditingController(), _idNo = TextEditingController(), _phone = TextEditingController();
  final _region = TextEditingController(), _village = TextEditingController(), _section = TextEditingController();
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
  }

  @override
  void dispose() {
    for (final c in [_last, _first, _idNo, _phone, _region, _village, _section]) { c.dispose(); }
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
      phone: _noPhone ? null : _phoneE164, region: _region.text.trim().isEmpty ? null : _region.text.trim(),
      section: _section.text.trim().isEmpty ? null : _section.text.trim(), village: _village.text.trim().isEmpty ? null : _village.text.trim(), consent: true);
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
                child: Container(width: 96, height: 120, color: const Color(0xFFE6E6E6),
                    child: _photo == null ? const Icon(Icons.add_a_photo_outlined, size: 40, color: Colors.black45) : Image.file(File(_photo!), fit: BoxFit.cover)),
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
            TextField(controller: _region, decoration: fieldDeco('Région')),
            const SizedBox(height: 8),
            TextField(controller: _village, decoration: fieldDeco('Village ou quartier')),
          ])),
          FieldCard(title: "Informations sur l'exploitation agricole", child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            fieldLabel("Rôle de l'agriculteur"),
            InputDecorator(decoration: fieldDeco('').copyWith(filled: true, fillColor: const Color(0xFFEEEEEE)), child: const Text('Agriculteur principal')),
          ])),
          FieldCard(title: 'Coopérative', child: Row(children: [
            Expanded(child: InputDecorator(decoration: fieldDeco('').copyWith(filled: true, fillColor: const Color(0xFFEEEEEE)), child: Text(_org.isEmpty ? 'Ma coopérative' : _org))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _section, decoration: fieldDeco('Section'))),
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
