/**
 * Cloudflare Workers entry point for @nextdo/server.
 *
 * Exposes the Hono app on Cloudflare Workers edge runtime.
 * Compatible with Cloudflare Hyperdrive or direct TCP sockets via `nodejs_compat`.
 */
import { createApp } from './app.js';
import { createChannels } from './channels.js';
import {
  initSystemSettingsTable,
  readPersistedOwnerToken,
  ServerClaimManager,
} from './claim.js';
import { cloudJwtAudience } from './credentials.js';
import { createPool, type DbPool } from './db.js';
import { logger } from './logger.js';
import { dispatchDueReminders } from './reminder-dispatcher.js';
import { initDatabaseSchema } from './schema-init.js';
import { seedDefaultContexts } from './seed.js';

export interface WorkerEnv {
  DATABASE_URL: string;
  JWT_SECRET: string;
  NEXTDO_SYNC_ENDPOINT: string;
  /** Optional. The `kid` this deployment's PowerSync keystore holds, when it
   *  is not the default `nextdo-dev` (PowerSync CLOUD auto-names its HS256
   *  entries). The value to use is printed by the service on a rejection as
   *  `Known keys: <kid: …>`. */
  NEXTDO_JWT_KID?: string;
  NEXTDO_OWNER_TOKEN?: string;
  NEXTDO_CLAIM_SECRET?: string;
  HYPERDRIVE?: { connectionString: string };
  /** Feishu custom bot webhook URL, including its hook token. Unset disables
   *  the channel. */
  NEXTDO_FEISHU_WEBHOOK?: string;
  /** Optional Feishu signature secret. When set, every request carries the
   *  `timestamp` + `sign` pair the bot verifies. */
  NEXTDO_FEISHU_SECRET?: string;
  /** Server 酱 Turbo SendKey (the personal-WeChat relay). Unset disables the
   *  channel. */
  NEXTDO_SERVERCHAN_SENDKEY?: string;
  /** PushPlus token (another personal-WeChat relay; a larger free quota than
   *  Server 酱). Unset disables the channel. */
  NEXTDO_PUSHPLUS_TOKEN?: string;
  /** IANA time zone used to render reminder times; defaults to
   *  `Asia/Shanghai`. */
  NEXTDO_TIME_ZONE?: string;
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

  const jwtKid = env.NEXTDO_JWT_KID?.trim();

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
    // Same reasoning for the kid: Cloud names the key itself, so the token
    // must carry whatever that name is. Unset keeps the shared default.
    ...(jwtKid === undefined || jwtKid === '' ? {} : { kid: jwtKid }),
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

/**
 * Pool for the cron path. The fetch path builds its own pool inside the
 * Hono app; a cron tick must not depend on an inbound request having
 * warmed that one up, so the scheduler keeps its own handle.
 */
let cronPool: DbPool | null = null;
let cronPoolConnectionString: string | null = null;

/**
 * The delivery table is created once per isolate. initDatabaseSchema is
 * idempotent but runs DDL, which is wasteful on a per-minute schedule.
 */
let cronSchemaReady = false;

async function getCronPool(env: WorkerEnv): Promise<DbPool> {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (and no HYPERDRIVE binding found)');
  }
  if (cronPool && cronPoolConnectionString === connectionString) {
    return cronPool;
  }
  cronPool = createPool(connectionString);
  cronPoolConnectionString = connectionString;
  return cronPool;
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

  /**
   * Cron entry point (wrangler.jsonc `triggers.crons`).
   *
   * Reads due reminders and pushes them to the configured external
   * channels. Failures are logged and recorded, never thrown — a throw
   * here only marks the cron invocation failed, which cannot help the
   * reminder.
   */
  async scheduled(controller: { scheduledTime: number }, env: WorkerEnv): Promise<void> {
    try {
      const pool = await getCronPool(env);
      if (!cronSchemaReady) {
        await initDatabaseSchema(pool);
        cronSchemaReady = true;
      }

      const channels = createChannels(env);
      if (channels.length === 0) {
        return;
      }

      const summary = await dispatchDueReminders({
        pool,
        channels,
        now: new Date(controller.scheduledTime),
        logger,
      });

      if (summary.due > 0) {
        logger.info(
          `reminder-dispatcher: due=${summary.due} sent=${summary.sent} ` +
            `failed=${summary.failed} skipped=${summary.skipped}`,
        );
      }
    } catch (error) {
      logger.error('reminder-dispatcher: tick failed', error);
    }
  },
};
