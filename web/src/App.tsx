import { useCallback, useEffect, useState } from 'react';
import { get } from './api';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Dashboard from './pages/Dashboard';
import Inventaire from './pages/Inventaire';
import Prefinancement from './pages/Prefinancement';
import Notifications from './pages/Notifications';
import Equipe from './pages/Equipe';
import Rapports from './pages/Rapports';
import Commerce from './pages/Commerce';
import Cartographie from './pages/Cartographie';
import Declarations from './pages/Declarations';
import Finance from './pages/Finance';
import Login from './pages/Login';
import { Historique, MesAchats, MonStock } from './pages/EspaceCollecteur';
import Convois from './pages/Convois';
import Bell, { MessageButton } from './Bell';
import ConnectionStatus from './ConnectionStatus';
import PairWorkstation from './PairWorkstation';
import Messages from './pages/Messages';
import OfflineBar from './OfflineBar';
import Synchronisation from './pages/Synchronisation';
import CentralConsole from './pages/CentralConsole';
import Missions from './pages/Missions';
import Parcels from './pages/Parcels';
import Producers from './pages/Producers';
import Quality from './pages/Quality';
import Stocks from './pages/Stocks';
import { Loading } from './ui';

const THEMES: [string, string][] = [['doux', 'Thème doux'], ['night', 'Thème nuit']];
const readTheme = () => { try { return localStorage.getItem('agritrace.theme') ?? ''; } catch { return ''; } };

const NAV: { to: string; label: string; icon: string; perm: string[]; any?: boolean; only?: 'collector'; notFor?: 'collector' }[] = [
  { to: '/', label: 'Tableau de bord', icon: '▦', perm: [] },
  { to: '/mes-achats', label: 'Mes achats', icon: '✚', perm: ['declarations:create'], only: 'collector' },
  { to: '/mon-stock', label: 'Mon stock', icon: '▤', perm: ['collector:stock'], only: 'collector' },
  { to: '/historique', label: 'Historique', icon: '↺', perm: ['declarations:read'], only: 'collector' },
  { to: '/producteurs', label: 'Producteurs', icon: '☺', perm: ['producers:read'] },
  { to: '/parcelles', label: 'Parcelles', icon: '◩', perm: ['parcels:read'] },
  { to: '/cartographie', label: 'Cartographie', icon: '⌖', perm: ['geo:anomalies'] },
  { to: '/commerce', label: 'Commerce', icon: '⇄', perm: ['buyers:read', 'logistics:read', 'invoices:read'], any: true },
  { to: '/convois', label: 'Convois', icon: '⛟', perm: ['convoys:read', 'convoys:receive', 'convoys:settle'], any: true },
  { to: '/inventaire', label: 'Inventaire', icon: '☰', perm: ['stock:count'] },
  { to: '/prefinancement', label: 'Préfinancement', icon: '◈', perm: ['prefinancing:read'] },
  { to: '/messages', label: 'Messages', icon: '✉', perm: ['messages:use'] },
  { to: '/synchronisation', label: 'Synchronisation', icon: '⇅', perm: ['replication:manage'] },
  { to: '/equipe', label: 'Équipe', icon: '⚙', perm: ['users:read'] },
  { to: '/declarations', label: 'Déclarations d\'achat', icon: '✎', perm: ['declarations:read'], notFor: 'collector' },
  { to: '/missions', label: 'Missions', icon: '⚑', perm: ['tasks:read'] },
  { to: '/stocks', label: 'Stocks et lots', icon: '▤', perm: ['warehouses:read'] },
  { to: '/rapports', label: 'Rapports', icon: '▥', perm: ['reports:read'] },
  { to: '/finances', label: 'Finances', icon: '₣', perm: ['finance:read'] },
  { to: '/qualite', label: 'Qualité et conformité', icon: '✔', perm: ['inspections:read'] },
];

