import { createPool } from './persistence/db.js';
import { migrate } from './persistence/migrate.js';
import { Repos } from './persistence/repos.js';
import { seedProfiles } from './persistence/seed.js';
import { OpencodeClient } from './opencode/client.js';
import { RealtimeHub } from './api/realtime.js';
import { buildApi } from './api/server.js';
import { createBus } from './bus/bus.js';

async function main() {
  // 1) Migraciones + seed de perfiles.
  await migrate();
  const pool = createPool();
  const repos = new Repos(pool);
  await seedProfiles(repos);

  // 2) Cliente OpenCode.
  const opencode = new OpencodeClient({
    baseUrl: process.env.OPENCODE_URL ?? 'http://opencode:4096',
    username: process.env.OPENCODE_SERVER_USERNAME ?? 'opencode',
    password: process.env.OPENCODE_SERVER_PASSWORD ?? '',
  });

  // 3) WebSocket hub + bus NATS.
  const wsPort = Number(process.env.ORCH_WS_PORT ?? 8788);
  const hub = new RealtimeHub(wsPort);
  console.log(`[orchestrator] WebSocket en :${wsPort}`);

  const bus = await createBus(process.env.NATS_URL);

  // emit combinado: va al WS (dashboard directo) y a NATS (bus desacoplado).
  const emit = (event: string, payload: unknown): void => {
    hub.emit(event, payload);
    const cid = (payload as any)?.conversationId;
    if (cid) bus.publishEvent(cid, event, payload);
  };

  // 4) API REST.
  const app = buildApi({ repos, opencode, emit });
  const restPort = Number(process.env.ORCH_REST_PORT ?? 8787);
  await app.listen({ host: '0.0.0.0', port: restPort });
  console.log(`[orchestrator] REST en :${restPort}`);
}

main().catch((err) => {
  console.error('[orchestrator] fallo al arrancar', err);
  process.exit(1);
});
