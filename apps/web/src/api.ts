export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Erro ${res.status}`, res.status);
  return data as T;
}

export interface User {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'operator';
}

export interface Target {
  kind: 'brother-ql' | 'ipp' | 'preview';
  host?: string;
  port?: number;
  ippPath?: string;
  mac?: string;
  name?: string;
  model?: string;
  label?: string;
  threshold?: number;
}

export interface PrinterRow {
  id: number;
  mykidsId: string;
  mykidsName?: string;
  nickname: string;
  ticketType: string;
  orientation: string;
  target: Target;
  enabled: boolean;
}

export interface FoundPrinter {
  ip: string;
  mac?: string;
  name?: string;
  model?: string;
  isBrotherQL: boolean;
  port9100: boolean;
  ipp: boolean;
  status?: string;
  via: string[];
}

export const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
};
