import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { useSession } from '../main';

interface Status {
  socket: 'offline' | 'connecting' | 'online';
  printing: boolean;
  lastConnectAt?: string;
  lastPrintAt?: string;
  organization: { organizationName?: string } | null;
  printers: { id: number; nickname: string; mykidsId: string; enabled: boolean; kind: string; host?: string; online: boolean; status?: string; checkedAt?: string }[];
  recentJobs: { ts: string; mykids_id: string; printer_name?: string; codigo: string; status: string; detail?: string; source?: string; duration_ms?: number }[];
}

const SOCKET_LABEL = { online: ['ok', 'Conectado ao MyKids'], connecting: ['warn', 'Conectando…'], offline: ['bad', 'Sem conexão com o MyKids'] } as const;

export function Dashboard() {
  const { user } = useSession();
  const [s, setS] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string }>();

  const load = () => api<Status>('/api/status').then(setS).catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const reconnect = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      await api('/api/reconnect', { method: 'POST' });
      await new Promise((r) => setTimeout(r, 1500));
      await load();
      setMsg({ type: 'success', text: 'Reconexão feita. Confira o status abaixo.' });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const [cls, label] = s ? SOCKET_LABEL[s.socket] : (['info', 'Carregando…'] as const);
  const names = new Map(s?.printers.map((p) => [p.mykidsId, p.nickname]));

  return (
    <>
      <section className="hero">
        <h1>Olá, {user?.name.split(' ')[0]}!</h1>
        <p>
          {s?.organization?.organizationName ?? 'Conta MyKids ainda não configurada'} · as etiquetas do check-in saem
          automaticamente nas impressoras abaixo.
        </p>
      </section>
      <main className="stack">
        <div className="card big-status">
          <span className={`pill ${cls}`} style={{ fontSize: 14, padding: '8px 16px' }}>
            {label}
          </span>
          {s?.printing && <span className="pill info">Imprimindo</span>}
          <span className="meta">Última conexão: {fmtDate(s?.lastConnectAt)} · Último pedido: {fmtDate(s?.lastPrintAt)}</span>
          <span className="spacer" />
          <button className="primary huge" onClick={reconnect} disabled={busy}>
            {busy ? 'Reconectando…' : '⟳ Reconectar'}
          </button>
        </div>
        {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

        <h2 className="section">Impressoras</h2>
        {s && s.printers.length === 0 && (
          <div className="alert info">Nenhuma impressora configurada. {user?.role === 'admin' ? 'Vá em "Impressoras" para incluir.' : 'Peça a um administrador.'}</div>
        )}
        <div className="grid">
          {s?.printers.map((p) => (
            <div className="card" key={p.id}>
              <div className="row">
                <h3>{p.nickname}</h3>
                <span className="spacer" />
                {!p.enabled ? (
                  <span className="pill warn">Desativada</span>
                ) : p.online ? (
                  <span className="pill ok">Online</span>
                ) : (
                  <span className="pill bad">Offline</span>
                )}
              </div>
              <div className="meta">
                MyKids #{p.mykidsId} · {p.kind === 'brother-ql' ? 'Brother QL' : p.kind === 'ipp' ? 'Impressora IPP' : 'Pré-visualização'}
                {p.host ? ` · ${p.host}` : ''}
              </div>
              {p.status && <div className="meta">Estado: {p.status}</div>}
            </div>
          ))}
        </div>

        <h2 className="section">Últimas impressões</h2>
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Impressora</th>
              <th>Código</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {s?.recentJobs.map((j, i) => (
              <tr key={i}>
                <td>{fmtDate(j.ts)}</td>
                <td>{j.printer_name ?? names.get(j.mykids_id) ?? `#${j.mykids_id}`}</td>
                <td>{j.codigo}</td>
                <td>{j.status === 'ok' ? <span className="pill ok">Impresso{j.source === 'teste' ? ' (teste)' : ''}</span> : <span className="pill bad" title={j.detail}>Erro: {j.detail}</span>}</td>
              </tr>
            ))}
            {s && s.recentJobs.length === 0 && (
              <tr>
                <td colSpan={4} className="meta">Nada impresso ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </>
  );
}
