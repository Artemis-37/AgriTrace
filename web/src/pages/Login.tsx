import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { useAction } from '../ui';

export default function Login() {
  const { status, orgs, signIn, chooseOrg, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => { e.preventDefault(); run(() => signIn(email.trim(), password)); };

  return (
    <div className="login">
      <div className="login-art">
        <h1>Agri<span>Trace</span></h1>
        <p>La traçabilité agricole, de la parcelle au marché. Producteurs, achats, stocks, finances et conformité de votre coopérative, au même endroit.</p>
      </div>
      <div className="login-form">
        {status === 'choose-org' ? (
          <div style={{ width: 'min(380px,100%)' }}>
            <h2>Choisissez votre coopérative</h2>
            <div className="org-list">
              {orgs.map((o) => <button key={o.id} className="btn btn-secondary" onClick={() => run(() => chooseOrg(o.id))}>{o.name}<br /><small>{o.code}</small></button>)}
            </div>
            <button className="btn btn-ghost" onClick={signOut} style={{ color: 'inherit' }}>Changer de compte</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2>Connexion</h2>
            <label className="field"><span>Adresse e-mail</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field"><span>Mot de passe</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button className="btn" disabled={busy} type="submit" style={{ width: '100%' }}>{busy ? 'Connexion…' : 'Se connecter'}</button>
          </form>
        )}
        {error && <p role="alert" className="error-box" style={{ marginTop: '1rem' }}>{error}</p>}
      </div>
    </div>
  );
}
