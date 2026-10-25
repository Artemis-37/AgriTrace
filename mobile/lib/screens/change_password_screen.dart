import 'package:flutter/material.dart';

import '../data/api_client.dart';
import '../main.dart';

/// Changement de mot de passe : obligatoire après une réinitialisation par un administrateur.
class ChangePasswordScreen extends StatefulWidget {
  final VoidCallback onDone;
  const ChangePasswordScreen({super.key, required this.onDone});
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _cur = TextEditingController(), _next = TextEditingController(), _again = TextEditingController();
  bool _busy = false;
  bool _show = false; // afficher les mots de passe saisis
  String? _error;

  Future<void> _submit() async {
    if (_next.text.length < 10) { setState(() => _error = 'Le nouveau mot de passe doit comporter au moins 10 caractères.'); return; }
    if (_next.text != _again.text) { setState(() => _error = 'Les deux saisies ne sont pas identiques.'); return; }
    setState(() { _busy = true; _error = null; });
    try {
      await services.api.post('/auth/change-password', {'current_password': _cur.text, 'new_password': _next.text});
      if (mounted) widget.onDone();
    } on NetworkException {
      setState(() => _error = 'Pas de connexion : le changement nécessite Internet.');
    } on ApiException catch (e) {
      setState(() => _error = e.status == 401 ? 'Mot de passe temporaire incorrect.' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choisissez votre mot de passe'), automaticallyImplyLeading: false),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('Votre mot de passe a été réinitialisé par un administrateur. Remplacez le mot de passe temporaire par un mot de passe que vous seul connaissez.'),
          const SizedBox(height: 16),
          TextField(controller: _cur, obscureText: !_show, decoration: InputDecoration(labelText: 'Mot de passe temporaire', border: const OutlineInputBorder(), suffixIcon: IconButton(tooltip: _show ? 'Masquer le mot de passe' : 'Afficher le mot de passe', icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)))),
          const SizedBox(height: 12),
          TextField(controller: _next, obscureText: !_show, decoration: InputDecoration(labelText: 'Nouveau mot de passe (10 caractères minimum)', border: const OutlineInputBorder(), suffixIcon: IconButton(tooltip: _show ? 'Masquer le mot de passe' : 'Afficher le mot de passe', icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)))),
          const SizedBox(height: 12),
          TextField(controller: _again, obscureText: !_show, decoration: InputDecoration(labelText: 'Confirmer le nouveau mot de passe', border: const OutlineInputBorder(), suffixIcon: IconButton(tooltip: _show ? 'Masquer le mot de passe' : 'Afficher le mot de passe', icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show))), onSubmitted: (_) => _submit()),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Patientez…' : 'Changer le mot de passe')),
        ]),
      ),
    );
  }
}
