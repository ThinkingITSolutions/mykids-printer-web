/** Rotas do painel: status/reconectar (operador) e configuração (admin). */
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { requireRole } from './auth.js';
import * as gileade from './gileade.js';
import { listTemplates, refreshOnlineTemplates, samplePrintRequest } from './templates.js';
import { LABELS } from './brother.js';
import { discoverPrinters } from './discovery.js';
import { listPrinters, getPrinter, savePrinter, deletePrinter, PrinterInputSchema, ORIENTATIONS } from './printers.js';
import { enqueue, previewPath } from './printing.js';
import { agentStatus, reconnect, refreshJoins, checkPrinters } from './agent.js';
import { ippAttributes } from './transports.js';
import { logger } from './log.js';

const operator = { preHandler: requireRole('operator') };
const admin = { preHandler: requireRole('admin') };
const idParam = (req: any) => Number(req.params.id);

export async function appRoutes(app: FastifyInstance) {
  // ---------------- operador
  app.get('/api/status', operator, async () => ({
    ...agentStatus(),
    organization: gileade.accountStatus().configured ? gileade.accountStatus() : null,
    recentJobs: db.prepare('SELECT ts, mykids_id, printer_name, codigo, status, detail, source, duration_ms FROM jobs ORDER BY id DESC LIMIT 15').all(),
  }));

  app.post('/api/reconnect', operator, async (req) => {
    await reconnect(req.user!.username);
    return agentStatus();
  });

  // ---------------- integração Gileade (interna, só admin)
  app.get('/api/gileade', admin, async () => gileade.accountStatus());

  app.post('/api/gileade', admin, async (req, reply) => {
    const { user, password } = z.object({ user: z.string().trim().min(3), password: z.string().min(1) }).parse(req.body);
    try {
      const organizations = await gileade.connectAccount(user, password);
      logger.audit(req.user!.username, `Conectou a conta MyKids ${user}.`);
      if (organizations.length === 1) await refreshOnlineTemplates();
      return { organizations, account: gileade.accountStatus() };
    } catch (e) {
      logger.audit(req.user!.username, `Falha ao conectar a conta MyKids ${user}: ${(e as Error).message}`, 'warn');
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/gileade/organizations', admin, async () => gileade.listOrganizations());

  app.post('/api/gileade/organization', admin, async (req) => {
    const { hierarchyCode } = z.object({ hierarchyCode: z.string() }).parse(req.body);
    await gileade.selectOrganization(hierarchyCode);
    logger.audit(req.user!.username, `Selecionou a organização ${hierarchyCode}.`);
    await refreshOnlineTemplates();
    return gileade.accountStatus();
  });

  app.delete('/api/gileade', admin, async (req) => {
    gileade.disconnectAccount();
    logger.audit(req.user!.username, 'Removeu a conta MyKids.', 'warn');
    return { ok: true };
  });

  app.post('/api/gileade/lost-password', admin, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await gileade.sendLostPassword(email);
    return { ok: true };
  });

  /** Impressoras cadastradas no MyKids (para vincular). */
  app.get('/api/mykids/printers', admin, async (_req, reply) => {
    try {
      const linked = new Map(listPrinters().map((p) => [p.mykidsId, p.nickname]));
      return (await gileade.listMyKidsPrinters()).map((p) => ({ ...p, linkedTo: linked.get(p.id) ?? null }));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---------------- catálogo
  app.get('/api/catalog', admin, async () => ({
    templates: listTemplates().map(({ file: _f, ...t }) => t),
    labels: LABELS,
    orientations: ORIENTATIONS,
  }));

  app.post('/api/templates/refresh', admin, async (req) => {
    logger.audit(req.user!.username, 'Atualizou os modelos de etiqueta.');
    return (await refreshOnlineTemplates()).map(({ file: _f, ...t }) => t);
  });

  // ---------------- rede
  app.get('/api/discover', admin, async (req) => {
    const found = await discoverPrinters();
    logger.audit(req.user!.username, `Procurou impressoras na rede: ${found.length} encontrada(s) (${found.filter((f) => f.isBrotherQL).length} Brother QL).`);
    return found;
  });

  app.get('/api/ipp-info', admin, async (req, reply) => {
    const { host, path } = z.object({ host: z.string(), path: z.string().default('ipp/print') }).parse(req.query);
    try {
      return await ippAttributes(`ipp://${host}:631/${path}`);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---------------- vínculos de impressora
  app.get('/api/printers', admin, async () => listPrinters());

  app.post('/api/printers', admin, async (req, reply) => {
    const input = PrinterInputSchema.parse(req.body);
    try {
      const p = savePrinter(input);
      logger.audit(req.user!.username, `Incluiu a impressora "${p.nickname}" (MyKids #${p.mykidsId} → ${p.target.kind} ${p.target.host ?? ''}, modelo ${p.ticketType}).`);
      refreshJoins();
      void checkPrinters();
      return p;
    } catch {
      return reply.code(409).send({ error: `A impressora MyKids ${input.mykidsId} já está vinculada.` });
    }
  });

  app.put('/api/printers/:id', admin, async (req, reply) => {
    const id = idParam(req);
    if (!getPrinter(id)) return reply.code(404).send({ error: 'Não encontrada.' });
    const p = savePrinter(PrinterInputSchema.parse(req.body), id);
    logger.audit(req.user!.username, `Alterou a impressora "${p.nickname}" (MyKids #${p.mykidsId} → ${p.target.kind} ${p.target.host ?? ''}, modelo ${p.ticketType}, ${p.enabled ? 'ativa' : 'desativada'}).`);
    refreshJoins();
    void checkPrinters();
    return p;
  });

  app.delete('/api/printers/:id', admin, async (req) => {
    const old = getPrinter(idParam(req));
    deletePrinter(idParam(req));
    if (old) logger.audit(req.user!.username, `Removeu a impressora "${old.nickname}" (MyKids #${old.mykidsId}).`, 'warn');
    refreshJoins();
    return { ok: true };
  });

  /**
   * Impressão de teste — liberada também para o operador (cada impressora configurada).
   * Intervalo mínimo de 10 s por impressora para evitar cliques repetidos.
   */
  const lastTest = new Map<number, number>();
  app.post('/api/printers/:id/test', operator, async (req, reply) => {
    const p = getPrinter(idParam(req));
    if (!p) return reply.code(404).send({ error: 'Impressora não encontrada.' });
    const wait = (lastTest.get(p.id) ?? 0) + 10_000 - Date.now();
    if (wait > 0) return reply.code(429).send({ error: `Aguarde ${Math.ceil(wait / 1000)} s para testar "${p.nickname}" de novo.` });
    lastTest.set(p.id, Date.now());
    logger.audit(req.user!.username, `Pediu impressão de teste em "${p.nickname}" (MyKids #${p.mykidsId}).`);
    try {
      await enqueue(p, [samplePrintRequest(p.mykidsId)], 'teste', req.user!.username);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /** Última etiqueta renderizada (PNG) — pré-visualização. */
  app.get('/api/printers/:id/preview.png', admin, async (req, reply) => {
    const f = previewPath(idParam(req));
    if (!fs.existsSync(f)) return reply.code(404).send({ error: 'Sem pré-visualização ainda.' });
    return reply.header('Cache-Control', 'no-store').type('image/png').send(fs.readFileSync(f));
  });

  // ---------------- logs e histórico
  const LogQuery = z.object({
    category: z.enum(['sistema', 'impressao', 'auditoria']).optional(),
    level: z.enum(['info', 'warn', 'error']).optional(),
    q: z.string().trim().max(100).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(500),
  });
  const JobQuery = z.object({
    status: z.enum(['ok', 'erro']).optional(),
    source: z.enum(['checkin', 'teste']).optional(),
    printer: z.string().optional(),
    q: z.string().trim().max(100).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(500),
  });

  // datas do filtro vêm em horário local (America/Sao_Paulo); ts no banco é UTC
  const local = "datetime(ts, 'localtime')";

  function queryLogs(raw: unknown) {
    const f = LogQuery.parse(raw);
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.category) where.push('category = ?'), args.push(f.category);
    if (f.level) where.push('level = ?'), args.push(f.level);
    if (f.q) where.push('(msg LIKE ? OR actor LIKE ?)'), args.push(`%${f.q}%`, `%${f.q}%`);
    if (f.from) where.push(`${local} >= ?`), args.push(`${f.from} 00:00:00`);
    if (f.to) where.push(`${local} <= ?`), args.push(`${f.to} 23:59:59`);
    const sql = `SELECT id, ts, level, category, actor, msg FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    return db.prepare(sql).all(...args, f.limit) as Record<string, unknown>[];
  }

  function queryJobs(raw: unknown) {
    const f = JobQuery.parse(raw);
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.status) where.push('status = ?'), args.push(f.status);
    if (f.source) where.push('source = ?'), args.push(f.source);
    if (f.printer) where.push('mykids_id = ?'), args.push(f.printer);
    if (f.q) where.push('(codigo LIKE ? OR detail LIKE ? OR printer_name LIKE ?)'), args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    if (f.from) where.push(`${local} >= ?`), args.push(`${f.from} 00:00:00`);
    if (f.to) where.push(`${local} <= ?`), args.push(`${f.to} 23:59:59`);
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db
      .prepare(`SELECT id, ts, mykids_id, printer_name, codigo, status, detail, labels, duration_ms, source FROM jobs ${w} ORDER BY id DESC LIMIT ?`)
      .all(...args, f.limit) as Record<string, unknown>[];
    const totals = db
      .prepare(`SELECT COUNT(*) AS jobs, COALESCE(SUM(labels),0) AS labels, SUM(status='erro') AS errors, CAST(AVG(duration_ms) AS INTEGER) AS avg_ms FROM jobs ${w}`)
      .get(...args);
    return { rows, totals };
  }

  const csv = (rows: Record<string, unknown>[]) => {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => (v == null ? '' : /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return '\ufeff' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  };

  app.get('/api/logs', admin, async (req) => queryLogs(req.query));
  app.get('/api/jobs', admin, async (req) => queryJobs(req.query));

  app.get('/api/logs.csv', admin, async (req, reply) => {
    logger.audit(req.user!.username, 'Exportou os eventos em CSV.');
    return reply.header('Content-Disposition', 'attachment; filename="mykids-printer-eventos.csv"').type('text/csv; charset=utf-8').send(csv(queryLogs({ ...(req.query as object), limit: 5000 })));
  });
  app.get('/api/jobs.csv', admin, async (req, reply) => {
    logger.audit(req.user!.username, 'Exportou o histórico de impressões em CSV.');
    return reply.header('Content-Disposition', 'attachment; filename="mykids-printer-impressoes.csv"').type('text/csv; charset=utf-8').send(csv(queryJobs({ ...(req.query as object), limit: 5000 }).rows));
  });
}
