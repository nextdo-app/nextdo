/**
 * Unit tests for the external reminder channels and the due-reminder
 * dispatcher. No network, no live Postgres: adapters are pure and the
 * dispatcher takes an injected fetch + pool.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createChannels,
  feishuSignature,
  renderReminder,
  type DueReminder,
  type ReminderChannel,
} from '../src/channels.js';
import { dispatchDueReminders, listDueReminders } from '../src/reminder-dispatcher.js';
import type { DbPool } from '../src/db.js';

const NOW = new Date('2026-09-21T12:00:00.000Z');

const REMINDER: DueReminder = {
  id: 'rem-1',
  actionKind: 'next',
  actionId: 'act-1',
  firesAt: '2026-09-21T11:59:00.000Z',
  intensity: 'normal',
  title: '写周报',
};

interface FakePoolOptions {
  /** Rows returned by the due-reminder SELECT. */
  selectRows?: unknown[];
  /** Rows returned by an `INSERT … RETURNING` (the dedupe claim). */
  claimRows?: unknown[];
  /**
   * Rows returned by the "already delivered" probe; defaults to none. A
   * function is evaluated per call, so a test can model a probe that starts
   * hit after the first send was recorded.
   */
  alreadyDelivered?: unknown[] | (() => unknown[]);
}

/** Minimal programmable DbPool; records every statement it saw. */
function createFakePool(options: FakePoolOptions = {}) {
  const queries: { text: string; values: readonly unknown[] }[] = [];

  function respond(text: string, values?: readonly unknown[]) {
    queries.push({ text, values: values ?? [] });
    if (text.includes('FROM reminder_deliveries') && text.includes("status = 'sent'")) {
      const option = options.alreadyDelivered;
      const rows = typeof option === 'function' ? option() : (option ?? []);
      return { rows };
    }
    if (text.includes('RETURNING')) {
      return { rows: options.claimRows ?? [{ id: 'delivery-1' }] };
    }
    if (text.trimStart().toUpperCase().startsWith('SELECT')) {
      return { rows: options.selectRows ?? [] };
    }
    return { rows: [] };
  }

  const pool: DbPool = {
    connect: async () => ({
      query: async (text, values) => respond(text, values),
      release: () => undefined,
    }),
    query: async (text, values) => respond(text, values),
    end: async () => undefined,
  };

  return { pool, queries };
}

function createLogger() {
  const info: string[] = [];
  const error: string[] = [];
  return {
    logger: {
      info: (message: string) => info.push(message),
      error: (message: string) => error.push(message),
    },
    info,
    error,
  };
}

function fakeChannel(
  kind: 'feishu' | 'serverchan' | 'pushplus',
  buildRequest: ReminderChannel['buildRequest'],
): ReminderChannel {
  return { kind, buildRequest };
}

describe('renderReminder', () => {
  it('renders the title and the due time in the requested zone', () => {
    const rendered = renderReminder(REMINDER, 'Asia/Shanghai');
    expect(rendered.title).toBe('⏰ 写周报');
    expect(rendered.body).toContain('到点时间：');
    // 11:59 UTC is 19:59 in Shanghai.
    expect(rendered.body).toContain('19:59');
  });

  it('renders in Beijing time when no zone is configured', () => {
    const [channel] = createChannels({ NEXTDO_PUSHPLUS_TOKEN: 'pp-token' });
    const request = channel!.buildRequest(REMINDER, NOW);
    return expect(request).resolves.toMatchObject({
      init: expect.objectContaining({ body: expect.stringContaining('19:59') }),
    });
  });

  it('falls back to the default zone for an invalid time zone', () => {
    const rendered = renderReminder(REMINDER, 'Not/AZone');
    expect(rendered.body).toContain('19:59');
  });
});

describe('createChannels', () => {
  it('omits every channel whose credential is unset', () => {
    expect(createChannels({})).toEqual([]);
  });

  it('builds one channel per configured credential', () => {
    const channels = createChannels({
      NEXTDO_FEISHU_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
      NEXTDO_SERVERCHAN_SENDKEY: 'SCT123',
      NEXTDO_PUSHPLUS_TOKEN: 'pp-token',
    });
    expect(channels.map((c) => c.kind)).toEqual(['feishu', 'serverchan', 'pushplus']);
  });

  it('treats PushPlus and Server 酱 as independent channels', () => {
    expect(createChannels({ NEXTDO_PUSHPLUS_TOKEN: 'pp-token' }).map((c) => c.kind)).toEqual([
      'pushplus',
    ]);
    expect(createChannels({ NEXTDO_SERVERCHAN_SENDKEY: 'SCT123' }).map((c) => c.kind)).toEqual([
      'serverchan',
    ]);
  });
});

