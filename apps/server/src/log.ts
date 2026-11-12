import { db } from './db.js';

export type Level = 'info' | 'warn' | 'error';
/** sistema = conexão/agente/erros; impressao = pedidos e jobs; auditoria = ações de usuários do painel. */
export type Category = 'sistema' | 'impressao' | 'auditoria';

const RETENTION_DAYS = 90;
let writes = 0;

/** Log persistido (tela de Logs) + console. Nunca registrar senha, token ou nome de criança. */
export function log(level: Level, msg: string, category: Category = 'sistema', actor?: string): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} [${category}${actor ? `:${actor}` : ''}] ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  db.prepare('INSERT INTO logs (level, msg, category, actor) VALUES (?, ?, ?, ?)').run(level, msg, category, actor ?? null);
  if (++writes % 200 === 0) purge();
}

/** Retenção: 90 dias e no máximo 50 mil eventos / 50 mil jobs. */
export function purge(): void {
  db.prepare(`DELETE FROM logs WHERE ts < datetime('now', '-${RETENTION_DAYS} days') OR id <= (SELECT MAX(id) - 50000 FROM logs)`).run();
  db.prepare(`DELETE FROM jobs WHERE ts < datetime('now', '-${RETENTION_DAYS} days') OR id <= (SELECT MAX(id) - 50000 FROM jobs)`).run();
}

export const logger = {
  info: (m: string, c?: Category) => log('info', m, c),
  warn: (m: string, c?: Category) => log('warn', m, c),
  error: (m: string, c?: Category) => log('error', m, c),
  /** Ação de um usuário do painel (quem fez o quê). */
  audit: (actor: string, m: string, level: Level = 'info') => log(level, m, 'auditoria', actor),
};
