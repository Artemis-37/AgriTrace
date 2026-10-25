/** Décor animé de l'accueil : plantation de cacaoyers au lever du jour (dessin vectoriel). Purement décoratif. */
const leafPath = 'M0,0 C10,-9 34,-9 46,0 C34,9 10,9 0,0Z';

function Canopy({ r = 1 }: { r?: number }) {
  const angles = [-150, -118, -90, -62, -30, -170, -10, 15, -135, -45];
  return (
    <g transform={`scale(${r})`}>
      {angles.map((a, i) => (
        <g key={i} transform={`translate(${Math.cos((a * Math.PI) / 180) * 8} ${-52 + Math.sin((a * Math.PI) / 180) * 8}) rotate(${a}) scale(${1.15 + (i % 3) * 0.18})`}>
          <path d={leafPath} fill={i % 2 ? 'url(#hs-leaf-a)' : 'url(#hs-leaf-b)'} />
          <path d="M0,0 L44,0" className="hs-vein" />
        </g>
      ))}
    </g>
  );
}

function Pod({ x, y, r = 0 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <path d="M0,-9 C6,-7 7,5 0,11 C-7,5 -6,-7 0,-9Z" fill="url(#hs-pod)" />
      <path d="M0,-8 L0,10 M-3,-5 C-3,2 -2,6 0,9 M3,-5 C3,2 2,6 0,9" className="hs-ridge" />
    </g>
  );
}

function Tree({ x, y, s, d }: { x: number; y: number; s: number; d: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="2" rx="40" ry="6" className="hs-shadow" />
      <path d="M-5,0 C-4,-18 -3,-34 -2,-50 L3,-50 C4,-34 5,-18 6,0Z" fill="url(#hs-trunk)" />
      <Pod x={-7} y={-22} r={12} /><Pod x={9} y={-30} r={-14} /><Pod x={-5} y={-38} r={8} />
      <g className="hs-sway" style={{ animationDelay: `${d}s` }}><Canopy /></g>
    </g>
  );
}

function Plantain({ x, y, s, flip, d }: { x: number; y: number; s: number; flip?: boolean; d: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <g className="hs-sway2" style={{ animationDelay: `${d}s` }}>
        {[-78, -58, -38, -18].map((a, i) => (
          <g key={a} transform={`rotate(${a})`}>
            <path d={`M0,0 C60,${-22 - i * 2} 170,${-24} ${200 + i * 20},${6 + i * 6} C150,${22} 60,${16} 0,0Z`} fill={i % 2 ? 'url(#hs-leaf-a)' : 'url(#hs-leaf-b)'} />
            <path d={`M0,0 C70,-4 150,0 ${196 + i * 20},${6 + i * 6}`} className="hs-vein" />
          </g>
        ))}
      </g>
    </g>
  );
}

const SPROUTS = Array.from({ length: 26 }, (_, i) => ({ x: 40 + i * 56 + (i % 3) * 9, y: 440 + ((i * 37) % 4) * 12, s: 0.7 + ((i * 13) % 6) / 10, d: (i * 0.53) % 4 }));

