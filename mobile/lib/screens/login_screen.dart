import 'package:flutter/material.dart';

import '../data/api_client.dart';
import '../main.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  final String? notice;
  const LoginScreen({super.key, this.notice});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _error = widget.notice;
  }
  List<dynamic> _orgs = [];
  final _code = TextEditingController();
  bool _pairing = false;

  Future<void> _pair() async {
    setState(() { _busy = true; _error = null; });
    try {
      final name = await services.api.pairWorkstation(_code.text.trim());
      if (mounted) setState(() { _pairing = false; _code.clear(); _error = 'Téléphone associé (« $name »). Vous pouvez vous connecter.'; });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } on NetworkException {
      setState(() => _error = 'Pas de connexion : l\'association nécessite le réseau du bureau ou Internet.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _login() async {
    setState(() { _busy = true; _error = null; });
    try {
      await services.api.login(_email.text.trim().toLowerCase(), _password.text, deviceLabel: 'Android');
      final orgs = await services.api.myOrganizations();
      if (orgs.isEmpty) {
        await services.store.signOut();
        setState(() => _error = "Ce compte n'est rattaché à aucune coopérative.");
      } else if (orgs.length == 1) {
        await _enter(orgs.first['id'] as String);
      } else {
        setState(() => _orgs = orgs);
      }
    } on NetworkException {
      setState(() => _error = 'Pas de connexion : la première connexion nécessite Internet.');
    } on ApiException catch (e) {
      setState(() { _error = e.status == 401 ? 'Identifiants invalides.' : e.message; if (e.message.contains('pas associé')) _pairing = true; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _enter(String orgId) async {
    final ok = await services.repo.switchOrganization(orgId);
    if (!ok) {
      setState(() => _error = "Des opérations d'une autre coopérative ne sont pas encore envoyées. Reconnectez-vous à celle-ci et synchronisez d'abord.");
      return;
    }
    await services.store.setOrg(orgId);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const SyncShell(child: HomeScreen())));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('AgriTrace', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineLarge?.copyWith(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.bold)),
                const Text('La traçabilité agricole, de la parcelle au marché.', textAlign: TextAlign.center),
                const SizedBox(height: 32),
                if (_pairing) ...[
                  const Text('Associer ce téléphone', style: TextStyle(fontWeight: FontWeight.bold)),
                  const Text("Saisissez le code d'association remis par votre administrateur (valable 15 minutes)."),
                  const SizedBox(height: 12),
                  TextField(controller: _code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: "Code d'association", hintText: 'ABCD-2345', border: OutlineInputBorder()), onSubmitted: (_) => _pair()),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: _busy ? null : _pair, child: Text(_busy ? 'Association…' : 'Associer ce téléphone')),
                  TextButton(onPressed: () => setState(() => _pairing = false), child: const Text('Retour')),
                ] else if (_orgs.isEmpty) ...[
                  TextField(controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.username], decoration: const InputDecoration(labelText: 'E-mail', border: OutlineInputBorder())),
                  const SizedBox(height: 12),
                  TextField(controller: _password, obscureText: true, autofillHints: const [AutofillHints.password], decoration: const InputDecoration(labelText: 'Mot de passe', border: OutlineInputBorder()), onSubmitted: (_) => _login()),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _busy ? null : _login, child: Text(_busy ? 'Connexion…' : 'Se connecter')),
                  TextButton(onPressed: () => setState(() => _pairing = true), child: const Text('Associer ce téléphone à la coopérative (code)')),
                ] else ...[
                  const Text('Choisissez la coopérative', style: TextStyle(fontWeight: FontWeight.bold)),
                  for (final o in _orgs) ListTile(title: Text(o['name'] as String), subtitle: Text(o['code'] as String), onTap: () => _enter(o['id'] as String)),
                ],
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
