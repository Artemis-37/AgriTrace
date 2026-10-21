import { FormEvent, useEffect, useState } from 'react';
import { get, post } from '../api';
import { Card, ErrorBox, Field, PageHeader, useAction } from '../ui';

/** Formulaire de changement de mot de passe (page « Mon compte » ou écran obligatoire après réinitialisation). */
export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
  const [cur, setCur] = useState(''), [next, setNext] = useState(''), [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const act = useAction();
  const mismatch = again !== '' && next !== again;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => { await post('/auth/change-password', { current_password: cur, new_password: next }); setDone(true); if (forced) setTimeout(() => window.location.reload(), 800); });
  };
  if (done) return <p className="ok">Mot de passe changé. Vos autres sessions ont été déconnectées.</p>;
  return (
    <form onSubmit={submit} className="form">
      <Field label={forced ? 'Mot de passe temporaire reçu' : 'Mot de passe actuel'}><input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="Nouveau mot de passe" hint="10 caractères minimum, différent de l'actuel"><input type="password" autoComplete="new-password" minLength={10} required value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Confirmer le nouveau mot de passe"><input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
      {mismatch && <p className="muted" role="alert">Les deux saisies ne sont pas identiques.</p>}
      {act.error && <ErrorBox message={act.error} />}
      <button className="btn" disabled={act.busy || mismatch || next.length < 10 || !cur}>Changer le mot de passe</button>
    </form>
  );
}

export function ForcedPasswordChange() {
  return (
    <div style={{ maxWidth: 440, margin: '4rem auto', padding: '0 1rem' }}>
      <Card title="Choisissez votre mot de passe">
        <p className="muted">Votre mot de passe a été réinitialisé par un administrateur. Remplacez le mot de passe temporaire par un mot de passe que vous seul connaissez.</p>
        <ChangePasswordForm forced />
      </Card>
    </div>
  );
}

/** Double authentification (code à 6 chiffres d'une application d'authentification, codes de secours à usage unique). */
export function TwoFactor() {
  const [st, setSt] = useState<{ enabled: boolean; recovery_codes_left: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState(''), [pw, setPw] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const act = useAction();
  const reload = () => get<{ enabled: boolean; recovery_codes_left: number }>('/auth/2fa').then(setSt).catch(() => undefined);
  useEffect(() => { reload(); }, []);
  if (!st) return <p className="muted">Chargement…</p>;
  if (codes) return (<div>
    <p className="ok">Double authentification activée. Conservez ces codes de secours en lieu sûr : chacun ne sert qu'une fois et ils ne seront plus affichés.</p>
    <pre style={{ fontSize: '1.1rem', lineHeight: 1.7 }}>{codes.join('\n')}</pre>
    <button className="btn" onClick={() => { setCodes(null); setSetup(null); setCode(''); reload(); }}>J'ai noté les codes</button>
  </div>);
  if (st.enabled) return (<form className="form" onSubmit={(e) => { e.preventDefault(); act.run(async () => { await post('/auth/2fa/disable', { password: pw, code }); setPw(''); setCode(''); await reload(); }); }}>
    <p className="ok">Active. Codes de secours restants : {st.recovery_codes_left}.</p>
    <Field label="Mot de passe"><input type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
    <Field label="Code à 6 chiffres ou code de secours"><input required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
    {act.error && <ErrorBox message={act.error} />}
    <button className="btn btn-secondary" disabled={act.busy}>Désactiver la double authentification</button>
  </form>);
  if (!setup) return (<div>
    <p className="muted">Protège votre compte même si votre mot de passe est volé. Recommandé pour les administrateurs, comptables et caissiers.</p>
    {act.error && <ErrorBox message={act.error} />}
    <button className="btn" disabled={act.busy} onClick={() => act.run(async () => setSetup(await post('/auth/2fa/setup', {})))}>Activer la double authentification</button>
  </div>);
  return (<form className="form" onSubmit={(e) => { e.preventDefault(); act.run(async () => { const r: any = await post('/auth/2fa/enable', { code }); setCodes(r.recovery_codes); }); }}>
    <p>1. Dans une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…), ajoutez un compte avec cette clé :</p>
    <pre style={{ userSelect: 'all', fontSize: '1.1rem' }}>{setup.secret}</pre>
    <p className="muted">Type « basé sur le temps », 6 chiffres, 30 secondes.</p>
    <Field label="2. Saisissez le code à 6 chiffres affiché"><input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
    {act.error && <ErrorBox message={act.error} />}
    <button className="btn" disabled={act.busy}>Confirmer et activer</button>
  </form>);
}

export function ForcedTwoFactor() {
  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem' }}>
      <Card title="Activez la double authentification">
        <p className="muted">Votre rôle donne accès à des fonctions sensibles (équipe, finances, audit). Votre coopérative exige la double authentification : activez-la pour continuer.</p>
        <TwoFactor />
        <p style={{ marginTop: '1rem' }}><button className="btn btn-ghost btn-small" onClick={() => window.location.reload()}>C'est fait, continuer</button></p>
      </Card>
    </div>
  );
}

export default function Compte() {
  return (<><PageHeader title="Mon compte" subtitle="Sécurité de votre accès" /><Card title="Changer mon mot de passe"><ChangePasswordForm /></Card><Card title="Double authentification"><TwoFactor /></Card></>);
}
