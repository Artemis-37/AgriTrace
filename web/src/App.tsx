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
import Pesees from './pages/Pesees';
import MiseEnCompte from './pages/MiseEnCompte';
import Delegues from './pages/Delegues';
import Parametres from './pages/Parametres';
import Partenaires from './pages/Partenaires';
import Caisse from './pages/Caisse';
import Comptabilite from './pages/Comptabilite';
import Bell, { MessageButton } from './Bell';
import ConnectionStatus from './ConnectionStatus';
import PairWorkstation from './PairWorkstation';
import Messages from './pages/Messages';
import OfflineBar from './OfflineBar';
import Synchronisation from './pages/Synchronisation';
import CentralConsole from './pages/CentralConsole';
import Missions from './pages/Missions';
import Terrain from './pages/Terrain';
import ModulesFormation from './pages/ModulesFormation';
import ModulesExportateurs from './pages/ModulesExportateurs';
import Operations from './pages/Operations';
import Compte, { ForcedPasswordChange, ForcedTwoFactor } from './pages/Compte';
import Parcels from './pages/Parcels';
import Producers from './pages/Producers';
import Quality from './pages/Quality';
import Stocks from './pages/Stocks';
import { Loading } from './ui';
import { MenuBar } from './MenuBar';
import { PeekProvider } from './peek';


const NAV: { to: string; label: string; icon: string; perm: string[]; any?: boolean; only?: 'collector'; notFor?: 'collector' }[] = [
  { to: '/', label: 'Tableau de bord', icon: '▦', perm: [] },
  { to: '/mes-achats', label: 'Mes achats', icon: '✚', perm: ['declarations:create'], only: 'collector' },
  { to: '/mon-stock', label: 'Mon stock', icon: '▤', perm: ['collector:stock'], only: 'collector' },
  { to: '/historique', label: 'Historique', icon: '↺', perm: ['declarations:read'], only: 'collector' },
  { to: '/producteurs', label: 'Producteurs', icon: '☺', perm: ['producers:read'] },
  { to: '/parcelles', label: 'Parcelles', icon: '◩', perm: ['parcels:read'] },
  { to: '/cartographie', label: 'Cartographie', icon: '⌖', perm: ['geo:anomalies'] },
  { to: '/commerce', label: 'Commerce', icon: '⇄', perm: ['buyers:read', 'logistics:read', 'invoices:read'], any: true },
  { to: '/partenaires', label: 'Partenaires', icon: '🤝', perm: ['partners:read'] },
  { to: '/parametres', label: 'Produits et campagnes', icon: '🌾', perm: ['products:read', 'campaigns:read'], any: true },
  { to: '/delegues', label: 'Délégués', icon: '☻', perm: ['collectors:read'] },
  { to: '/pesees', label: 'Pesées', icon: '⚖', perm: ['convoys:read', 'convoys:receive'], any: true, notFor: 'collector' },
  { to: '/caisse', label: 'Caisse', icon: '₵', perm: ['convoys:settle', 'finance:read'], any: true },
  { to: '/mise-en-compte', label: 'Mise en compte des délégués', icon: '◔', perm: ['savings:read'] },
  { to: '/comptabilite', label: 'Comptabilité', icon: '🧮', perm: ['accounting:read'] },
  { to: '/convois', label: 'Convois', icon: '⛟', perm: ['convoys:read', 'convoys:receive', 'convoys:settle'], any: true },
  { to: '/inventaire', label: 'Inventaire', icon: '☰', perm: ['stock:count'] },
  { to: '/prefinancement', label: 'Préfinancement', icon: '◈', perm: ['prefinancing:read'] },
  { to: '/synchronisation', label: 'Synchronisation', icon: '⇅', perm: ['replication:manage'] },
  { to: '/equipe', label: 'Équipe', icon: '⚙', perm: ['users:read'] },
  { to: '/declarations', label: 'Déclarations d\'achat', icon: '✎', perm: ['declarations:read'], notFor: 'collector' },
  { to: '/missions', label: 'Missions', icon: '⚑', perm: ['tasks:read'] },
  { to: '/operations', label: 'Mes opérations', icon: '🧾', perm: ['cancellations:request'] },
  { to: '/terrain', label: 'Données de terrain', icon: '❖', perm: ['field_records:read', 'field_records:manage', 'field_templates:manage'], any: true },
  { to: '/modules-formation', label: 'Modules de formation', icon: '🎓', perm: ['training:read'] },
  { to: '/modules-exportateurs', label: 'Modules des exportateurs', icon: '🚢', perm: ['training:forward', 'training:propose'], any: true },
  { to: '/stocks', label: 'Stocks et lots', icon: '▤', perm: ['warehouses:read'] },
  { to: '/rapports', label: 'Rapports', icon: '▥', perm: ['reports:read'] },
  { to: '/finances', label: 'Finances', icon: '₣', perm: ['finance:read'] },
  { to: '/qualite', label: 'Qualité et conformité', icon: '✔', perm: ['inspections:read'] },
];