export default function App() {
  const { status, org, me, can, signOut } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme() || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'doux'));
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('agritrace.theme', theme); } catch { /* ignoré */ } }, [theme]);
  const [unread, setUnread] = useState(0);
  const [needPair, setNeedPair] = useState(false);
  useEffect(() => { const f = () => setNeedPair(true); window.addEventListener('agritrace:workstation-required', f); return () => window.removeEventListener('agritrace:workstation-required', f); }, []);
  const [managed, setManaged] = useState<string | null>(null);
  useEffect(() => {
    if (status !== 'ready') return;
    get<any>('/replication/status').then((r) => setManaged(r.mode === 'central' && r.site ? r.site.name : null)).catch(() => setManaged(null));
  }, [status, org?.id]);
  const [msgUnread, setMsgUnread] = useState(0);
  const refreshUnread = useCallback(() => {
    get<{ unread: number }>('/notifications/unread-count').then((r) => setUnread(r.unread)).catch(() => undefined);
    if (can('messages:use')) get<{ unread: number }>('/messages/unread-count').then((r) => setMsgUnread(r.unread)).catch(() => undefined);
  }, [can]);
  useEffect(() => { if (status !== 'ready') return; refreshUnread(); const t = setInterval(refreshUnread, 15000); return () => clearInterval(t); }, [status, org?.id, refreshUnread]);
  if (needPair) return <PairWorkstation blocking onDone={() => window.location.reload()} />;
  if (status === 'loading') return <div style={{ padding: '3rem' }}><Loading /></div>;
  if (status === 'platform') return <CentralConsole />;
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
          {NAV.filter((n) => (n.any ? n.perm.some((p) => can(p)) : can(...n.perm)) && (!n.only || me?.account_kind === n.only) && (!n.notFor || me?.account_kind !== n.notFor)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}><span aria-hidden="true">{n.icon}</span>{n.label}{n.to === '/messages' && msgUnread > 0 && <span className="badge badge-bad" style={{ marginLeft: 'auto' }} aria-label={`${msgUnread} message(s) non lu(s)`}>{msgUnread}</span>}</NavLink>
          ))}
          <NavLink to="/notifications"><span aria-hidden="true">🔔</span>Notifications{unread > 0 && <span className="badge badge-bad" style={{ marginLeft: 'auto' }} aria-label={`${unread} non lue(s)`}>{unread}</span>}</NavLink>
        </nav>
        <div className="who">
          <strong>{org?.name}</strong><br />{me?.user.full_name}
          <div><button className="btn btn-ghost btn-small" onClick={() => setTheme(theme === 'night' ? 'doux' : 'night')} aria-label="Changer de thème d'affichage">{THEMES.find(([k]) => k !== theme)?.[1]}</button>{' '}<button className="btn btn-ghost btn-small" onClick={signOut}>Se déconnecter</button></div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><ConnectionStatus />{can('messages:use') && <MessageButton unread={msgUnread} />}<Bell unread={unread} onChange={refreshUnread} /></div>
        <OfflineBar />
        {managed && <p className="notice" role="status">Lecture seule : cette coopérative est gérée par son serveur local (« {managed} »). Les modifications se font là-bas ; elles arrivent ici par synchronisation.</p>}
        {me?.mobile_first && <p className="notice" role="status">Votre compte ({me.account_kind === 'collector' ? 'collecteur' : 'coach'}) est conçu pour l'application mobile, qui fonctionne aussi dans les villages sans réseau. Ce portail affiche uniquement ce qui vous concerne.</p>}
        <Routes key={loc.key}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/producteurs" element={<Producers />} />
          <Route path="/parcelles" element={<Parcels />} />
          <Route path="/cartographie" element={<Cartographie />} />
          <Route path="/commerce" element={<Commerce />} />
          <Route path="/mes-achats" element={<MesAchats />} />
          <Route path="/mon-stock" element={<MonStock />} />
          <Route path="/historique" element={<Historique />} />
          <Route path="/convois" element={<Convois />} />
          <Route path="/inventaire" element={<Inventaire />} />
          <Route path="/prefinancement" element={<Prefinancement />} />
          <Route path="/messages" element={<Messages onChange={refreshUnread} />} />
          <Route path="/synchronisation" element={<Synchronisation />} />
          <Route path="/equipe" element={<Equipe />} />
          <Route path="/rapports" element={<Rapports />} />
          <Route path="/notifications" element={<Notifications onChange={refreshUnread} />} />
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
