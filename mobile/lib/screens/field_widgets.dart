import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../main.dart';

const fieldGreen = Color(0xFF2F5D46);
const fieldAction = Color(0xFF3F9B2E);

/// Bandeau de titre d'un formulaire de terrain.
class FieldBand extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const FieldBand(this.title, {super.key, this.children = const []});
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity, color: fieldGreen, padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(color: Colors.white, fontSize: 20)),
          if (children.isNotEmpty) const SizedBox(height: 10),
          ...children,
        ]),
      );
}

/// Bloc blanc à bordure fine.
class FieldCard extends StatelessWidget {
  final String? title;
  final Widget child;
  const FieldCard({super.key, this.title, required this.child});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
        child: Material(
          color: Colors.white, shape: RoundedRectangleBorder(side: const BorderSide(color: Color(0xFFDDDDDD)), borderRadius: BorderRadius.circular(4)),
          child: Padding(padding: const EdgeInsets.all(14), child: SizedBox(width: double.infinity, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(title!, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            child,
          ]))),
        ),
      );
}

InputDecoration fieldDeco(String hint) => InputDecoration(hintText: hint, isDense: true, border: const OutlineInputBorder(), contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12));

/// Liste déroulante : première entrée « sélectionner ».
class FieldDropdown extends StatelessWidget {
  final String? value;
  final String hint;
  final List<String> items;
  final ValueChanged<String?>? onChanged;
  const FieldDropdown({super.key, required this.value, required this.hint, required this.items, required this.onChanged});
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
        value: items.contains(value) ? value : null, isExpanded: true, decoration: fieldDeco(hint), hint: Text(hint),
        items: [for (final i in items) DropdownMenuItem(value: i, child: Text(i, overflow: TextOverflow.ellipsis))], onChanged: onChanged);
}

Widget fieldLabel(String t, {bool required = false}) => Padding(
      padding: const EdgeInsets.only(bottom: 6, top: 10),
      child: Text.rich(TextSpan(text: t, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15), children: [if (required) const TextSpan(text: ' *', style: TextStyle(color: Colors.red))])),
    );

/// Choix d'un producteur de l'appareil (recherche par nom ou code).
Future<Map<String, Object?>?> pickProducer(BuildContext context) => showModalBottomSheet<Map<String, Object?>>(
      context: context, isScrollControlled: true,
      builder: (ctx) => const _ProducerPicker(),
    );

class _ProducerPicker extends StatefulWidget {
  const _ProducerPicker();
  @override
  State<_ProducerPicker> createState() => _ProducerPickerState();
}

class _ProducerPickerState extends State<_ProducerPicker> {
  List<Map<String, Object?>> _rows = [];
  @override
  void initState() { super.initState(); _find(''); }
  Future<void> _find(String q) async { final r = await services.repo.searchProducers(q); if (mounted) setState(() => _rows = r); }
  @override
  Widget build(BuildContext context) => SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          Padding(padding: const EdgeInsets.all(12), child: TextField(autofocus: false, decoration: fieldDeco('Nom ou code du producteur').copyWith(suffixIcon: const Icon(Icons.search)), onChanged: _find)),
          Expanded(child: ListView(children: [
            for (final p in _rows)
              ListTile(
                title: Text('${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim().toUpperCase()),
                subtitle: Text('${p['internal_code'] ?? ''}${(p['village'] ?? '').toString().isEmpty ? '' : '  •  ${p['village']}'}'),
                onTap: () => Navigator.pop(context, p),
              ),
          ])),
        ]),
      );
}

/// Position GPS actuelle, ou un message d'erreur lisible.
Future<({Position? pos, String? error})> readPosition() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return (pos: null, error: 'Activez la localisation (GPS) du téléphone.');
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return (pos: null, error: "L'accès à la position est refusé : autorisez-le dans les réglages de l'application.");
    final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 25)));
    return (pos: p, error: null);
  } catch (_) {
    return (pos: null, error: 'Position introuvable : sortez à découvert et réessayez.');
  }
}

/// Zone de signature au doigt. Renvoie le dessin en PNG, ou null si rien n'a été tracé.
Future<Uint8List?> askSignature(BuildContext context) => showDialog<Uint8List>(context: context, builder: (_) => const _SignatureDialog());

class _SignatureDialog extends StatefulWidget {
  const _SignatureDialog();
  @override
  State<_SignatureDialog> createState() => _SignatureDialogState();
}

class _SignatureDialogState extends State<_SignatureDialog> {
  final List<List<Offset>> _strokes = [];
  static const _w = 300.0, _h = 160.0;

  Future<Uint8List?> _png() async {
    if (_strokes.isEmpty) return null;
    final rec = ui.PictureRecorder();
    final canvas = Canvas(rec);
    canvas.drawRect(const Rect.fromLTWH(0, 0, _w, _h), Paint()..color = Colors.white);
    final paint = Paint()..color = Colors.black..strokeWidth = 2.5..strokeCap = StrokeCap.round..style = PaintingStyle.stroke;
    for (final s in _strokes) {
      if (s.length == 1) { canvas.drawCircle(s.first, 1.5, paint..style = PaintingStyle.fill); paint.style = PaintingStyle.stroke; continue; }
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (final o in s.skip(1)) { path.lineTo(o.dx, o.dy); }
      canvas.drawPath(path, paint);
    }
    final img = await rec.endRecording().toImage(_w.toInt() * 2, _h.toInt() * 2);
    final data = await img.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Signature'),
        content: Container(
          width: _w, height: _h, decoration: BoxDecoration(color: Colors.white, border: Border.all(color: Colors.black38)),
          child: GestureDetector(
            onPanStart: (d) => setState(() => _strokes.add([d.localPosition])),
            onPanUpdate: (d) => setState(() => _strokes.last.add(d.localPosition)),
            child: CustomPaint(painter: _InkPainter(_strokes), size: const Size(_w, _h)),
          ),
        ),
        actions: [
          TextButton(onPressed: () => setState(_strokes.clear), child: const Text('Effacer')),
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(onPressed: _strokes.isEmpty ? null : () async { final b = await _png(); if (context.mounted) Navigator.pop(context, b); }, child: const Text('Valider')),
        ],
      );
}

class _InkPainter extends CustomPainter {
  final List<List<Offset>> strokes;
  _InkPainter(this.strokes);
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.black..strokeWidth = 2.5..strokeCap = StrokeCap.round..style = PaintingStyle.stroke;
    for (final s in strokes) {
      if (s.length == 1) { canvas.drawCircle(s.first, 1.5, Paint()..color = Colors.black); continue; }
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (final o in s.skip(1)) { path.lineTo(o.dx, o.dy); }
      canvas.drawPath(path, paint);
    }
  }
  @override
  bool shouldRepaint(covariant _InkPainter old) => true;
}
