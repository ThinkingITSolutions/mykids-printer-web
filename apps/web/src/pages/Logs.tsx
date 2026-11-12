import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '../api';

type Tab = 'impressao' | 'sistema' | 'auditoria';

interface Job {
  id: number;
  ts: string;
  mykids_id: string;
  printer_name?: string;
  codigo: string;
  status: 'ok' | 'erro';
  detail?: string;
  labels?: number;
  duration_ms?: number;
  source?: string;
}
interface Totals {
  jobs: number;
  labels: number;
  errors: number;
  avg_ms: number | null;
}
interface LogRow {
  id: number;
  ts: string;
  level: 'info' | 'warn' | 'error';
  category: Tab;
  actor?: string;
  msg: string;
}

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'impressao', label: 'Impressões', hint: 'Cada etiqueta enviada: impressora, código, tempo e resultado.' },
  { id: 'sistema', label: 'Sistema', hint: 'Conexão com o MyKids, impressoras e erros do servidor.' },
  { id: 'auditoria', label: 'Auditoria', hint: 'Quem fez o quê no painel: logins, reconexões e alterações.' },
];

const LEVEL_PILL = { info: ['info', 'Info'], warn: ['warn', 'Atenção'], error: ['bad', 'Erro'] } as const;

const fmtRange = (a: string, b: string) => {
  const f = (d: string) => (d ? d.split('-').reverse().slice(0, 2).join('/') : '…');
  return `${f(a)} a ${f(b)}`;
};
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE');

export function Logs() {
  const [tab, setTab] = useState<Tab>('impressao');
  const [filters, setFilters] = useState({ from: daysAgo(7), to: today(), q: '', status: '', source: '', level: '' });
  const [jobs, setJobs] = useState<{ rows: Job[]; totals: Totals }>();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [live, setLive] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    if (filters.q) p.set('q', filters.q);
    if (tab === 'impressao') {
      if (filters.status) p.set('status', filters.status);
      if (filters.source) p.set('source', filters.source);
    } else {
      p.set('category', tab);
      if (filters.level) p.set('level', filters.level);
    }
    return p.toString();
  }, [filters, tab]);

  const load = useCallback(async () => {
    if (tab === 'impressao') setJobs(await api(`/api/jobs?${params()}`));
    else setLogs(await api(`/api/logs?${params()}`));
  }, [tab, params]);

  useEffect(() => {
    void load();
    if (!live) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, live]);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const exportCsv = () => window.open(`/api/${tab === 'impressao' ? 'jobs' : 'logs'}.csv?${params()}`, '_blank');
  const t = jobs?.totals;
  const current = TABS.find((x) => x.id === tab)!;

  return (
    <>
      <section className="hero">
        <h1>Logs</h1>
        <p>{current.hint} Nomes de crianças e senhas nunca são registrados. Guardamos 90 dias.</p>
      </section>
      <main className="stack">
        <div className="tabs">
          {TABS.map((x) => (
            <button key={x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>

        <button className="filters-toggle" onClick={() => setShowFilters((v) => !v)}>
          <span>Filtros · {fmtRange(filters.from, filters.to)}</span>
          <span>{showFilters ? '▲' : '▼'}</span>
        </button>
        <div className={`card filters ${showFilters ? '' : 'collapsed'}`}>
          <div>
            <label>De</label>
            <input type="date" value={filters.from} onChange={set('from')} />
          </div>
          <div>
            <label>Até</label>
            <input type="date" value={filters.to} onChange={set('to')} />
          </div>
          {tab === 'impressao' ? (
            <>
              <div>
                <label>Resultado</label>
                <select value={filters.status} onChange={set('status')}>
                  <option value="">Todos</option>
                  <option value="ok">Impressos</option>
                  <option value="erro">Com erro</option>
                </select>
              </div>
              <div>
                <label>Origem</label>
                <select value={filters.source} onChange={set('source')}>
                  <option value="">Todas</option>
                  <option value="checkin">Check-in</option>
                  <option value="teste">Teste</option>
                </select>
              </div>
            </>
          ) : (
            <div>
              <label>Nível</label>
              <select value={filters.level} onChange={set('level')}>
                <option value="">Todos</option>
                <option value="info">Info</option>
                <option value="warn">Atenção</option>
                <option value="error">Erro</option>
              </select>
            </div>
          )}
          <div className="full">
            <label>Buscar</label>
            <input value={filters.q} onChange={set('q')} placeholder={tab === 'impressao' ? 'código, impressora ou erro' : 'texto ou usuário'} />
          </div>
          <div className="filter-actions">
            <label className="check">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Atualizar ao vivo
            </label>
            <button onClick={exportCsv}>⭳ Exportar CSV</button>
          </div>
        </div>

        {tab === 'impressao' && t && (
          <div className="kpis">
            <div className="kpi">
              <span>{t.jobs}</span>
              <small>impressões</small>
            </div>
            <div className="kpi">
              <span>{t.labels}</span>
              <small>etiquetas</small>
            </div>
            <div className={`kpi ${t.errors ? 'bad' : ''}`}>
              <span>{t.errors ?? 0}</span>
              <small>com erro</small>
            </div>
            <div className="kpi">
              <span>{t.avg_ms != null ? `${(t.avg_ms / 1000).toFixed(1)} s` : '—'}</span>
              <small>tempo médio</small>
            </div>
          </div>
        )}

        {tab === 'impressao' ? (
          <table className="responsive">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Impressora</th>
                <th>Código(s)</th>
                <th>Etiquetas</th>
                <th>Tempo</th>
                <th>Origem</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {jobs?.rows.map((j) => (
                <tr key={j.id}>
                  <td data-label="Quando">{fmtDate(j.ts)}</td>
                  <td data-label="Impressora">
                    <div>
                      {j.printer_name ?? '—'}
                      <div className="meta">MyKids #{j.mykids_id}</div>
                    </div>
                  </td>
                  <td data-label="Código(s)">{j.codigo}</td>
                  <td data-label="Etiquetas">{j.labels ?? '—'}</td>
                  <td data-label="Tempo">{j.duration_ms != null ? `${(j.duration_ms / 1000).toFixed(1)} s` : '—'}</td>
                  <td data-label="Origem">{j.source === 'teste' ? 'Teste' : j.source === 'checkin' ? 'Check-in' : '—'}</td>
                  <td data-label="Resultado">
                    <div>
                      {j.status === 'ok' ? <span className="pill ok">Impresso</span> : <span className="pill bad">Erro</span>}
                      {j.status === 'erro' && <div className="meta">{j.detail}</div>}
                    </div>
                  </td>
                </tr>
              ))}
              {jobs && jobs.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">Nenhuma impressão no período.</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="responsive feed">
            <thead>
              <tr>
                <th style={{ width: 160 }}>Quando</th>
                <th style={{ width: 100 }}>Nível</th>
                {tab === 'auditoria' && <th style={{ width: 140 }}>Usuário</th>}
                <th>Evento</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((r) => (
                <tr key={r.id}>
                  <td data-label="Quando">{fmtDate(r.ts)}</td>
                  <td data-label="Nível">
                    <span className={`pill ${LEVEL_PILL[r.level][0]}`}>{LEVEL_PILL[r.level][1]}</span>
                  </td>
                  {tab === 'auditoria' && <td data-label="Usuário">{r.actor ?? '—'}</td>}
                  <td data-label="Evento" className="event">
                    {r.msg}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">Nenhum evento no período.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
