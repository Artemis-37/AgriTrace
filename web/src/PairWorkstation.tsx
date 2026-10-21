import { FormEvent, useState } from 'react';
import logo from './assets/agritrace-logo.png';
import { pairWorkstation } from './api';
import { ErrorBox } from './ui';
import { useAction } from './ui';

/** Écran d'association de ce poste : on saisit le code à 8 caractères remis par l'administrateur (valable 15 minutes, à usage unique). */
export default function PairWorkstation({ onDone, onCancel, blocking }: { onDone: () => void; onCancel?: () => void; blocking?: boolean }) {
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => { await pairWorkstation(code); onDone(); }); };
  return (
    <div className="login">
      <div className="login-panel">
        <form onSubmit={submit} className="login-form" aria-label="Associer ce poste">
          <img className="login-logo" src={logo} alt="AgriTrace" />
          <h1>Associer ce poste</h1>
          <p className="muted">{blocking ? 'Ce poste n\'est pas associé à la coopérative : l\'accès est refusé, même avec un bon mot de passe. ' : ''}Demandez à votre administrateur un code d'association (Équipe → Postes de travail → Associer un poste), puis saisissez-le ici.</p>
          <label className="field"><span>Code d'association</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-2345" autoComplete="off" spellCheck={false} maxLength={9} autoFocus required /></label>
          {error && <ErrorBox message={error} />}
          <button className="btn" type="submit" disabled={busy || code.replace(/[^A-Z0-9]/g, '').length !== 8}>Associer ce poste</button>
          {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Retour</button>}
        </form>
      </div>
    </div>
  );
}
