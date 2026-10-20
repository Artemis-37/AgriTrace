import { useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Dashboard from './pages/Dashboard';
import Cartographie from './pages/Cartographie';
import Declarations from './pages/Declarations';
import Finance from './pages/Finance';
import Login from './pages/Login';
import Missions from './pages/Missions';
import Parcels from './pages/Parcels';
import Producers from './pages/Producers';
import Quality from './pages/Quality';
import Stocks from './pages/Stocks';
import { Loading } from './ui';

const NAV: { to: string; label: string; icon: string; perm: string[] }[] = [
  { to: '/', label: 'Tableau de bord', icon: '▦', perm: [] },
  { to: '/producteurs', label: 'Producteurs', icon: '☺', perm: ['producers:read'] },
  { to: '/parcelles', label: 'Parcelles', icon: '◩', perm: ['parcels:read'] },
  { to: '/cartographie', label: 'Cartographie', icon: '⌖', perm: ['geo:anomalies'] },
  { to: '/declarations', label: 'Déclarations d\'achat', icon: '✎', perm: ['declarations:read'] },
  { to: '/missions', label: 'Missions', icon: '⚑', perm: ['tasks:read'] },
  { to: '/stocks', label: 'Stocks et lots', icon: '▤', perm: ['warehouses:read'] },
  { to: '/finances', label: 'Finances', icon: '₣', perm: ['finance:read'] },
  { to: '/qualite', label: 'Qualité et conformité', icon: '✔', perm: ['inspections:read'] },
];

export default function App() {
  const { status, org, me, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (status === 'loading') return <div style={{ padding: '3rem' }}><Loading /></div>;
  if (status !== 'ready') return <Login />;

  return (
    <div className="shell">
      <div className="topbar-mobile">
        <button className="btn btn-ghost" aria-label="Ouvrir le menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        <strong>AgriTrace</strong>
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><strong>Agri<span>Trace</span></strong><small>La traçabilité agricole, de la parcelle au marché.</small></div>
        <nav className="nav" aria-label="Navigation principale" onClick={() => setOpen(false)}>
          {NAV.filter((n) => can(...n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}><span aria-hidden="true">{n.icon}</span>{n.label}</NavLink>
          ))}
        </nav>
        <div className="who">
          <strong>{org?.name}</strong><br />{me?.user.full_name}
          <div><button className="btn btn-ghost btn-small" onClick={signOut}>Se déconnecter</button></div>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/producteurs" element={<Producers />} />
          <Route path="/parcelles" element={<Parcels />} />
          <Route path="/cartographie" element={<Cartographie />} />
          <Route path="/declarations" element={<Declarations />} />
          <Route path="/missions" element={<Missions />} />
          <Route path="/stocks" element={<Stocks />} />
          <Route path="/finances" element={<Finance />} />
          <Route path="/qualite" element={<Quality />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
