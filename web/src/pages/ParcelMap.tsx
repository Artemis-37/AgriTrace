import { useMemo, useRef, useState } from 'react';
import { get } from '../api';
import { ha } from '../format';
import { Badge, Card, ErrorBox, Loading, Stat, useAsync } from '../ui';

type Ring = number[][];
const rings = (g: any): Ring[] => (!g ? [] : g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p: any) => p[0]) : []);
const LEVEL: Record<string, string> = { declared: 'Déclarée', controlled: 'Contrôlée', verified: 'Vérifiée' };
const COLOR = { verified: '#1f8f4d', controlled: '#2f6fd0', declared: '#8a9a90' } as Record<string, string>;

/** Carte vectorielle des parcelles : projection locale (longitude corrigée par cos φ), zoom et déplacement, sans fond de carte externe (fonctionne hors ligne). */
export default function ParcelMap() {
  const { data, loading, error, reload } = useAsync(() => get<any>('/geo/map'), []);
  const [onlyAnom, setOnlyAnom] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const geo = useMemo(() => {
    const feats: any[] = data?.features ?? [];
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    for (const f of feats) for (const r of rings(f.geometry)) for (const [lon, lat] of r) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
    if (!feats.length) return null;
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const px = (lon: number) => (lon - minLon) * k, py = (lat: number) => maxLat - lat;
    const W = Math.max((maxLon - minLon) * k, 1e-6), H = Math.max(maxLat - minLat, 1e-6), pad = Math.max(W, H) * 0.04;
    const items = feats.map((f) => ({ f, d: rings(f.geometry).map((r) => 'M' + r.map(([lon, lat]) => `${px(lon).toFixed(6)} ${py(lat).toFixed(6)}`).join('L') + 'Z').join('') }));
    return { items, box: { x: -pad, y: -pad, w: W + 2 * pad, h: H + 2 * pad } };
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!geo) return <Card><p className="muted">Aucune parcelle géolocalisée pour le moment. Importez ou levez des polygones pour les voir ici.</p></Card>;

  const v = view ?? geo.box;
  const anomalies = geo.items.filter((i) => i.f.properties.anomaly).length;
  const shown = geo.items.filter((i) => !onlyAnom || i.f.properties.anomaly);
  const picked = geo.items.find((i) => i.f.properties.id === sel)?.f.properties;
  const zoom = (factor: number, cx = v.x + v.w / 2, cy = v.y + v.h / 2) => setView({ x: cx - (cx - v.x) * factor, y: cy - (cy - v.y) * factor, w: v.w * factor, h: v.h * factor });
  const onWheel = (e: React.WheelEvent) => {
    const r = svg.current!.getBoundingClientRect();
    zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, v.x + ((e.clientX - r.left) / r.width) * v.w, v.y + ((e.clientY - r.top) / r.height) * v.h);
  };
  const onDown = (e: React.PointerEvent) => { drag.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return; const r = svg.current!.getBoundingClientRect();
    setView({ ...v, x: drag.current.vx - ((e.clientX - drag.current.sx) / r.width) * v.w, y: drag.current.vy - ((e.clientY - drag.current.sy) / r.height) * v.h });
  };
  return (
    <>
      <div className="grid">
        <Stat label="Parcelles sur la carte" value={geo.items.length} />
        <Stat label="Avec anomalie ouverte" value={anomalies} tone={anomalies ? 'bad' : 'ok'} />
        <Stat label="Vérifiées" value={geo.items.filter((i) => i.f.properties.validation_status === 'verified').length} tone="ok" />
      </div>
      {data?.truncated && <p className="notice">Plus de 5 000 parcelles : seules les 5 000 premières sont affichées. Utilisez l'export pour la totalité.</p>}
      <Card>
        <div className="toolbar">
          <button className="btn btn-small btn-secondary" aria-label="Zoom avant" onClick={() => zoom(1 / 1.5)}>＋</button>
          <button className="btn btn-small btn-secondary" aria-label="Zoom arrière" onClick={() => zoom(1.5)}>－</button>
          <button className="btn btn-small btn-secondary" onClick={() => setView(null)}>Tout voir</button>
          <label><input type="checkbox" checked={onlyAnom} onChange={(e) => setOnlyAnom(e.target.checked)} /> Anomalies seulement</label>
          <span className="muted">
            <i style={{ background: COLOR.verified }} className="dot" /> Vérifiée <i style={{ background: COLOR.controlled }} className="dot" /> Contrôlée <i style={{ background: COLOR.declared }} className="dot" /> Déclarée <i style={{ background: '#d9382f' }} className="dot" /> Anomalie
          </span>
        </div>
        <svg ref={svg} role="img" aria-label="Carte des parcelles" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} style={{ width: '100%', height: 480, background: 'var(--map-bg, #eef3ec)', borderRadius: 8, touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
          {shown.map(({ f, d }) => {
            const p = f.properties, bad = p.anomaly, chosen = p.id === sel;
            return <path key={p.id} d={d} fill={COLOR[p.validation_status] ?? COLOR.declared} fillOpacity={chosen ? 0.85 : 0.45} stroke={bad ? '#d9382f' : chosen ? '#111' : COLOR[p.validation_status] ?? '#666'}
              strokeWidth={bad || chosen ? 2.5 : 1} vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={`Parcelle ${p.code}`}
              onClick={(e) => { e.stopPropagation(); setSel(p.id); }} onKeyDown={(e) => { if (e.key === 'Enter') setSel(p.id); }}><title>{p.code}</title></path>;
          })}
        </svg>
        <p className="muted" style={{ margin: '6px 0 0' }}>Molette ou boutons pour zoomer, glisser pour déplacer. Fond neutre : la carte fonctionne sans connexion.</p>
        {picked && (
          <div className="notice" role="status">
            <strong>{picked.code}</strong> · producteur {picked.producer_code} · {picked.filiere} · <Badge tone={picked.validation_status === 'verified' ? 'ok' : 'info'}>{LEVEL[picked.validation_status] ?? picked.validation_status}</Badge>
            {picked.anomaly && <> <Badge tone="bad">Anomalie ouverte</Badge></>} · déclarée {ha(picked.declared_area_ha)} · mesurée {ha(picked.measured_area_ha)}
          </div>
        )}
      </Card>
    </>
  );
}
