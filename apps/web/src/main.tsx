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

function Shell({ children }: { children: ReactNode }) {
  const { user, refresh } = useSession();
  const logout = async () => {
    await api('/api/logout', { method: 'POST' });
    await refresh();
  };
  return (
    <>
      <header className="topbar">
        <Brand />
        <nav className="nav">
          <NavLink to="/" end>Painel</NavLink>
          {user?.role === 'admin' && (
            <>
              <NavLink to="/impressoras">Impressoras</NavLink>
              <NavLink to="/gileade">Conta MyKids</NavLink>
              <NavLink to="/usuarios">Usuários</NavLink>
              <NavLink to="/logs">Logs</NavLink>
            </>
          )}
        </nav>
        <div className="user">
          <span>
            {user?.name} · {user?.role === 'admin' ? 'Administrador' : 'Operador'}
          </span>
          <button onClick={logout}>Sair</button>
        </div>
      </header>
      {children}
    </>
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
