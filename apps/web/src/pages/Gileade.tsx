import { useEffect, useState, type FormEvent } from 'react';
import { api, fmtDate } from '../api';

interface Account {
  configured: boolean;
  user?: string;
  userName?: string;
  oi?: string;
  organizationName?: string;
  connectedAt?: string;
  tokenExpiresAt?: number;
}
interface Org {
  hierarchyCode: string;
  name: string;
}

export function Gileade() {
  const [acc, setAcc] = useState<Account>();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [form, setForm] = useState({ user: '', password: '' });
  const [msg, setMsg] = useState<{ type: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<{ type: string; description: string }[]>();

  const load = async () => {
    const a = await api<Account>('/api/gileade');
    setAcc(a);
    if (a.configured) setOrgs(await api<Org[]>('/api/gileade/organizations').catch(() => []));
  };
  useEffect(() => {
    void load();
  }, []);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await api<{ organizations: Org[] }>('/api/gileade', { body: form });
      setOrgs(r.organizations);
      setForm({ user: '', password: '' });
      setMsg({ type: 'success', text: r.organizations.length > 1 ? 'Conta conectada. Escolha a organização.' : 'Conta conectada.' });
      await load();
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const choose = async (hierarchyCode: string) => {
    setBusy(true);
    try {
      await api('/api/gileade/organization', { body: { hierarchyCode } });
      await load();
      setMsg({ type: 'success', text: 'Organização selecionada.' });
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remover a conta MyKids? As impressoras continuam imprimindo, mas não será possível listar/vincular novas.')) return;
    await api('/api/gileade', { method: 'DELETE' });
    setOrgs([]);
    await load();
  };

  const refreshTemplates = async () => {
    setTemplates(await api('/api/templates/refresh', { method: 'POST' }));
  };

  return (
    <>
      <section className="hero">
        <h1>Conta MyKids (Gileade)</h1>
        <p>
          Conta interna usada pelo sistema para buscar as impressoras e os modelos de etiqueta da igreja. A senha fica cifrada
          no servidor e nunca é mostrada. Não é o login deste painel.
        </p>
      </section>
      <main className="stack">
        {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        {acc?.configured && (
          <div className="card stack">
            <div className="row">
              <h3>{acc.organizationName ?? 'Organização não selecionada'}</h3>
              <span className="spacer" />
              <span className="pill ok">Conectada</span>
            </div>
            <div className="meta">
              Conta: {acc.user} ({acc.userName}) · conectada em {fmtDate(acc.connectedAt)} · token válido até{' '}
              {acc.tokenExpiresAt ? new Date(acc.tokenExpiresAt).toLocaleDateString('pt-BR') : '—'} (renovado sozinho)
            </div>
            {orgs.length > 1 && (
              <div>
                <label>Organização</label>
                <select value={acc.oi ?? ''} onChange={(e) => choose(e.target.value)} disabled={busy}>
                  <option value="" disabled>
                    Escolha…
                  </option>
                  {orgs.map((o) => (
                    <option key={o.hierarchyCode} value={o.hierarchyCode}>
                      {o.name} ({o.hierarchyCode})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="row">
              <button onClick={refreshTemplates}>Atualizar modelos de etiqueta</button>
              <span className="spacer" />
              <button className="danger" onClick={remove}>
                Remover conta
              </button>
            </div>
            {templates && (
              <div className="alert info">
                {templates.length} modelo(s) personalizado(s) da igreja: {templates.map((t) => t.description).join(', ') || 'nenhum'}.
              </div>
            )}
          </div>
        )}

        <div className="card">
          <h3>{acc?.configured ? 'Trocar a conta' : 'Conectar a conta MyKids'}</h3>
          <p className="meta">Use o mesmo e-mail e senha do MyKids / MyKids Printer.</p>
          <form className="stack" onSubmit={connect}>
            <div className="fields">
              <div>
                <label>E-mail / usuário MyKids</label>
                <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} autoComplete="off" />
              </div>
              <div>
                <label>Senha MyKids</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
              </div>
            </div>
            <div className="row">
              <button className="primary" disabled={busy || !form.user || !form.password}>
                {busy ? 'Conectando…' : 'Testar e salvar'}
              </button>
              <button
                type="button"
                className="link"
                onClick={async () => {
                  if (!form.user) return setMsg({ type: 'error', text: 'Preencha o e-mail para recuperar a senha.' });
                  await api('/api/gileade/lost-password', { body: { email: form.user } })
                    .then(() => setMsg({ type: 'success', text: 'A Gileade enviou o e-mail de recuperação.' }))
                    .catch((e) => setMsg({ type: 'error', text: e.message }));
                }}
              >
                Esqueci a senha do MyKids
              </button>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
