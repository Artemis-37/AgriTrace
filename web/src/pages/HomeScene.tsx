/** Décor animé de l'accueil : champs de cacaoyers et jeunes plants au lever du jour. Purement décoratif. */
const SPROUTS = Array.from({ length: 22 }, (_, i) => ({
  x: 60 + i * 66 + (i % 3) * 9,
  y: 318 + ((i * 37) % 5) * 14,
  s: 0.7 + ((i * 13) % 6) / 10,
  d: (i * 0.53) % 4,
}));

function Tree({ x, y, s, d }: { x: number; y: number; s: number; d: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-3" y="-34" width="6" height="34" rx="3" className="hs-trunk" />
      <g className="hs-sway" style={{ animationDelay: `${d}s` }}>
        <ellipse cx="0" cy="-52" rx="30" ry="24" className="hs-canopy" />
        <ellipse cx="-17" cy="-40" rx="17" ry="13" className="hs-canopy2" />
        <ellipse cx="18" cy="-42" rx="16" ry="12" className="hs-canopy2" />
        <ellipse cx="-6" cy="-36" rx="4" ry="6.5" className="hs-pod" />
        <ellipse cx="12" cy="-33" rx="3.6" ry="6" className="hs-pod" />
      </g>
    </g>
  );
}

export default function HomeScene() {
  return (
    <div className="home-scene" aria-hidden="true">
      <svg viewBox="0 0 1440 420" preserveAspectRatio="xMidYMax slice">
        <defs>
          <radialGradient id="hs-halo">
            <stop offset="0" stopColor="#F2D58A" stopOpacity=".9" />
            <stop offset="1" stopColor="#F2D58A" stopOpacity="0" />
          </radialGradient>
          <path id="hs-sprout" d="M0,0 C-1,-10 -1,-18 0,-26 M0,-12 C-10,-14 -17,-20 -19,-30 C-9,-28 -3,-22 0,-12 M0,-17 C10,-19 17,-25 19,-35 C9,-33 3,-27 0,-17" />
        </defs>
        <g className="hs-sun">
          <circle cx="1180" cy="170" r="110" fill="url(#hs-halo)" className="hs-halo" />
          <circle cx="1180" cy="170" r="32" className="hs-disc" />
        </g>
        <g className="hs-cloud hs-c1"><ellipse cx="260" cy="90" rx="90" ry="20" /><ellipse cx="320" cy="78" rx="55" ry="22" /></g>
        <g className="hs-cloud hs-c2"><ellipse cx="760" cy="140" rx="70" ry="15" /><ellipse cx="805" cy="130" rx="40" ry="16" /></g>
        <path className="hs-hill1" d="M0,250 C200,200 380,230 600,215 C860,198 1100,235 1440,205 L1440,420 L0,420Z" />
        <path className="hs-hill2" d="M0,300 C260,262 480,300 760,280 C1030,262 1220,300 1440,274 L1440,420 L0,420Z" />
        {[ [180, 292, 0.9, 0], [470, 288, 1.1, 1.2], [860, 284, 1, 0.6], [1250, 278, 1.15, 1.9] ].map(([x, y, s, d], i) => (
          <Tree key={i} x={x} y={y} s={s} d={d} />
        ))}
        <path className="hs-field" d="M0,330 C300,308 600,336 900,322 C1150,311 1300,330 1440,318 L1440,420 L0,420Z" />
        {[0, 1, 2, 3].map(r => (
          <path key={r} className="hs-row" d={`M0,${352 + r * 18} C360,${338 + r * 18} 1000,${368 + r * 18} 1440,${348 + r * 18}`} />
        ))}
        {SPROUTS.map((p, i) => (
          <g key={i} transform={`translate(${p.x} ${p.y + 40}) scale(${p.s})`}>
            <use href="#hs-sprout" className="hs-plant" style={{ animationDelay: `${p.d}s` }} />
          </g>
        ))}
      </svg>
    </div>
  );
}
