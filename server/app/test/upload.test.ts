/**
 * /upload apply logic against a mocked pg (no live Postgres).
 *
 * Asserts the REAL decisions: which SQL statement ran (text + bound
 * values), which ops were skipped, and the 2xx-on-rejection protocol
 * (rejected ops → 2xx + not applied; transient failures → 5xx; malformed
 * protocol → 400).
 */
import { createApp } from '../src/app.js';
import { APPEND_ONLY_TABLES, MUTABLE_TABLES } from '../src/db.js';
import type { Hono } from 'hono';
import { createMockPool, type MockPool, JWT_SECRET, NOW, NOW_ISO, OWNER_TOKEN, SYNC_ENDPOINT } from './helpers.js';

const ID = '01J9TEST000000000000000001';

interface UploadResponseBody {
  applied: number;
  rejected: Array<{ index: number; code: string; message: string; table?: string; id?: string }>;
}

function buildApp(mock: MockPool): Hono {
  return createApp({
    pool: mock.pool,
    ownerToken: OWNER_TOKEN,
    jwtSecret: JWT_SECRET,
    syncEndpoint: SYNC_ENDPOINT,
    now: () => NOW,
  });
}

async function postUpload(app: Hono, body: unknown): Promise<Response> {
  return app.request('/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OWNER_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

const put = (id: string, table: string, opData: Record<string, unknown> = {}) => ({
  op: 'PUT',
  id,
  table,
  opData,
});
const patch = (id: string, table: string, opData: Record<string, unknown> = {}) => ({
  op: 'PATCH',
  id,
  table,
  opData,
});
const del = (id: string, table: string) => ({ op: 'DELETE', id, table, opData: null });

// ---------------------------------------------------------------------------
// Mutable tables
// ---------------------------------------------------------------------------

describe('upload apply — mutable tables', () => {
  it('PUT upserts the row (catalog column order, all values bound as parameters)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, {
      ops: [
        put(ID, 'inbox_items', {
          // deliberately out of catalog order: the SQL must follow the catalog
          title: 'buy milk',
          created_at: NOW_ISO,
          updated_at: NOW_ISO,
          deleted_at: null,
          captured_at: NOW_ISO,
        }),
      ],
    });
    expect(res.status).toBe(200);
    expect(mock.queries.map((q) => q.text)).toEqual([
      'BEGIN',
      'INSERT INTO inbox_items (id, created_at, updated_at, deleted_at, title, captured_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET ' +
        'created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, ' +
        'deleted_at = EXCLUDED.deleted_at, title = EXCLUDED.title, ' +
        'captured_at = EXCLUDED.captured_at',
      'COMMIT',
    ]);
    const upsert = mock.queries[1];
    expect(upsert).toBeDefined();
    expect(upsert?.values).toEqual([ID, NOW_ISO, NOW_ISO, null, 'buy milk', NOW_ISO]);
    const body = (await res.json()) as UploadResponseBody;
    expect(body).toEqual({ applied: 1, rejected: [] });
  });

  it('PATCH upserts ONLY the provided columns (partial row, last-wins)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, {
      ops: [patch(ID, 'next_actions', { status: 'done', updated_at: NOW_ISO })],
    });
    expect(res.status).toBe(200);
    const upsert = mock.queries[1];
    expect(upsert?.text).toBe(
      'INSERT INTO next_actions (id, updated_at, status) VALUES ($1, $2, $3) ' +
        'ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, ' +
        'status = EXCLUDED.status',
    );
    expect(upsert?.values).toEqual([ID, NOW_ISO, 'done']);
  });

  it('DELETE soft-deletes via deleted_at (a DELETE FROM is never issued)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [del(ID, 'projects')] });
    expect(res.status).toBe(200);
    expect(mock.queries.map((q) => q.text)).toEqual([
      'BEGIN',
      'UPDATE projects SET deleted_at = $2 WHERE id = $1',
      'COMMIT',
    ]);
    expect(mock.queries[1]?.values).toEqual([ID, NOW_ISO]);
    expect(mock.queries.every((q) => !q.text.includes('DELETE FROM'))).toBe(true);
  });

  it('drops opData keys that are not declared columns (no SQL injection via names)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, {
      ops: [put(ID, 'contexts', { name: 'home', hacker: 'x', context_ids: 'injected' })],
    });
    expect(res.status).toBe(200);
    const upsert = mock.queries[1];
    expect(upsert?.text).toBe(
      'INSERT INTO contexts (id, name) VALUES ($1, $2) ' +
        'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
    );
    expect(upsert?.values).toEqual([ID, 'home']);
  });

  it('a PUT with only undeclared columns is an applied no-op (no DML)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [put(ID, 'contexts', { hacker: 'x' })] });
    expect(res.status).toBe(200);
    expect(mock.queries.map((q) => q.text)).toEqual(['BEGIN', 'COMMIT']);
    const body = (await res.json()) as UploadResponseBody;
    expect(body).toEqual({ applied: 1, rejected: [] });
  });
});

