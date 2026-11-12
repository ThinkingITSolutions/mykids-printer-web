import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { env } from './env.js';
import { authRoutes, sessionHook } from './auth.js';
import { appRoutes } from './routes.js';
import { startAgent, startHealthLoop } from './agent.js';
import { refreshOnlineTemplates } from './templates.js';
import { closeRenderer } from './render.js';
import { logger } from './log.js';

const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 1_000_000 });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
  const status = (err as any).statusCode ?? 500;
  if (status >= 500) logger.error(`Erro interno: ${(err as Error).message}`);
  return reply.code(status).send({ error: status >= 500 ? 'Erro interno.' : (err as Error).message });
});

await app.register(cookie);
app.addHook('onRequest', sessionHook);
await app.register(authRoutes);
await app.register(appRoutes);
app.get('/healthz', async () => ({ ok: true }));

if (fs.existsSync(env.webDir)) {
  await app.register(fastifyStatic, { root: env.webDir });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Não encontrado.' }) : reply.sendFile('index.html'),
  );
}

await app.listen({ port: env.port, host: env.host });
logger.info(`MyKids Printer Web ouvindo em http://${env.host}:${env.port} (dados em ${env.dataDir}).`);

void refreshOnlineTemplates();
startAgent();
startHealthLoop();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await closeRenderer();
    process.exit(0);
  });
}
