/**
 * Cloudflare Workers entry point for @nextdo/server.
 *
 * Exposes the Hono app on Cloudflare Workers edge runtime.
 * Compatible with Cloudflare Hyperdrive or direct TCP sockets via `nodejs_compat`.
 */
import { createApp } from './app.js';
import {
  initSystemSettingsTable,
  readPersistedOwnerToken,
  ServerClaimManager,
} from './claim.js';
import { cloudJwtAudience } from './credentials.js';
import { createPool } from './db.js';
import { logger } from './logger.js';
import { initDatabaseSchema } from './schema-init.js';
import { seedDefaultContexts } from './seed.js';

export interface WorkerEnv {
  DATABASE_URL: string;
  JWT_SECRET: string;
  NEXTDO_SYNC_ENDPOINT: string;
  NEXTDO_OWNER_TOKEN?: string;
  NEXTDO_CLAIM_SECRET?: string;
  HYPERDRIVE?: { connectionString: string };
}

let cachedApp: ReturnType<typeof createApp> | null = null;
let cachedConnectionString: string | null = null;
let initPromise: Promise<ReturnType<typeof createApp>> | null = null;

async function initApp(env: WorkerEnv): Promise<ReturnType<typeof createApp>> {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (and no HYPERDRIVE binding found)');
  }
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
  }
  if (!env.NEXTDO_SYNC_ENDPOINT) {
    throw new Error('NEXTDO_SYNC_ENDPOINT is not set');
  }

  const pool = createPool(connectionString);

  // Auto-initialize application database schema (tables, indexes, publication)
  try {
    await initDatabaseSchema(pool);
  } catch (error) {
    logger.error('failed to initialize database schema', error);
  }

  const staticOwnerToken = env.NEXTDO_OWNER_TOKEN?.trim() || null;
  if (staticOwnerToken !== null) {
    logger.info('owner token source: env');
  } else {
    logger.info('owner token source: claimable / database');
  }

  try {
    await initSystemSettingsTable(pool);
  } catch (error) {
    logger.error('failed to initialize system_settings table', error);
  }

  let initialDynamicToken: string | null = null;
  if (staticOwnerToken === null) {
    try {
      initialDynamicToken = await readPersistedOwnerToken(pool);
    } catch (error) {
      logger.error('failed to read persisted owner token', error);
    }
  }

  const claimState = new ServerClaimManager({
    pool,
    staticToken: staticOwnerToken,
    initialDynamicToken,
  });

  try {
    await seedDefaultContexts(pool);
  } catch (error) {
    logger.error('context seeding failed', error);
  }

  const claimSecret = env.NEXTDO_CLAIM_SECRET?.trim() || null;
  if (claimSecret !== null) {
    logger.info('claim secret: configured');
  }

  const app = createApp({
    pool,
    claimState,
    claimSecret,
    jwtSecret: env.JWT_SECRET,
    syncEndpoint: env.NEXTDO_SYNC_ENDPOINT,
    // A PowerSync CLOUD instance requires its OWN instance URL as `aud` — the
    // shared `nextdo` default only satisfies the self-hosted service.yaml,
    // which never runs this entry point. The URL is already here as
    // NEXTDO_SYNC_ENDPOINT, so the audience is derived from it rather than
    // asking the operator to keep a second setting in agreement.
    audience: cloudJwtAudience(env.NEXTDO_SYNC_ENDPOINT),
  });

  cachedConnectionString = connectionString;
  cachedApp = app;
  return app;
}

function getApp(env: WorkerEnv): Promise<ReturnType<typeof createApp>> {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (cachedApp && cachedConnectionString === connectionString) {
    return Promise.resolve(cachedApp);
  }
  if (!initPromise) {
    initPromise = initApp(env).finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: Parameters<ReturnType<typeof createApp>['fetch']>[2],
  ): Promise<Response> {
    try {
      const app = await getApp(env);
      return await app.fetch(request, env, ctx);
    } catch (error) {
      logger.error('worker request failed', error);
      return new Response(
        JSON.stringify({
          error: 'server_init_failed',
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
  },
};
