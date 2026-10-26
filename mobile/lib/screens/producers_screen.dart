import 'package:flutter/material.dart';

import '../main.dart';
import 'producer_detail_screen.dart';

const _green = Color(0xFF0B5E3B);

/// Recherche d'un producteur (nom, code ou téléphone) parmi ceux de l'appareil, utilisable hors connexion.
class ProducersScreen extends StatefulWidget {
  const ProducersScreen({super.key});
  @override
  State<ProducersScreen> createState() => _ProducersScreenState();
}

class _ProducersScreenState extends State<ProducersScreen> {
  List<Map<String, Object?>> _rows = [];
  String _q = '';
  String? _section;
  List<Map<String, Object?>> _sections = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await services.repo.searchProducers(_q, section: _section);
    final s = _sections.isEmpty ? await services.repo.producerSections() : _sections;
    if (mounted) setState(() { _rows = r; _sections = s; });
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
                hintText: 'Nom, code, village ou téléphone', filled: true, fillColor: Colors.white, isDense: true,
                suffixIcon: const Icon(Icons.search), border: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: BorderSide.none)),
              onChanged: (v) { _q = v; _load(); },
            ),
            if (_sections.isNotEmpty) ...[
              const SizedBox(height: 10),
              SizedBox(height: 36, child: ListView(scrollDirection: Axis.horizontal, children: [
                Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: const Text('Toutes les sections'), selected: _section == null, onSelected: (_) { _section = null; _load(); })),
                for (final s in _sections)
                  Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(
                    label: Text('${s['section']} (${s['n']})'), selected: _section == s['section'],
                    onSelected: (_) { _section = _section == s['section'] ? null : '${s['section']}'; _load(); })),
              ])),
            ],
          ]),
        ),
        Expanded(
          child: _rows.isEmpty
              ? Center(child: Text(_section != null || _q.isNotEmpty ? 'Aucun producteur ne correspond.\nEffacez le filtre ou la recherche.' : 'Aucun producteur.\nSynchronisez pour charger la liste.', textAlign: TextAlign.center))
              : ListView.separated(
                  itemCount: _rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final p = _rows[i];
                    return Material(
                      color: Colors.white,
                      child: ListTile(
                        title: Text('${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim().toUpperCase()),
                        subtitle: Text('${p['internal_code'] ?? ''}${(p['village'] ?? '').toString().isEmpty ? '' : '  •  ${p['village']}'}${(p['section'] ?? '').toString().isEmpty ? '' : '  •  Section ${p['section']}'}'),
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

