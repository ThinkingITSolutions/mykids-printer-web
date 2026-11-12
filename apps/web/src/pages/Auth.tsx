import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Brand } from '../main';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <header className="topbar">
        <Brand />
      </header>
      <div>
        <section className="hero" style={{ textAlign: 'center' }}>
          <h1>{title}</h1>
          <p style={{ margin: '8px auto 0' }}>{subtitle}</p>
        </section>
        <div className="auth-box">
          <div className="card">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { body: { username, password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Impressão de etiquetas" subtitle="Entre com seu usuário do painel de impressão do Ministério Infantil.">
      <form className="stack" onSubmit={submit}>
        <div>
          <label>Usuário</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" />
        </div>
        <div>
          <label>Senha</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" style={{ width: '100%' }} disabled={busy || !username || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('As senhas não conferem.');
    try {
      await api('/api/setup', { body: { name: form.name, username: form.username, password: form.password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <AuthLayout title="Bem-vindo(a)!" subtitle="Primeiro acesso: crie o usuário administrador do painel. Ele configura a conta MyKids e as impressoras.">
      <form className="stack" onSubmit={submit}>
        <div>
          <label>Nome</label>
          <input value={form.name} onChange={set('name')} autoFocus />
        </div>
        <div>
          <label>Usuário</label>
          <input value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" autoCorrect="off" />
        </div>
        <div>
          <label>Senha</label>
          <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
          <div className="hint">Mínimo de 6 caracteres.</div>
        </div>
        <div>
          <label>Confirme a senha</label>
          <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </div>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" style={{ width: '100%' }}>Criar administrador</button>
      </form>
    </AuthLayout>
  );
}
