/**
 * Cliente da API Gileade/MyKids — os mesmos endpoints do MyKids Printer 1.3.5 (HttpService.java).
 * A conta fica guardada como configuração interna (senha e token cifrados); nunca vai ao navegador.
 */
import { env } from './env.js';
import { getSetting, setSetting, deleteSetting } from './db.js';
import { encrypt, decrypt } from './security.js';
import { logger } from './log.js';

export interface GileadeAccount {
  user: string;
  passwordEnc: string;
  tokenEnc?: string;
  tokenExpiresAt?: number;
  userName?: string;
  oi?: string;
  organizationName?: string;
  connectedAt?: string;
}

export interface Organization {
  hierarchyCode: string;
  name: string;
}

export interface MyKidsPrinter {
  id: string;
  nome: string;
}

export class GileadeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const KEY = 'gileade';
const api = (p: string) => new URL(p, env.gileadeApi).toString();

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    // Gumga devolve {code, message, details}; "details" traz a mensagem amigável (ex.: "Usuário não cadastrado.")
    throw new GileadeError(body?.details || body?.message || `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

export function getAccount(): GileadeAccount | undefined {
  return getSetting<GileadeAccount>(KEY);
}

/** Visão pública da conta (sem segredos), para o painel. */
export function accountStatus() {
  const a = getAccount();
  if (!a) return { configured: false as const };
  return {
    configured: true as const,
    user: a.user,
    userName: a.userName,
    oi: a.oi,
    organizationName: a.organizationName,
    connectedAt: a.connectedAt,
    tokenExpiresAt: a.tokenExpiresAt,
  };
}

async function login(user: string, password: string) {
  const body = await request<any>(api('api/kids/public/login'), {
    method: 'POST',
    body: JSON.stringify({ password, user }),
  });
  if (!body?.token) throw new GileadeError('Login recusado pela Gileade.');
  return body as { token: string; timeOfExpiration?: string; name?: string };
}

/** Testa e grava a conta. Retorna as organizações disponíveis para escolha. */
export async function connectAccount(user: string, password: string): Promise<Organization[]> {
  const res = await login(user, password);
  const account: GileadeAccount = {
    user,
    passwordEnc: encrypt(password),
    tokenEnc: encrypt(res.token),
    tokenExpiresAt: res.timeOfExpiration ? Number(res.timeOfExpiration) : undefined,
    userName: res.name,
    connectedAt: new Date().toISOString(),
  };
  setSetting(KEY, account);
  logger.info(`Conta Gileade conectada (${user}).`);
  const orgs = await listOrganizations();
  if (orgs.length === 1) await selectOrganization(orgs[0].hierarchyCode);
  return orgs;
}

export function disconnectAccount(): void {
  deleteSetting(KEY);
  logger.info('Conta Gileade removida.');
}

/** Token válido; faz novo login com a senha guardada se faltar ou estiver perto de vencer. */
async function token(forceRefresh = false): Promise<string> {
  const a = getAccount();
  if (!a) throw new GileadeError('Conta Gileade não configurada.');
  const almostExpired = a.tokenExpiresAt ? a.tokenExpiresAt - Date.now() < 24 * 3600_000 : false;
  if (!forceRefresh && a.tokenEnc && !almostExpired) return decrypt(a.tokenEnc);
  const res = await login(a.user, decrypt(a.passwordEnc));
  setSetting(KEY, {
    ...a,
    tokenEnc: encrypt(res.token),
    tokenExpiresAt: res.timeOfExpiration ? Number(res.timeOfExpiration) : undefined,
  });
  if (a.oi) await changeOrganization(res.token, a.oi);
  return res.token;
}

/** Executa com o token e repete uma vez com login novo se a Gileade recusar (401/403). */
async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await token());
  } catch (e) {
    if (e instanceof GileadeError && (e.status === 401 || e.status === 403)) return fn(await token(true));
    throw e;
  }
}

export async function listOrganizations(): Promise<Organization[]> {
  return withToken(async (t) => {
    const body = await request<any>(api(`public/token/v2/organizations/${encodeURIComponent(t)}?page=0&pageSize=100`));
    return (body.content ?? []).map((o: any) => ({ hierarchyCode: o.hierarchyCode, name: o.name }));
  });
}

async function changeOrganization(t: string, hierarchyCode: string): Promise<void> {
  // O original usa hierarchyCode.split(".")[1] e quebra se não houver "."; aqui caímos para o último segmento.
  const parts = hierarchyCode.split('.').filter(Boolean);
  const sub = parts[1] ?? parts[parts.length - 1];
  if (!sub) throw new GileadeError(`Código de organização inválido: ${hierarchyCode}`);
  await request(api(`public/token/changeorganization/${encodeURIComponent(t)}/${encodeURIComponent(sub)}`));
}

export async function selectOrganization(hierarchyCode: string): Promise<void> {
  const orgs = await listOrganizations();
  const org = orgs.find((o) => o.hierarchyCode === hierarchyCode);
  if (!org) throw new GileadeError('Organização não encontrada nesta conta.');
  await withToken((t) => changeOrganization(t, hierarchyCode));
  const a = getAccount()!;
  setSetting(KEY, { ...a, oi: org.hierarchyCode, organizationName: org.name });
  logger.info(`Organização selecionada: ${org.name} (${org.hierarchyCode}).`);
}

/** Impressoras cadastradas no MyKids. Pagina tudo (o original pegava só a 1ª página de 10). */
export async function listMyKidsPrinters(): Promise<MyKidsPrinter[]> {
  return withToken(async (t) => {
    const out: MyKidsPrinter[] = [];
    const pageSize = 100;
    for (let start = 0; start < 10_000; start += pageSize) {
      const body = await request<any>(
        api(`api/impressora?gumgaToken=${encodeURIComponent(t)}&pageSize=${pageSize}&start=${start}`),
      );
      const values: any[] = body.values ?? [];
      for (const p of values) out.push({ id: String(p.id), nome: p.nome ?? `Impressora ${p.id}` });
      if (!body.hasMore || values.length === 0) break;
    }
    return out;
  });
}

export async function sendLostPassword(email: string): Promise<void> {
  const url = api(
    `api/gileade-security/public/lost-my-password?email=${encodeURIComponent(email)}&url=${encodeURIComponent('https://web.appmykids.com.br/mykids/#!/login/forgot')}`,
  );
  await request(url);
}
