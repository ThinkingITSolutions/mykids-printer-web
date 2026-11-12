import { useEffect, useState } from 'react';
import { api, fmtDate, type User } from '../api';
import { useSession } from '../main';

type Row = User & { created_at: string };
const empty = { username: '', name: '', password: '', role: 'operator' as User['role'] };

export function Users() {
  const { user: me } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<number>();
  const [msg, setMsg] = useState<{ type: string; text: string }>();

  const load = async () => setRows(await api('/api/users'));
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setMsg(undefined);
    try {
      if (editId) await api(`/api/users/${editId}`, { method: 'PUT', body: { name: form.name, role: form.role, password: form.password || undefined } });
      else await api('/api/users', { body: form });
      setForm(empty);
      setEditId(undefined);
      setMsg({ type: 'success', text: 'Usuário salvo.' });
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  const remove = async (r: Row) => {
    if (!confirm(`Excluir o usuário ${r.username}?`)) return;
    try {
      await api(`/api/users/${r.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  return (
    <>
      <section className="hero">
        <h1>Usuários do painel</h1>
        <p>Administrador: configura conta MyKids, impressoras e usuários. Operador: vê o status e pode clicar em "Reconectar".</p>
      </section>
      <main className="stack">
        <div className="card stack">
          <h3>{editId ? 'Editar usuário' : 'Novo usuário'}</h3>
          <div className="fields">
            <div>
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label>Usuário</label>
              <input value={form.username} disabled={!!editId} autoCapitalize="none" autoCorrect="off" onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label>{editId ? 'Nova senha (opcional)' : 'Senha'}</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </div>
            <div>
              <label>Perfil</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}>
                <option value="operator">Operador (só reconectar)</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
          </div>
          {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
          <div className="actions">
            <button className="primary" onClick={save} disabled={!form.name || (!editId && (!form.username || !form.password))}>
              Salvar
            </button>
            {editId && (
              <button
                onClick={() => {
                  setEditId(undefined);
                  setForm(empty);
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
        <table className="responsive">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Usuário</th>
              <th>Perfil</th>
              <th>Criado em</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Nome">
                  <strong>{r.name}</strong>
                </td>
                <td data-label="Usuário">{r.username}</td>
                <td data-label="Perfil">
                  <span className={`pill ${r.role === 'admin' ? 'info' : 'ok'}`}>{r.role === 'admin' ? 'Administrador' : 'Operador'}</span>
                </td>
                <td data-label="Criado em">{fmtDate(r.created_at)}</td>
                <td className="actions-cell">
                  <button
                    className="link"
                    onClick={() => {
                      setEditId(r.id);
                      setForm({ username: r.username, name: r.name, password: '', role: r.role });
                    }}
                  >
                    Editar
                  </button>{' '}
                  {r.id !== me?.id && (
                    <button className="link" style={{ color: 'var(--red)' }} onClick={() => remove(r)}>
                      Excluir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
