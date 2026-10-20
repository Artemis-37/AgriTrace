import { FormEvent, useEffect, useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { useAction } from '../ui';
import PairWorkstation from '../PairWorkstation';

export default function Login() {
  const { status, orgs, signIn, chooseOrg, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  // Serveur local tout neuf : on propose de créer la coopérative au lieu de la connexion.
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => { get<{ mode: string; initialized: boolean }>('/mode').then((m) => setFirstRun(m.mode === 'local' && !m.initialized)).catch(() => undefined); }, []);
  const [f, setF] = useState({ kind: 'alone', organization_code: '', organization_name: '', admin_name: '', admin_email: '', admin_password: '', pairing_code: '' });
  const setField = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const body: any = { admin_name: f.admin_name.trim(), admin_email: f.admin_email.trim(), admin_password: f.admin_password };
      if (f.kind === 'paired') body.pairing_code = f.pairing_code.trim(); else { body.organization_code = f.organization_code.trim().toUpperCase(); body.organization_name = f.organization_name.trim(); }
      await post('/bootstrap/local', body);
      await signIn(f.admin_email.trim(), f.admin_password);
    });
  };

  const [pairing, setPairing] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); run(() => signIn(email.trim(), password)); };

  if (pairing) return <PairWorkstation onDone={() => window.location.reload()} onCancel={() => setPairing(false)} />;
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
        ) : firstRun ? (
          <form onSubmit={create} aria-label="Premier démarrage">
            <h2>Premier démarrage</h2>
            <p className="muted">Ce serveur est vierge. Créez la coopérative et son administrateur ; les données restent sur ce poste.</p>
            <label className="field"><span>Installation</span>
              <select value={f.kind} onChange={setField('kind')}>
                <option value="alone">Nouvelle coopérative (fonctionne seule, jumelage possible plus tard)</option>
                <option value="paired">Coopérative déjà déclarée au serveur central (code de jumelage)</option>
              </select></label>
            {f.kind === 'paired' ? (
              <label className="field"><span>Code de jumelage</span><textarea rows={3} required value={f.pairing_code} onChange={setField('pairing_code')} placeholder="AGT1-…" /></label>
            ) : (<>
              <label className="field"><span>Code de la coopérative</span><input required pattern="[A-Za-z0-9_\-]{2,20}" value={f.organization_code} onChange={setField('organization_code')} /></label>
              <label className="field"><span>Nom de la coopérative</span><input required minLength={2} value={f.organization_name} onChange={setField('organization_name')} /></label>
            </>)}
            <label className="field"><span>Nom de l'administrateur</span><input required minLength={2} value={f.admin_name} onChange={setField('admin_name')} /></label>
            <label className="field"><span>Adresse e-mail</span><input type="email" required value={f.admin_email} onChange={setField('admin_email')} /></label>
            <label className="field"><span>Mot de passe (12 caractères minimum)</span><input type="password" required minLength={12} autoComplete="new-password" value={f.admin_password} onChange={setField('admin_password')} /></label>
            <button className="btn" disabled={busy} type="submit" style={{ width: '100%' }}>{busy ? 'Création…' : 'Créer la coopérative'}</button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <h2>Connexion</h2>
            <label className="field"><span>Adresse e-mail</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field"><span>Mot de passe</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button className="btn" disabled={busy} type="submit" style={{ width: '100%' }}>{busy ? 'Connexion…' : 'Se connecter'}</button>
            <p style={{ marginTop: '.75rem', textAlign: 'center' }}><button type="button" className="btn btn-ghost btn-small" onClick={() => setPairing(true)}>Associer ce poste à la coopérative (code)</button></p>
          </form>
        )}
        {error && <p role="alert" className="error-box" style={{ marginTop: '1rem' }}>{error}</p>}
      </div>
    </div>
  );
}
