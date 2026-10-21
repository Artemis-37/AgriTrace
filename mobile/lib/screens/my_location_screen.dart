import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';

/// « Capturer mon emplacement » : lit le GPS du téléphone et affiche latitude, longitude et précision.
class MyLocationScreen extends StatefulWidget {
  const MyLocationScreen({super.key});
  @override
  State<MyLocationScreen> createState() => _MyLocationScreenState();
}

class _MyLocationScreenState extends State<MyLocationScreen> {
  Position? _pos;
  bool _busy = false;
  String? _msg;

  Future<void> _capture() async {
    setState(() { _busy = true; _msg = null; });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) { setState(() => _msg = 'Activez la localisation (GPS) du téléphone.'); return; }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) { setState(() => _msg = "L'accès à la position est refusé : autorisez-le dans les réglages de l'application."); return; }
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 25)));
      setState(() => _pos = p);
    } catch (_) {
      setState(() => _msg = 'Position introuvable : sortez à découvert et réessayez.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _pos;
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Capturer mon emplacement')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (p != null) Container(
          padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Latitude', style: TextStyle(color: Colors.black54)), Text(p.latitude.toStringAsFixed(7), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
            const SizedBox(height: 8),
            const Text('Longitude', style: TextStyle(color: Colors.black54)), Text(p.longitude.toStringAsFixed(7), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
            const SizedBox(height: 8),
            Text('Précision : ${p.accuracy.toStringAsFixed(0)} m', style: const TextStyle(color: Colors.black54)),
            TextButton.icon(onPressed: () => Clipboard.setData(ClipboardData(text: '${p.latitude.toStringAsFixed(7)},${p.longitude.toStringAsFixed(7)}')), icon: const Icon(Icons.copy), label: const Text('Copier')),
          ]),
        ),
        if (_msg != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_msg!, style: TextStyle(color: Colors.red.shade700))),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _busy ? null : _capture, style: FilledButton.styleFrom(backgroundColor: const Color(0xFF3F9B2E), padding: const EdgeInsets.symmetric(vertical: 14)),
          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.my_location),
          label: Text(_busy ? 'Recherche du GPS…' : 'Capturer mon emplacement'),
        ),
      ]),
    );
  }
}
