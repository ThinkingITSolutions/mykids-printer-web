/** Login local do painel (separado da conta Gileade). Papéis: admin (configura) e operator (só reconecta). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { env } from './env.js';
import { hashPassword, verifyPassword, newToken, sha256 } from './security.js';
import { logger } from './log.js';

export type Role = 'admin' | 'operator';
export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const COOKIE = 'mkp_session';
const SESSION_DAYS = 30;

const countUsers = () => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

const publicUser = (u: any): SessionUser => ({ id: u.id, username: u.username, name: u.name, role: u.role });

function createSession(reply: FastifyReply, userId: number) {
  const token = newToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, expires);
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: env.secureCookies, expires: new Date(expires) });
}

/** Tentativas de login por IP (proteção simples contra força bruta). */
const attempts = new Map<string, { n: number; until: number }>();

export function requireRole(role: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'Faça login.' });
    if (role === 'admin' && req.user.role !== 'admin') return reply.code(403).send({ error: 'Apenas administradores.' });
  };
}

const UserInput = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Use letras, números, ponto, hífen ou _'),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(6, 'Senha com no mínimo 6 caracteres').max(200),
  role: z.enum(['admin', 'operator']),
});

/** Hook global (registrado na raiz em index.ts): identifica o usuário pelo cookie de sessão. */
export async function sessionHook(req: FastifyRequest) {
  const token = req.cookies[COOKIE];
  if (!token) return;
  const row = db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .get(sha256(token), Date.now());
  if (row) req.user = publicUser(row);
}

export async function authRoutes(app: FastifyInstance) {

  app.get('/api/session', async (req) => ({ user: req.user ?? null, needsSetup: countUsers() === 0 }));

  /** Primeiro acesso: cria o administrador (só funciona enquanto não houver nenhum usuário). */
  app.post('/api/setup', async (req, reply) => {
    if (countUsers() > 0) return reply.code(409).send({ error: 'O sistema já foi configurado.' });
    const input = UserInput.parse({ ...(req.body as object), role: 'admin' });
    const r = db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)').run(input.username, input.name, hashPassword(input.password), 'admin');
    createSession(reply, Number(r.lastInsertRowid));
    logger.audit(input.username, 'Criou o administrador inicial (primeiro acesso).');
    return { ok: true };
  });

  app.post('/api/login', async (req, reply) => {
    const ip = req.ip;
    const a = attempts.get(ip);
    if (a && a.until > Date.now()) return reply.code(429).send({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      logger.audit(username.trim() || '?', `Login recusado (IP ${ip}, tentativa ${n}).`, 'warn');
      return reply.code(401).send({ error: 'Usuário ou senha inválidos.' });
    }
    attempts.delete(ip);
    createSession(reply, user.id);
    logger.audit(user.username, `Entrou no painel (IP ${ip}).`);
    return { user: publicUser(user) };
  });

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    if (req.user) logger.audit(req.user.username, 'Saiu do painel.');
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/me/password', { preHandler: requireRole('operator') }, async (req, reply) => {
    const { current, next } = z.object({ current: z.string(), next: z.string().min(6) }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
    if (!verifyPassword(current, user.password_hash)) return reply.code(400).send({ error: 'Senha atual incorreta.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
    logger.audit(user.username, 'Trocou a própria senha.');
    return { ok: true };
  });

  // ---- gestão de usuários (admin)
  app.get('/api/users', { preHandler: requireRole('admin') }, async () =>
    db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY role, name').all(),
  );

  app.post('/api/users', { preHandler: requireRole('admin') }, async (req, reply) => {
    const input = UserInput.parse(req.body);
    try {
      db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)').run(input.username, input.name, hashPassword(input.password), input.role);
    } catch {
      return reply.code(409).send({ error: 'Já existe um usuário com esse login.' });
    }
    logger.audit(req.user!.username, `Criou o usuário ${input.username} (${input.role === 'admin' ? 'administrador' : 'operador'}).`);
    return { ok: true };
  });

  app.put('/api/users/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const input = UserInput.partial({ password: true }).omit({ username: true }).parse(req.body);
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND id <> ?").get(id) as any).n;
    if (input.role === 'operator' && admins === 0) return reply.code(400).send({ error: 'Precisa existir pelo menos um administrador.' });
    db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?').run(input.name, input.role, id);
    if (input.password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(input.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    logger.audit(req.user!.username, `Alterou o usuário #${id} (${input.role === 'admin' ? 'administrador' : 'operador'}${input.password ? ', com nova senha' : ''}).`);
    return { ok: true };
  });

  app.delete('/api/users/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (id === req.user!.id) return reply.code(400).send({ error: 'Você não pode excluir o próprio usuário.' });
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND id <> ?").get(id) as any).n;
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any;
    if (target?.role === 'admin' && admins === 0) return reply.code(400).send({ error: 'Precisa existir pelo menos um administrador.' });
    const gone = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as any;
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logger.audit(req.user!.username, `Excluiu o usuário ${gone?.username ?? '#' + id}.`, 'warn');
    return { ok: true };
  });
}
