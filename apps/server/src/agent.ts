/**
 * Agente Socket.IO — equivalente ao SocketIO.java: conecta em printer.appmykids.com.br (Socket.IO v2),
 * faz "join" com o ID de cada impressora vinculada e recebe o evento "print".
 */
import io from 'socket.io-client';
import { env } from './env.js';
import { logger } from './log.js';
import { listPrinters } from './printers.js';
import { parsePrintRequest } from './templates.js';
import { handlePrintEvent } from './printing.js';
import { probePort } from './transports.js';
import { snmpInfo } from './discovery.js';

type SocketStatus = 'offline' | 'connecting' | 'online';

const state = {
  socket: undefined as ReturnType<typeof io> | undefined,
  status: 'offline' as SocketStatus,
  joined: [] as string[],
  lastConnectAt: undefined as string | undefined,
  lastPrintAt: undefined as string | undefined,
  printing: 0,
  printerHealth: new Map<number, { online: boolean; status?: string; checkedAt: string }>(),
};

function joinAll() {
  const ids = listPrinters()
    .filter((p) => p.enabled)
    .map((p) => p.mykidsId);
  for (const id of ids) state.socket?.emit('join', id);
  state.joined = ids;
  logger.info(`Socket: join em ${ids.length} impressora(s): ${ids.join(', ') || '(nenhuma)'}.`);
}

export function startAgent(): void {
  stopAgent();
  state.status = 'connecting';
  const socket = io(env.socketUrl, { forceNew: true, reconnection: true, reconnectionDelayMax: 10_000, timeout: 10_000 });
  state.socket = socket;
  socket.on('connect', () => {
    state.status = 'online';
    state.lastConnectAt = new Date().toISOString();
    logger.info('Socket MyKids conectado.');
    joinAll();
  });
  socket.on('disconnect', (reason: string) => {
    state.status = 'offline';
    logger.warn(`Socket MyKids desconectado (${reason}).`);
  });
  socket.on('connect_error', (e: Error) => {
    state.status = 'offline';
    logger.warn(`Socket MyKids sem conexão: ${e.message}`);
  });
  socket.on('reconnecting', () => (state.status = 'connecting'));
  socket.on('print', async (data: unknown) => {
    const items = Array.isArray(data) ? data : [data];
    const ids = [...new Set(items.map((i: any) => String(i?.printerId)))].join(', ');
    logger.info(`Pedido recebido do MyKids: ${items.length} etiqueta(s) para a(s) impressora(s) ${ids}.`, 'impressao');
    state.lastPrintAt = new Date().toISOString();
    state.printing++;
    try {
      await handlePrintEvent(items.map(parsePrintRequest));
    } catch (e) {
      logger.error(`Erro tratando pedido de impressão: ${(e as Error).message}`);
    } finally {
      state.printing--;
    }
  });
}

export function stopAgent(): void {
  state.socket?.removeAllListeners();
  state.socket?.close();
  state.socket = undefined;
  state.status = 'offline';
}

/** Chamado depois de incluir/alterar impressoras: refaz os "join" sem derrubar a conexão. */
export function refreshJoins(): void {
  if (state.socket?.connected) joinAll();
}

export async function checkPrinters(): Promise<void> {
  await Promise.all(
    listPrinters().map(async (p) => {
      const t = p.target;
      let online = t.kind === 'preview';
      let status: string | undefined = t.kind === 'preview' ? 'modo pré-visualização' : undefined;
      if (t.host && t.kind !== 'preview') {
        online = await probePort(t.host, t.kind === 'ipp' ? (t.port ?? 631) : (t.port ?? 9100), 1500);
        if (online) status = (await snmpInfo(t.host))?.status;
      }
      state.printerHealth.set(p.id, { online, status, checkedAt: new Date().toISOString() });
    }),
  );
}

/** Botão "Reconectar" do operador: reabre o socket e verifica as impressoras. */
export async function reconnect(actor?: string): Promise<void> {
  if (actor) logger.audit(actor, 'Clicou em Reconectar.');
  startAgent();
  await checkPrinters();
}

export function agentStatus() {
  return {
    socket: state.status,
    printing: state.printing > 0,
    joined: state.joined,
    lastConnectAt: state.lastConnectAt,
    lastPrintAt: state.lastPrintAt,
    printers: listPrinters().map((p) => ({
      id: p.id,
      nickname: p.nickname,
      mykidsId: p.mykidsId,
      enabled: p.enabled,
      kind: p.target.kind,
      host: p.target.host,
      ...(state.printerHealth.get(p.id) ?? { online: false }),
    })),
  };
}

export function startHealthLoop(): void {
  void checkPrinters();
  setInterval(() => void checkPrinters(), 30_000).unref();
}
