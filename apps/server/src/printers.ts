/** Vínculos: impressora do MyKids (ID) → impressora física na rede. */
import { z } from 'zod';
import { db } from './db.js';

export const TargetSchema = z.object({
  kind: z.enum(['brother-ql', 'ipp', 'preview']),
  host: z.string().optional(),
  port: z.number().int().optional(),
  ippPath: z.string().optional(),
  mac: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  label: z.string().optional(), // id da etiqueta Brother (29x90, 62x100, 62...)
  threshold: z.number().int().min(1).max(254).optional(),
});
export type Target = z.infer<typeof TargetSchema>;

export const ORIENTATIONS = ['LANDSCAPE', 'INVERSE_LANDSCAPE', 'PORTRAIT', 'INVERSE_PORTRAIT'] as const;

export const PrinterInputSchema = z.object({
  mykidsId: z.string().trim().regex(/^\d+$/, 'O ID da impressora do MyKids é numérico'),
  mykidsName: z.string().optional(),
  nickname: z.string().trim().min(1).max(60),
  ticketType: z.string().min(1),
  orientation: z.enum(ORIENTATIONS).default('LANDSCAPE'),
  target: TargetSchema,
  enabled: z.boolean().default(true),
});
export type PrinterInput = z.infer<typeof PrinterInputSchema>;

export interface PrinterRow extends PrinterInput {
  id: number;
}

const toRow = (r: any): PrinterRow => ({
  id: r.id,
  mykidsId: r.mykids_id,
  mykidsName: r.mykids_name ?? undefined,
  nickname: r.nickname,
  ticketType: r.ticket_type,
  orientation: r.orientation,
  target: JSON.parse(r.target),
  enabled: !!r.enabled,
});

export const listPrinters = (): PrinterRow[] => db.prepare('SELECT * FROM printers ORDER BY nickname').all().map(toRow);

export const getPrinter = (id: number): PrinterRow | undefined => {
  const r = db.prepare('SELECT * FROM printers WHERE id = ?').get(id);
  return r ? toRow(r) : undefined;
};

export const getPrinterByMyKidsId = (mykidsId: string): PrinterRow | undefined => {
  const r = db.prepare('SELECT * FROM printers WHERE mykids_id = ?').get(mykidsId);
  return r ? toRow(r) : undefined;
};

export function savePrinter(input: PrinterInput, id?: number): PrinterRow {
  const vals = [input.mykidsId, input.mykidsName ?? null, input.nickname, input.ticketType, input.orientation, JSON.stringify(input.target), input.enabled ? 1 : 0];
  if (id) {
    db.prepare(
      'UPDATE printers SET mykids_id=?, mykids_name=?, nickname=?, ticket_type=?, orientation=?, target=?, enabled=? WHERE id=?',
    ).run(...vals, id);
    return getPrinter(id)!;
  }
  const r = db
    .prepare('INSERT INTO printers (mykids_id, mykids_name, nickname, ticket_type, orientation, target, enabled) VALUES (?,?,?,?,?,?,?)')
    .run(...vals);
  return getPrinter(Number(r.lastInsertRowid))!;
}

export function updateTargetHost(id: number, host: string): void {
  const p = getPrinter(id);
  if (p) savePrinter({ ...p, target: { ...p.target, host } }, id);
}

export const deletePrinter = (id: number) => db.prepare('DELETE FROM printers WHERE id = ?').run(id);