export default function HomeScene() {
  return (
    <div className="home-scene" aria-hidden="true">
      <svg viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice">
        <defs>
          <radialGradient id="hs-halo"><stop offset="0" stopColor="#F6DD9A" stopOpacity=".95" /><stop offset="1" stopColor="#F6DD9A" stopOpacity="0" /></radialGradient>
          <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F4E7C4" stopOpacity="0" /><stop offset=".7" stopColor="#F4E1B0" stopOpacity=".55" /><stop offset="1" stopColor="#F2E9CF" stopOpacity=".2" /></linearGradient>
          <linearGradient id="hs-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="hs-st-far1" /><stop offset="1" className="hs-st-far2" /></linearGradient>
          <linearGradient id="hs-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="hs-st-mid1" /><stop offset="1" className="hs-st-mid2" /></linearGradient>
          <linearGradient id="hs-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="hs-st-near1" /><stop offset="1" className="hs-st-near2" /></linearGradient>
          <linearGradient id="hs-trunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" className="hs-st-trunk1" /><stop offset="1" className="hs-st-trunk2" /></linearGradient>
          <linearGradient id="hs-leaf-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="hs-st-leaf1" /><stop offset="1" className="hs-st-leaf2" /></linearGradient>
          <linearGradient id="hs-leaf-b" x1="0" y1="1" x2="1" y2="0"><stop offset="0" className="hs-st-leaf3" /><stop offset="1" className="hs-st-leaf1" /></linearGradient>
          <linearGradient id="hs-pod" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E9C25A" /><stop offset=".6" stopColor="#D79A3A" /><stop offset="1" stopColor="#B9742A" /></linearGradient>
          <path id="hs-sprout" d="M0,0 C-1,-10 -1,-18 0,-26 M0,-12 C-10,-14 -17,-20 -19,-30 C-9,-28 -3,-22 0,-12 M0,-17 C10,-19 17,-25 19,-35 C9,-33 3,-27 0,-17" />
        </defs>
        <rect x="0" y="0" width="1440" height="520" fill="url(#hs-sky)" />
        <g className="hs-sun">
          <circle cx="1170" cy="170" r="150" fill="url(#hs-halo)" className="hs-halo" />
          <g className="hs-rays">{Array.from({ length: 12 }, (_, i) => <path key={i} d="M1170,170 L1182,60 L1158,60Z" transform={`rotate(${i * 30} 1170 170)`} />)}</g>
          <circle cx="1170" cy="170" r="32" className="hs-disc" />
        </g>
        <g className="hs-cloud hs-c1"><ellipse cx="260" cy="110" rx="95" ry="20" /><ellipse cx="320" cy="96" rx="58" ry="23" /><ellipse cx="215" cy="100" rx="45" ry="15" /></g>
        <g className="hs-cloud hs-c2"><ellipse cx="760" cy="170" rx="72" ry="15" /><ellipse cx="806" cy="160" rx="42" ry="16" /></g>
        <g className="hs-birds"><path d="M0,0 q8,-8 16,0 q8,-8 16,0" /><path d="M44,-12 q6,-6 12,0 q6,-6 12,0" /><path d="M-30,-16 q5,-5 10,0 q5,-5 10,0" /></g>
        <path fill="url(#hs-far)" d="M0,290 C180,235 340,275 560,250 C800,224 1010,280 1230,246 C1330,232 1400,250 1440,244 L1440,520 L0,520Z" />
        <path fill="url(#hs-mid)" d="M0,340 C240,296 470,342 740,320 C1010,300 1220,342 1440,314 L1440,520 L0,520Z" />
        {[[190, 440, 1.2, 0], [520, 436, 1.35, 1.2], [880, 432, 1.25, 0.6], [1200, 428, 1.4, 1.9]].map(([x, y, s, d], i) => <Tree key={i} x={x} y={y} s={s} d={d} />)}
        <path fill="url(#hs-near)" d="M0,400 C300,378 620,406 920,392 C1160,380 1310,398 1440,388 L1440,520 L0,520Z" />
        {[0, 1, 2, 3, 4].map(r => <path key={r} className="hs-row" d={`M0,${452 + r * 16} C360,${440 + r * 16} 1000,${470 + r * 16} 1440,${448 + r * 16}`} />)}
        {SPROUTS.map((p, i) => <g key={i} transform={`translate(${p.x} ${p.y + 22}) scale(${p.s})`}><use href="#hs-sprout" className="hs-plant" style={{ animationDelay: `${p.d}s` }} /></g>)}
        <Plantain x={-10} y={540} s={1} d={0.4} />
        <Plantain x={1450} y={540} s={1.05} flip d={1.4} />
      </svg>
    </div>
  );
}
