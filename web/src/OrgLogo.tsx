import { useEffect, useState } from 'react';
import { getBlob } from './api';
import { useAuth } from './auth';

export const LOGO_EVENT = 'agritrace:logo-changed';

/** Logo de la coopérative courante (rien n'est affiché tant qu'aucun logo n'a été ajouté). */
export default function OrgLogo({ height = 48 }: { height?: number }) {
  const { org } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false, current: string | null = null;
    const load = async () => {
      try {
        const b = org ? await getBlob('/organization/logo') : null;
        if (dead) return;
        const u = b ? URL.createObjectURL(b) : null;
        if (current) URL.revokeObjectURL(current);
        current = u; setUrl(u);
      } catch { if (!dead) setUrl(null); }
    };
    load();
    window.addEventListener(LOGO_EVENT, load);
    return () => { dead = true; window.removeEventListener(LOGO_EVENT, load); if (current) URL.revokeObjectURL(current); };
  }, [org?.id]);
  if (!url) return null;
  return <img className="org-logo" src={url} alt={`Logo de ${org?.name ?? 'la coopérative'}`} style={{ maxHeight: height, maxWidth: '100%', objectFit: 'contain' }} />;
}
