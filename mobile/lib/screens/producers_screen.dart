import 'package:flutter/material.dart';

import '../main.dart';
import 'producer_detail_screen.dart';

const _green = Color(0xFF2F5D46);

/// Recherche d'un producteur (nom, code ou téléphone) parmi ceux de l'appareil, utilisable hors connexion.
class ProducersScreen extends StatefulWidget {
  const ProducersScreen({super.key});
  @override
  State<ProducersScreen> createState() => _ProducersScreenState();
}

class _ProducersScreenState extends State<ProducersScreen> {
  List<Map<String, Object?>> _rows = [];
  String _q = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await services.repo.searchProducers(_q);
    if (mounted) setState(() => _rows = r);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Rechercher un producteur')),
      body: Column(children: [
        Container(
          color: _green, padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Sélectionnez le producteur', style: TextStyle(color: Colors.white, fontSize: 20)),
            const SizedBox(height: 10),
            TextField(
              decoration: InputDecoration(
                hintText: 'Nom, code ou téléphone', filled: true, fillColor: Colors.white, isDense: true,
                suffixIcon: const Icon(Icons.search), border: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: BorderSide.none)),
              onChanged: (v) { _q = v; _load(); },
            ),
          ]),
        ),
        Expanded(
          child: _rows.isEmpty
              ? const Center(child: Text('Aucun producteur.\nSynchronisez pour charger la liste.', textAlign: TextAlign.center))
              : ListView.separated(
                  itemCount: _rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final p = _rows[i];
                    return Material(
                      color: Colors.white,
                      child: ListTile(
                        title: Text('${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim().toUpperCase()),
                        subtitle: Text('${p['internal_code'] ?? ''}${(p['village'] ?? '').toString().isEmpty ? '' : '  •  ${p['village']}'}'),
                        trailing: const Icon(Icons.person, color: Colors.black87),
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProducerDetailScreen(producer: p))),
                      ),
                    );
                  }),
        ),
      ]),
    );
  }
}