export default function App() {
  const { status, org, me, can, signOut } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = 'doux'; }, []); // un seul thème
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
  if (me?.must_change_password) return <ForcedPasswordChange />;
  if (me?.must_setup_2fa) return <ForcedTwoFactor />;

  return (
    <PeekProvider origin={NAV.find((n) => n.to === loc.pathname)?.label ?? 'Accueil'} resetKey={loc.pathname}>
    <div className="shell desk">
      <header className="titlebar">
        <button className="btn btn-ghost menu-toggle" aria-label="Ouvrir le menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        <div className="brand"><strong>Agri<span>Trace</span></strong></div>
        <span className="coop">{org?.name}</span>
        <div className="title-right">
          <ConnectionStatus />{can('messages:use') && <MessageButton unread={msgUnread} />}<Bell unread={unread} onChange={refreshUnread} />
          <span className="who-inline">{me?.user.full_name} · <NavLink to="/compte">Mon compte</NavLink></span>
          <button className="btn btn-ghost btn-small" onClick={signOut}>Se déconnecter</button>
          <span className="today-date">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </header>
      <MenuBar open={open} onNavigate={() => setOpen(false)}
        items={NAV.filter((n) => (n.any ? n.perm.some((p) => can(p)) : can(...n.perm)) && (!n.only || me?.account_kind === n.only) && (!n.notFor || me?.account_kind !== n.notFor)).map(({ to, label, icon }) => ({ to, label, icon }))} />
      <main className="main">
        <OfflineBar />
        {managed && <p className="notice" role="status">Lecture seule : cette coopérative est gérée par son serveur local (« {managed} »). Les modifications se font là-bas ; elles arrivent ici par synchronisation.</p>}
        {me?.mobile_first && <p className="notice" role="status">Votre compte ({me.account_kind === 'collector' ? 'délégué' : 'coach'}) est conçu pour l'application mobile, qui fonctionne aussi dans les villages sans réseau. Ce portail affiche uniquement ce qui vous concerne.</p>}
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
          <Route path="/pesees" element={<Pesees />} />
          <Route path="/mise-en-compte" element={<MiseEnCompte />} />
          <Route path="/delegues" element={<Delegues />} />
          <Route path="/parametres" element={<Parametres />} />
          <Route path="/partenaires" element={<Partenaires />} />
          <Route path="/caisse" element={<Caisse />} />
          <Route path="/comptabilite" element={<Comptabilite />} />
          <Route path="/inventaire" element={<Inventaire />} />
          <Route path="/prefinancement" element={<Prefinancement />} />
          <Route path="/messages" element={<Messages onChange={refreshUnread} />} />
          <Route path="/synchronisation" element={<Synchronisation />} />
          <Route path="/equipe" element={<Equipe />} />
          <Route path="/rapports" element={<Rapports />} />
          <Route path="/notifications" element={<Notifications onChange={refreshUnread} />} />
          <Route path="/declarations" element={<Declarations />} />
          <Route path="/missions" element={<Missions />} />
          <Route path="/terrain" element={<Terrain />} />
          <Route path="/operations" element={<Operations />} />
          <Route path="/compte" element={<Compte />} />
          <Route path="/modules-formation" element={<ModulesFormation />} />
          <Route path="/modules-exportateurs" element={<ModulesExportateurs />} />
          <Route path="/stocks" element={<Stocks />} />
          <Route path="/finances" element={<Finance />} />
          <Route path="/qualite" element={<Quality />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
    </PeekProvider>
  );
}
