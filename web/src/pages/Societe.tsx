import { useRef, useState } from 'react';
import { del, get, put, putForm } from '../api';
import OrgLogo, { LOGO_EVENT } from '../OrgLogo';
import { Card, ErrorBox, Field, useAction, useAsync } from '../ui';

/** Profil de la coopérative : nom commercial et coordonnées repris sur les reçus imprimés. */
export function ProfileCard() {
  const { data, reload } = useAsync(() => get<any>('/organization/profile'), []);
  const [f, setF] = useState<any | null>(null);
  const act = useAction();
  const v = f ?? data;
  const set = (k: string) => (e: any) => setF({ ...(f ?? data), [k]: e.target.value });
  return (
    <Card title="Profil de la coopérative">
      <p className="muted">Ces informations figurent en en-tête des reçus et pièces imprimés. Nom enregistré : <strong>{data?.name ?? '…'}</strong></p>
      {v && <div className="form-grid">
        <Field label="Nom commercial"><input value={v.commercial_name ?? ''} maxLength={200} onChange={set('commercial_name')} /></Field>
        <Field label="Adresse"><input value={v.address ?? ''} maxLength={300} onChange={set('address')} /></Field>
        <Field label="Téléphone"><input value={v.phone ?? ''} maxLength={40} onChange={set('phone')} /></Field>
        <Field label="E-mail"><input type="email" value={v.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Code CCC de la coopérative" hint="Préfixe du numéro de connaissement des convois : CODE-année-3 lettres du délégué-n° (ex. SC000000-2026-OUM-1). Sans code, le numéro se saisit à la main."><input value={v.ccc_code ?? ''} maxLength={20} onChange={(e) => setF({ ...(f ?? data), ccc_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></Field>
        <Field label="Devise (code ISO)"><input value={v.currency ?? 'XOF'} maxLength={3} onChange={(e) => setF({ ...(f ?? data), currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Langue par défaut"><select value={v.default_language ?? 'fr'} onChange={set('default_language')}><option value="fr">Français</option><option value="en">English</option></select></Field>
      </div>}
      {act.error && <ErrorBox message={act.error} />}
      <div className="toolbar"><button className="btn" disabled={act.busy || !f} onClick={async () => { if (await act.run(() => put('/organization/profile', Object.fromEntries(['commercial_name', 'address', 'phone', 'email', 'currency', 'default_language', 'ccc_code'].filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]))))) { setF(null); reload(); } }}>Enregistrer le profil</button></div>
    </Card>
  );
}

/** Identité de la coopérative : son logo apparaît dans son portail et dans l'application mobile de ses équipes. */
export function LogoCard() {
  const file = useRef<HTMLInputElement>(null);
  const act = useAction();
  const changed = () => window.dispatchEvent(new Event(LOGO_EVENT));
  const send = async () => {
    const f = file.current?.files?.[0];
    if (!f) return;
    const form = new FormData(); form.append('file', f);
    if (await act.run(() => putForm('/organization/logo', form))) { if (file.current) file.current.value = ''; changed(); }
  };
  return (
    <Card title="Logo de la coopérative">
      <p className="muted">Image PNG ou JPEG de 1 Mo maximum (fond clair ou transparent de préférence). Elle s'affiche en tête du portail et sur l'accueil de l'application mobile ; les téléphones la reçoivent à l'ouverture de l'application avec du réseau.</p>
      <div style={{ minHeight: 60, marginBottom: 8 }}><OrgLogo height={80} /></div>
      <div className="toolbar">
        <input ref={file} type="file" accept="image/png,image/jpeg" aria-label="Choisir un logo" />
        <button className="btn" disabled={act.busy} onClick={send}>Enregistrer le logo</button>
        <button className="btn btn-ghost" disabled={act.busy} onClick={async () => { if (confirm('Supprimer le logo ?') && (await act.run(() => del('/organization/logo')))) changed(); }}>Supprimer</button>
      </div>
      {act.error && <ErrorBox message={act.error} />}
    </Card>
  );
}

/** Société : identité, coordonnées et logo repris sur les reçus et pièces imprimés. */
export default function Societe() { return <><ProfileCard /><LogoCard /></>; }
