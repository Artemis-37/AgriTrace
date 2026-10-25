import { useEffect, useRef, useState } from 'react';
import { del, getBlob, putForm } from './api';

/** Contrôle l'image choisie avant envoi : PNG ou JPEG, 2 Mo maximum. */
export function checkPhoto(f: File): string | null {
  if (!/^image\/(png|jpeg)$/.test(f.type)) return 'Photo : PNG ou JPEG uniquement.';
  if (f.size > 2 * 1024 * 1024) return 'Photo : 2 Mo au maximum.';
  return null;
}

export async function uploadPhoto(type: 'user' | 'producer', id: string, file: File) {
  const form = new FormData(); form.append('file', file);
  await putForm(`/photos/${type}/${id}`, form);
}

/** Photo d'identité d'une personne (cadre de la fiche) : affichage, ajout, remplacement et retrait. */
export function PhotoBox({ type, id, canEdit, name }: { type: 'user' | 'producer'; id: string; canEdit: boolean; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true; let u: string | null = null;
    getBlob(`/photos/${type}/${id}`).then((b) => { if (!alive) return; u = b ? URL.createObjectURL(b) : null; setUrl(u); }).catch(() => alive && setUrl(null));
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [type, id, tick]);
  const pick = async (f?: File) => {
    if (!f) return;
    const m = checkPhoto(f); if (m) { setErr(m); return; }
    setBusy(true); setErr('');
    try { await uploadPhoto(type, id, f); setTick((t) => t + 1); } catch (e: any) { setErr(e?.message ?? 'Envoi impossible'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="photo-box">
      <div className="photo-frame">{url ? <img src={url} alt={`Photo de ${name}`} /> : <span className="muted">Pas de photo</span>}</div>
      {canEdit && <div className="photo-btns">
        <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => input.current?.click()}>{url ? 'Changer' : 'Ajouter une photo'}</button>
        {url && <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={async () => { setBusy(true); try { await del(`/photos/${type}/${id}`); setTick((t) => t + 1); } finally { setBusy(false); } }}>Retirer</button>}
      </div>}
      {err && <div className="photo-err" role="alert">{err}</div>}
    </div>
  );
}

/** Choix d'une photo dans un formulaire de création : l'envoi se fait après l'enregistrement de la personne. */
export function PhotoPick({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { if (!file) { setPreview(null); return; } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  return (
    <div className="photo-box photo-pick">
      <div className="photo-frame">{preview ? <img src={preview} alt="Aperçu de la photo" /> : <span className="muted">Photo (facultatif)</span>}</div>
      <div className="photo-btns">
        <label className="btn btn-small">{file ? 'Changer' : 'Ajouter une photo'}
          <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const m = checkPhoto(f); setErr(m ?? ''); if (!m) onChange(f); }} /></label>
        {file && <button type="button" className="btn btn-small btn-ghost" onClick={() => onChange(null)}>Retirer</button>}
      </div>
      {err && <div className="photo-err" role="alert">{err}</div>}
    </div>
  );
}