describe('feishu channel', () => {
  it('posts a text message to the configured webhook', async () => {
    const [channel] = createChannels({
      NEXTDO_FEISHU_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
      NEXTDO_TIME_ZONE: 'Asia/Shanghai',
    });
    const request = await channel!.buildRequest(REMINDER, NOW);

    expect(request.url).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/abc');
    expect(request.init.method).toBe('POST');
    const body = JSON.parse(String(request.init.body)) as {
      msg_type: string;
      content: { text: string };
      timestamp?: string;
    };
    expect(body.msg_type).toBe('text');
    expect(body.content.text).toContain('写周报');
    expect(body.timestamp).toBeUndefined();
  });

  it('adds a deterministic signature when a secret is configured', async () => {
    const [channel] = createChannels({
      NEXTDO_FEISHU_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
      NEXTDO_FEISHU_SECRET: 'shh',
    });
    const first = await channel!.buildRequest(REMINDER, NOW);
    const second = await channel!.buildRequest(REMINDER, NOW);
    const body = JSON.parse(String(first.init.body)) as { timestamp: string; sign: string };

    expect(body.timestamp).toBe(String(Math.floor(NOW.getTime() / 1000)));
    expect(body.sign).toBe(await feishuSignature(Math.floor(NOW.getTime() / 1000), 'shh'));
    // Same clock + same secret ⇒ same signature (HMAC over an empty string).
    expect(JSON.parse(String(second.init.body))).toEqual(body);
  });
});

describe('serverchan channel', () => {
  it('posts form-encoded title + desp to the SendKey endpoint', async () => {
    const [channel] = createChannels({ NEXTDO_SERVERCHAN_SENDKEY: 'SCT123' });
    const request = await channel!.buildRequest(REMINDER, NOW);

    expect(request.url).toBe('https://sctapi.ftqq.com/SCT123.send');
    expect(request.init.headers).toEqual({
      'content-type': 'application/x-www-form-urlencoded',
    });
    const body = new URLSearchParams(String(request.init.body));
    expect(body.get('title')).toContain('写周报');
    expect(body.get('desp')).toContain('到点时间：');
  });
});

describe('pushplus channel', () => {
  it('posts JSON token + title + content with the plain-text template', async () => {
    const [channel] = createChannels({
      NEXTDO_PUSHPLUS_TOKEN: 'pp-token',
      NEXTDO_TIME_ZONE: 'Asia/Shanghai',
    });
    const request = await channel!.buildRequest(REMINDER, NOW);

    expect(request.url).toBe('https://www.pushplus.plus/send');
    expect(request.init.method).toBe('POST');
    expect(request.init.headers).toEqual({ 'content-type': 'application/json' });
    const body = JSON.parse(String(request.init.body)) as Record<string, string>;
    expect(body).toEqual({
      token: 'pp-token',
      title: '⏰ 写周报',
      content: '到点时间：2026年9月21日 19:59',
      template: 'txt',
    });
    // The credential must not travel in the URL (proxy logs record those).
    expect(request.url).not.toContain('pp-token');
  });

  it('accepts a body whose code is 200', async () => {
    const [channel] = createChannels({ NEXTDO_PUSHPLUS_TOKEN: 'pp-token' });
    const verdict = await channel!.verify!(
      new Response(JSON.stringify({ code: 200, data: 'short-code' }), { status: 200 }),
    );
    expect(verdict).toBeNull();
  });

  it('rejects a 2xx body that reports a vendor error code', async () => {
    // PushPlus answers HTTP 200 even when it refuses the push — measured
    // against the live endpoint with an invalid token (`code: 903`).
    const [channel] = createChannels({ NEXTDO_PUSHPLUS_TOKEN: 'pp-token' });
    const verdict = await channel!.verify!(
      new Response(JSON.stringify({ code: 903, msg: '用户令牌不正确' }), { status: 200 }),
    );
    expect(verdict).toContain('903');
  });

  it('rejects an unreadable body instead of assuming success', async () => {
    const [channel] = createChannels({ NEXTDO_PUSHPLUS_TOKEN: 'pp-token' });
    expect(await channel!.verify!(new Response('<html>oops</html>', { status: 200 }))).toContain(
      'unreadable',
    );
  });
});