// ---------------------------------------------------------------------------
// Append-only tables
// ---------------------------------------------------------------------------

describe('upload apply — append-only tables (review_records / completion_records)', () => {
  it('PUT inserts the audit row (ON CONFLICT DO NOTHING — first write wins)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, {
      ops: [
        put(ID, 'completion_records', {
          action_kind: 'next',
          action_id: '01J9TEST0000000000000000AA',
          completed_at: NOW_ISO,
          est_minutes: 25,
          created_at: NOW_ISO,
          updated_at: NOW_ISO,
          deleted_at: null,
        }),
      ],
    });
    expect(res.status).toBe(200);
    expect(mock.queries[1]?.text).toBe(
      'INSERT INTO completion_records (id, created_at, updated_at, deleted_at, action_kind, ' +
        'action_id, completed_at, est_minutes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ' +
        'ON CONFLICT (id) DO NOTHING',
    );
  });

  it('PATCH is REJECTED — 2xx, and the op is NOT applied', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, {
      ops: [patch(ID, 'completion_records', { est_minutes: 99 })],
    });
    expect(res.status).toBe(200); // 2xx-on-rejection
    const body = (await res.json()) as UploadResponseBody;
    expect(body.applied).toBe(0);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        index: 0,
        code: 'upload.append-only',
        table: 'completion_records',
        id: ID,
      }),
    ]);
    // Only the transaction boundaries ran — no DML for the rejected op.
    expect(mock.queries.map((q) => q.text)).toEqual(['BEGIN', 'COMMIT']);
  });

  it('DELETE is REJECTED — 2xx, and the op is NOT applied', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [del(ID, 'review_records')] });
    expect(res.status).toBe(200); // 2xx-on-rejection
    const body = (await res.json()) as UploadResponseBody;
    expect(body.applied).toBe(0);
    expect(body.rejected).toEqual([
      expect.objectContaining({ index: 0, code: 'upload.append-only', table: 'review_records' }),
    ]);
    expect(mock.queries.map((q) => q.text)).toEqual(['BEGIN', 'COMMIT']);
  });
});

// ---------------------------------------------------------------------------
// 2xx-on-rejection protocol
// ---------------------------------------------------------------------------

