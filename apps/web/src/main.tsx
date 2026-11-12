import { StrictMode, createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, type User } from './api';
import { Dashboard } from './pages/Dashboard';
import { Printers } from './pages/Printers';
import { Gileade } from './pages/Gileade';
import { Users } from './pages/Users';
import { Logs } from './pages/Logs';
import { Login, Setup } from './pages/Auth';
import './styles.css';

interface Session {
  user: User | null;
  refresh: () => Promise<void>;
}
const SessionCtx = createContext<Session>({ user: null, refresh: async () => undefined });
export const useSession = () => useContext(SessionCtx);

export function Brand() {
  return (
    <a className="brand" href="/">
      <img src="/logo-incc.png" alt="INCC" />
      <small>MYKIDS PRINTER</small>
    </a>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  painel: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  impressoras: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  conta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  usuarios: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM1 21a8 8 0 0 1 16 0M17 3.5a4 4 0 0 1 0 7.5M23 21a8 8 0 0 0-5-7.4',
  logs: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
};

const ADMIN_LINKS = [
  { to: '/', label: 'Painel', short: 'Painel', icon: ICONS.painel, end: true },
  { to: '/impressoras', label: 'Impressoras', short: 'Impressoras', icon: ICONS.impressoras },
  { to: '/gileade', label: 'Conta MyKids', short: 'MyKids', icon: ICONS.conta },
  { to: '/usuarios', label: 'Usuários', short: 'Usuários', icon: ICONS.usuarios },
  { to: '/logs', label: 'Logs', short: 'Logs', icon: ICONS.logs },
];

function Shell({ children }: { children: ReactNode }) {
  const { user, refresh } = useSession();
  const [menu, setMenu] = useState(false);
  const admin = user?.role === 'admin';
  const roleLabel = admin ? 'Administrador' : 'Operador';
  const initials = (user?.name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  const logout = async () => {
    await api('/api/logout', { method: 'POST' });
    await refresh();
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  return (
    <div className={admin ? 'with-tabbar' : ''}>
      <header className="topbar">
        <Brand />
        {admin && (
          <nav className="nav">
            {ADMIN_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        )}
        <span className="spacer" />
        <div className="user-menu" onClick={(e) => e.stopPropagation()}>
          <div className="user-label">
            {user?.name}
            <br />
            <small>{roleLabel}</small>
          </div>
          <button className="avatar" aria-label="Menu do usuário" onClick={() => setMenu((m) => !m)}>
            {initials}
          </button>
          {menu && (
            <div className="user-pop">
              <strong>{user?.name}</strong>
              <div className="meta">
                {user?.username} · {roleLabel}
              </div>
              <button onClick={logout}>Sair</button>
            </div>
          )}
        </div>
      </header>
      {children}
      {admin && (
        <nav className="tabbar" aria-label="Navegação">
          {ADMIN_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              <Icon d={l.icon} />
              <span>{l.short}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = useState<{ loading: boolean; user: User | null; needsSetup: boolean }>({ loading: true, user: null, needsSetup: false });
  const refresh = async () => {
    const s = await api<{ user: User | null; needsSetup: boolean }>('/api/session');
    setState({ loading: false, ...s });
  };
  useEffect(() => {
    void refresh();
  }, []);

  if (state.loading) return null;
  if (state.needsSetup) return <Setup onDone={refresh} />;
  if (!state.user) return <Login onDone={refresh} />;
  const admin = state.user.role === 'admin';

  return (
    <SessionCtx.Provider value={{ user: state.user, refresh }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {admin && <Route path="/impressoras" element={<Printers />} />}
          {admin && <Route path="/gileade" element={<Gileade />} />}
          {admin && <Route path="/usuarios" element={<Users />} />}
          {admin && <Route path="/logs" element={<Logs />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </SessionCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
