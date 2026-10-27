import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../api';
import { ha } from '../format';
import { Badge, Card, ErrorBox, Loading, Stat, useAsync } from '../ui';
import { ATTRIBUTION, BaseLayer, tileUrl, visibleTiles } from '../tiles';

const LAYER_KEY = 'agritrace.map.layer';
const readLayer = (): BaseLayer => { try { const v = localStorage.getItem(LAYER_KEY); return v === 'plan' || v === 'satellite' ? v : 'none'; } catch { return 'none'; } };

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
  const [layer, setLayer] = useState<BaseLayer>(readLayer);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const pickLayer = (l: BaseLayer) => { setLayer(l); try { localStorage.setItem(LAYER_KEY, l); } catch { /* stockage indisponible */ } };

  const geo = useMemo(() => {
    const feats: any[] = data?.features ?? [];
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    for (const f of feats) for (const r of rings(f.geometry)) for (const [lon, lat] of r) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
    if (!feats.length) return null;
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const px = (lon: number) => (lon - minLon) * k, py = (lat: number) => maxLat - lat;
    const W = Math.max((maxLon - minLon) * k, 1e-6), H = Math.max(maxLat - minLat, 1e-6), pad = Math.max(W, H) * 0.04;
    const items = feats.map((f) => ({ f, d: rings(f.geometry).map((r) => 'M' + r.map(([lon, lat]) => `${px(lon).toFixed(6)} ${py(lat).toFixed(6)}`).join('L') + 'Z').join('') }));
    const inv = { lon: (x: number) => x / k + minLon, lat: (y: number) => maxLat - y, px, py };
    return { items, inv, box: { x: -pad, y: -pad, w: W + 2 * pad, h: H + 2 * pad } };
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!geo) return <Card><p className="muted">Aucune parcelle géolocalisée pour le moment. Importez ou levez des polygones pour les voir ici.</p></Card>;

  const v = view ?? geo.box;
  const anomalies = geo.items.filter((i) => i.f.properties.anomaly).length;
  const shown = geo.items.filter((i) => !onlyAnom || i.f.properties.anomaly);
  const tiles = layer !== 'none' && online
    ? visibleTiles({ west: geo.inv.lon(v.x), east: geo.inv.lon(v.x + v.w), north: geo.inv.lat(v.y), south: geo.inv.lat(v.y + v.h) }, svg.current?.getBoundingClientRect().width || 900)
    : [];
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
          <select aria-label="Fond de carte" value={layer} onChange={(e) => pickLayer(e.target.value as BaseLayer)}>
            <option value="none">Fond neutre (hors ligne)</option><option value="plan">Plan (OpenStreetMap)</option><option value="satellite">Satellite</option>
          </select>
          <label><input type="checkbox" checked={onlyAnom} onChange={(e) => setOnlyAnom(e.target.checked)} /> Anomalies seulement</label>
          <span className="muted">
            <i style={{ background: COLOR.verified }} className="dot" /> Vérifiée <i style={{ background: COLOR.controlled }} className="dot" /> Contrôlée <i style={{ background: COLOR.declared }} className="dot" /> Déclarée <i style={{ background: '#d9382f' }} className="dot" /> Anomalie
          </span>
        </div>
        <div style={{ position: 'relative' }}>
        <svg ref={svg} role="img" aria-label="Carte des parcelles" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} style={{ width: '100%', height: 480, background: 'var(--map-bg, #eef3ec)', borderRadius: 8, touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
          {tiles.map((t) => {
            const x = geo.inv.px(t.west), y = geo.inv.py(t.north);
            return <image key={`${layer}/${t.z}/${t.x}/${t.y}`} href={tileUrl(layer as Exclude<BaseLayer, 'none'>, t)} x={x} y={y} width={geo.inv.px(t.east) - x} height={geo.inv.py(t.south) - y}
              preserveAspectRatio="none" style={{ pointerEvents: 'none' }} onError={(e) => { (e.target as SVGImageElement).style.display = 'none'; }} />;
          })}
          {shown.map(({ f, d }) => {
            const p = f.properties, bad = p.anomaly, chosen = p.id === sel;
            return <path key={p.id} d={d} fill={COLOR[p.validation_status] ?? COLOR.declared} fillOpacity={chosen ? 0.85 : 0.45} stroke={bad ? '#d9382f' : chosen ? '#111' : COLOR[p.validation_status] ?? '#666'}
              strokeWidth={bad || chosen ? 2.5 : 1} vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={`Parcelle ${p.code}`}
              onClick={(e) => { e.stopPropagation(); setSel(p.id); }} onKeyDown={(e) => { if (e.key === 'Enter') setSel(p.id); }}><title>{p.code}</title></path>;
          })}
        </svg>
        {/* Croix de visée au centre (quatre traits séparés, point au milieu) et coordonnées du point visé : la carte glisse sous la croix. */}
        <svg aria-hidden="true" width="56" height="56" viewBox="-28 -28 56 56" style={{ position: 'absolute', left: '50%', top: 240, marginLeft: -28, marginTop: -28, pointerEvents: 'none' }}>
          {[[-24, 0, -7, 0], [7, 0, 24, 0], [0, -24, 0, -7], [0, 7, 0, 24]].map(([x1, y1, x2, y2], i) => <g key={i}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth="6" /><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth="3" /></g>)}
          <circle r="3.2" fill="#fff" /><circle r="2" fill="#000" />
        </svg>
        <div role="status" aria-label="Coordonnées du point visé" style={{ position: 'absolute', right: 12, bottom: 8, textAlign: 'right', fontWeight: 800, fontSize: 16, lineHeight: 1.15, pointerEvents: 'none', color: '#000', textShadow: '-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff,0 0 4px #fff' }}>
          <div>{geo.inv.lat(v.y + v.h / 2).toFixed(6)}</div><div>{geo.inv.lon(v.x + v.w / 2).toFixed(6)}</div>
        </div>
        </div>
        <p className="muted" style={{ margin: '6px 0 0' }}>Molette ou boutons pour zoomer, glisser pour déplacer. {layer === 'none' ? 'Fond neutre : la carte fonctionne sans connexion.' : online ? ATTRIBUTION[layer] + '. Les images du fond ne se chargent que lorsque vous êtes connecté.' : 'Hors connexion : fond neutre affiché.'}</p>
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