describe('listDueReminders', () => {
  it('keeps only rows that still have a title', async () => {
    const { pool } = createFakePool({
      selectRows: [
        {
          id: 'rem-1',
          action_kind: 'next',
          action_id: 'act-1',
          fires_at: '2026-09-21T11:59:00.000Z',
          intensity: 'normal',
          title: '写周报',
        },
        {
          id: 'rem-2',
          action_kind: 'next',
          action_id: 'act-2',
          fires_at: '2026-09-21T11:59:30.000Z',
          intensity: 'normal',
          title: null,
        },
      ],
    });

    const due = await listDueReminders(pool, NOW, 50);
    expect(due.map((r) => r.id)).toEqual(['rem-1']);
  });
});

describe('dispatchDueReminders', () => {
  const dueRow = {
    id: 'rem-1',
    action_kind: 'next',
    action_id: 'act-1',
    fires_at: '2026-09-21T11:59:00.000Z',
    intensity: 'normal',
    title: '写周报',
  };

  it('claims, sends and records a delivery', async () => {
    const { pool, queries } = createFakePool({ selectRows: [dueRow] });
    const { logger } = createLogger();
    const sent: string[] = [];
    const fetchFn = (async () => {
      sent.push('called');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: [
        fakeChannel('feishu', async () => ({
          url: 'https://example.test/hook',
          init: { method: 'POST' },
        })),
      ],
      now: NOW,
      logger,
      fetchFn,
    });

    expect(summary).toEqual({ due: 1, sent: 1, failed: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(queries.some((q) => q.text.includes('INSERT INTO reminder_deliveries'))).toBe(true);
    const update = queries.find((q) => q.text.includes('UPDATE reminder_deliveries'));
    expect(update?.values).toEqual(['rem-1', 'feishu', 'sent', 1, NOW.toISOString(), null]);
  });

  it('skips a delivery another tick already claimed', async () => {
    const { pool } = createFakePool({ selectRows: [dueRow], claimRows: [] });
    const { logger } = createLogger();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: [
        fakeChannel('feishu', async () => ({
          url: 'https://example.test/hook',
          init: { method: 'POST' },
        })),
      ],
      now: NOW,
      logger,
      fetchFn,
    });

    expect(summary).toEqual({ due: 1, sent: 0, failed: 0, skipped: 1 });
    expect(calls).toBe(0);
  });

  it('sends a reminder through only the first channel that accepts it', async () => {
    const { pool, queries } = createFakePool({ selectRows: [dueRow] });
    const { logger } = createLogger();
    const sent: string[] = [];
    const fetchFn = (async (url: string) => {
      sent.push(String(url));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: [
        fakeChannel('feishu', async () => ({
          url: 'https://example.test/feishu',
          init: { method: 'POST' },
        })),
        fakeChannel('pushplus', async () => ({
          url: 'https://example.test/pushplus',
          init: { method: 'POST' },
        })),
      ],
      now: NOW,
      logger,
      fetchFn,
    });

    expect(summary).toEqual({ due: 1, sent: 1, failed: 0, skipped: 0 });
    expect(sent).toEqual(['https://example.test/feishu']);
    // The second channel was never even claimed.
    expect(
      queries.some((q) => q.text.includes('INSERT INTO reminder_deliveries') && q.values.includes('pushplus')),
    ).toBe(false);
  });

  it('falls back to the next channel when the first one fails', async () => {
    const { pool } = createFakePool({ selectRows: [dueRow] });
    const { logger, error } = createLogger();
    const sent: string[] = [];
    const fetchFn = (async (url: string) => {
      sent.push(String(url));
      return new Response('nope', { status: String(url).includes('feishu') ? 500 : 200 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: [
        fakeChannel('feishu', async () => ({
          url: 'https://example.test/feishu',
          init: { method: 'POST' },
        })),
        fakeChannel('pushplus', async () => ({
          url: 'https://example.test/pushplus',
          init: { method: 'POST' },
        })),
      ],
      now: NOW,
      logger,
      fetchFn,
      maxAttempts: 1,
    });

    expect(summary).toEqual({ due: 1, sent: 1, failed: 1, skipped: 0 });
    expect(sent).toEqual(['https://example.test/feishu', 'https://example.test/pushplus']);
    expect(error).toHaveLength(1);
  });

  it('skips a reminder that already reached the user on an earlier tick', async () => {
    const { pool, queries } = createFakePool({
      selectRows: [dueRow],
      alreadyDelivered: [{ id: 1 }],
    });
    const { logger } = createLogger();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: [
        fakeChannel('pushplus', async () => ({
          url: 'https://example.test/pushplus',
          init: { method: 'POST' },
        })),
      ],
      now: NOW,
      logger,
      fetchFn,
    });

    expect(summary).toEqual({ due: 1, sent: 0, failed: 0, skipped: 1 });
    expect(calls).toBe(0);
    expect(
      queries.some((q) => q.text.includes('INSERT INTO reminder_deliveries')),
    ).toBe(false);
  });

  /**
   * Two rows for one moment (a client that reconciled before syncing another
   * device's row) must still produce ONE message: the second row finds the
   * moment already delivered and never reaches a channel.
   */
  it('sends one message when two rows describe the same moment', async () => {
    const sibling = { ...dueRow, id: 'rem-2' };
    let probes = 0;
    const { pool, queries } = createFakePool({
      selectRows: [dueRow, sibling],
      // The first probe (row 1) finds nothing; after its send was recorded,
      // the second probe (row 2) finds that delivery.
      alreadyDelivered: () => (probes++ > 0 ? [{ id: 1 }] : []),
    });
    const { logger } = createLogger();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: [
        fakeChannel('pushplus', async () => ({
          url: 'https://example.test/pushplus',
          init: { method: 'POST' },
        })),
      ],
      now: NOW,
      logger,
      fetchFn,
    });

    expect(summary).toEqual({ due: 2, sent: 1, failed: 0, skipped: 1 });
    expect(calls).toBe(1);
    expect(
      queries.filter((q) => q.text.includes('INSERT INTO reminder_deliveries')),
    ).toHaveLength(1);
  });

  it('retries up to the cap, records the failure and logs it', async () => {
    const { pool, queries } = createFakePool({ selectRows: [dueRow] });
    const { logger, error } = createLogger();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response('nope', { status: 500 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: [
        fakeChannel('serverchan', async () => ({
          url: 'https://example.test/send',
          init: { method: 'POST' },
        })),
      ],
      now: NOW,
      logger,
      fetchFn,
      maxAttempts: 2,
    });

    expect(calls).toBe(2);
    expect(summary).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0 });
    expect(error).toHaveLength(1);
    const update = queries.find((q) => q.text.includes('UPDATE reminder_deliveries'));
    expect(update?.values?.[2]).toBe('failed');
    expect(update?.values?.[3]).toBe(2);
    expect(String(update?.values?.[5])).toContain('500');
  });

  it('marks a delivery failed when the vendor reports an error in a 2xx body', async () => {
    const { pool, queries } = createFakePool({ selectRows: [dueRow] });
    const { logger, error } = createLogger();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      // HTTP 200, business code says the token is invalid.
      return new Response(JSON.stringify({ code: 903 }), { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await dispatchDueReminders({
      pool,
      channels: createChannels({ NEXTDO_PUSHPLUS_TOKEN: 'pp-token' }),
      now: NOW,
      logger,
      fetchFn,
      maxAttempts: 2,
    });

    expect(calls).toBe(2);
    expect(summary).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0 });
    expect(error).toHaveLength(1);
    const update = queries.find((q) => q.text.includes('UPDATE reminder_deliveries'));
    expect(update?.values?.[2]).toBe('failed');
    expect(String(update?.values?.[5])).toContain('903');
  });

  /**
   * The tests above inject a fake transport. This one drives the real `fetch`
   * against a live loopback server, so the HTTP contract (URL, method, JSON
   * body) is proven end-to-end rather than asserted against a stub.
   */
  it('delivers to a live HTTP endpoint', async () => {
    const received: { url: string; body: Record<string, unknown> }[] = [];

    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({
          url: req.url ?? '',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"code":0}');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const { pool } = createFakePool({ selectRows: [dueRow] });
      const summary = await dispatchDueReminders({
        pool,
        channels: createChannels({
          NEXTDO_FEISHU_WEBHOOK: `http://127.0.0.1:${port}/open-apis/bot/v2/hook/test`,
          NEXTDO_TIME_ZONE: 'Asia/Shanghai',
        }),
        now: NOW,
        logger: createLogger().logger,
      });

      expect(summary).toEqual({ due: 1, sent: 1, failed: 0, skipped: 0 });
      expect(received).toHaveLength(1);
      expect(received[0]!.url).toBe('/open-apis/bot/v2/hook/test');
      expect(received[0]!.body).toMatchObject({ msg_type: 'text' });
      expect(JSON.stringify(received[0]!.body)).toContain('写周报');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