describe('upload apply — the 2xx-on-rejection protocol', () => {
  it('a rejected op does not block the applied ops in the same batch', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, {
      ops: [
        patch(ID, 'completion_records', { est_minutes: 99 }), // rejected
        put('01J9TEST000000000000000002', 'inbox_items', {
          title: 'still applied',
          created_at: NOW_ISO,
          updated_at: NOW_ISO,
          deleted_at: null,
          captured_at: NOW_ISO,
        }), // applied
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadResponseBody;
    expect(body.applied).toBe(1);
    expect(body.rejected).toEqual([
      expect.objectContaining({ index: 0, code: 'upload.append-only' }),
    ]);
    const dml = mock.queries.filter((q) => !['BEGIN', 'COMMIT'].includes(q.text));
    expect(dml).toHaveLength(1);
    expect(dml[0]?.text).toContain('INSERT INTO inbox_items');
  });

  it('an unknown table is rejected with 2xx (never 4xx/5xx for a bad op)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [put(ID, 'no_such_table', { a: 1 })] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadResponseBody;
    expect(body).toEqual({
      applied: 0,
      rejected: [expect.objectContaining({ index: 0, code: 'upload.unknown-table', table: 'no_such_table' })],
    });
    expect(mock.queries.map((q) => q.text)).toEqual(['BEGIN', 'COMMIT']);
  });

  it('a DELETE on an unknown table is rejected with 2xx', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [del(ID, 'ghost_table')] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadResponseBody;
    expect(body.rejected).toEqual([
      expect.objectContaining({ index: 0, code: 'upload.unknown-table' }),
    ]);
  });

  it.each([
    ['missing id', { op: 'PUT', table: 'inbox_items', opData: {} }],
    ['bad op type', { op: 'UPSERT', id: ID, table: 'inbox_items', opData: {} }],
    ['PUT with null opData', { op: 'PUT', id: ID, table: 'inbox_items', opData: null }],
    ['PATCH with a string opData', { op: 'PATCH', id: ID, table: 'inbox_items', opData: 'oops' }],
  ])('a malformed op (%s) is rejected with 2xx and not applied', async (_label, badOp) => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [badOp] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadResponseBody;
    expect(body.applied).toBe(0);
    expect(body.rejected).toEqual([expect.objectContaining({ index: 0, code: 'upload.malformed-op' })]);
    expect(mock.queries.map((q) => q.text)).toEqual(['BEGIN', 'COMMIT']);
  });

  it('a non-object op entry is rejected with 2xx', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: ['garbage'] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadResponseBody;
    expect(body.rejected).toEqual([expect.objectContaining({ code: 'upload.malformed-op' })]);
  });

  it('a DELETE op with opData null (the client shape) is a valid soft-delete', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [del(ID, 'contexts')] });
    expect(res.status).toBe(200);
    expect(mock.queries[1]?.text).toBe('UPDATE contexts SET deleted_at = $2 WHERE id = $1');
  });

  it('an empty ops array is a 2xx no-op', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { ops: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadResponseBody;
    expect(body).toEqual({ applied: 0, rejected: [] });
    expect(mock.queries.map((q) => q.text)).toEqual(['BEGIN', 'COMMIT']);
  });

  it('a transient DB failure → 500 (client blocks + retries) and the batch rolls back', async () => {
    const mock = createMockPool({ failNextQueries: 1 });
    const app = buildApp(mock);
    const res = await postUpload(app, {
      ops: [put(ID, 'inbox_items', { title: 't', created_at: NOW_ISO, updated_at: NOW_ISO })],
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('server.transient-failure');
    const texts = mock.queries.map((q) => q.text);
    expect(texts).toContain('ROLLBACK');
    expect(texts).not.toContain('COMMIT');
  });

  it('a malformed JSON body → 400 (protocol error, not a rejected op)', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OWNER_TOKEN}` },
      body: 'this is not json',
    });
    expect(res.status).toBe(400);
    expect(mock.queries).toEqual([]);
  });

  it('a body without an ops array → 400', async () => {
    const mock = createMockPool();
    const app = buildApp(mock);
    const res = await postUpload(app, { noOps: true });
    expect(res.status).toBe(400);
    expect(mock.queries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Catalog parity with the client schema
// ---------------------------------------------------------------------------

/**
 * Expected table/column sets — copied from packages/db/src/schema.ts (the
 * source of truth; the server re-declares them because Rule 1 forbids the
 * import). If schema.ts changes, this table changes with it (one change
 * unit) and the drift fails here.
 */
const EXPECTED_CLIENT_SCHEMA: Record<string, readonly string[]> = {
  inbox_items: ['created_at', 'updated_at', 'deleted_at', 'title', 'captured_at'],
  projects: ['created_at', 'updated_at', 'deleted_at', 'title', 'outcome', 'value', 'status', 'deadline'],
  next_actions: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'project_id',
    'context_ids',
    'est_minutes',
    'value',
    'category',
    'due_date',
    'deadline',
    'depends_on_id',
    'window_start',
    'window_end',
    'window_days',
    'snoozed_until',
    'last_snoozed_at',
    'consecutive_skips',
    'last_skipped_at',
    'status',
    'source_inbox_id',
    'replaces_action_id',
    'note',
  ],
  waiting_for_items: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'waiting_on',
    'expected_by',
    'follow_up_at',
  ],
  calendar_actions: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'starts_at',
    'context_ids',
    'est_minutes',
    'value',
    'category',
    'deadline',
    'snoozed_until',
    'last_snoozed_at',
    'consecutive_skips',
    'last_skipped_at',
    'status',
    'source_inbox_id',
    'replaces_action_id',
    'note',
  ],
  someday_maybe_items: ['created_at', 'updated_at', 'deleted_at', 'title', 'note'],
  reference_items: ['created_at', 'updated_at', 'deleted_at', 'title', 'url', 'note'],
  contexts: ['created_at', 'updated_at', 'deleted_at', 'name'],
  habits: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'action_title',
    'est_minutes',
    'value',
    'category',
    'project_id',
    'window_start',
    'window_end',
    'window_days',
    'cycle_days',
    'started_at',
    'status',
  ],
  habit_days: [
    'created_at',
    'updated_at',
    'deleted_at',
    'habit_id',
    'local_date',
    'status',
    'snoozed_until',
    'last_snoozed_at',
    'consecutive_skips',
    'last_skipped_at',
  ],
  reminders: [
    'created_at',
    'updated_at',
    'deleted_at',
    'action_kind',
    'action_id',
    'fires_at',
    'intensity',
    'state',
  ],
  focus_sessions: [
    'created_at',
    'updated_at',
    'deleted_at',
    'action_id',
    'action_kind',
    'mode',
    'planned_minutes',
    'started_at',
    'paused_sec',
    'ended_at',
    'status',
  ],
  review_records: ['created_at', 'updated_at', 'deleted_at', 'kind', 'at', 'snapshot', 'answers'],
  completion_records: [
    'created_at',
    'updated_at',
    'deleted_at',
    'action_kind',
    'action_id',
    'completed_at',
    'est_minutes',
  ],
};

describe('table catalog — parity with packages/db/src/schema.ts', () => {
  it('declares exactly the 14 client tables', () => {
    const serverTables = Object.keys({ ...MUTABLE_TABLES, ...APPEND_ONLY_TABLES }).sort();
    expect(serverTables).toEqual(Object.keys(EXPECTED_CLIENT_SCHEMA).sort());
  });

  it('declares exactly the client columns per table (id excluded)', () => {
    for (const [table, expectedColumns] of Object.entries(EXPECTED_CLIENT_SCHEMA)) {
      const serverColumns = [
        ...(MUTABLE_TABLES[table] ?? []),
        ...(APPEND_ONLY_TABLES[table] ?? []),
      ];
      expect(serverColumns).toEqual(expectedColumns);
    }
  });

  it('splits append-only exactly on completion_records + review_records (focus_sessions stays mutable)', () => {
    expect(Object.keys(APPEND_ONLY_TABLES).sort()).toEqual([
      'completion_records',
      'review_records',
    ]);
    expect(MUTABLE_TABLES['focus_sessions']).toBeDefined();
    expect(APPEND_ONLY_TABLES['focus_sessions']).toBeUndefined();
  });
});
