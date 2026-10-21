import { FormEvent, useState } from 'react';
import { post } from '../api';
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

export default function Compte() {
  return (<><PageHeader title="Mon compte" subtitle="Sécurité de votre accès" /><Card title="Changer mon mot de passe"><ChangePasswordForm /></Card></>);
}
