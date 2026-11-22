/**
 * Schema-level tests: the audit-trail tables (spec:
 * app/database-guidelines.md "Upload conflict policy v1" — append-only) and
 * the crud-queue behavior for them.
 *
 * `review_records` and `completion_records` are append-only, but they are
 * deliberately declared as REGULAR upsert tables — NOT `Table.createInsertOnly`.
 * PowerSync's createInsertOnly never applies a local write to the local DB
 * (its INSTEAD-OF trigger only enqueues the CRuDe op), so the rows would be
 * unreadable offline until a server round-trip, violating the "works with no
 * network" rule. The append-only guarantee is enforced at the server /upload
 * endpoint. Here we assert that NO table uses createInsertOnly, and that
 * INSERTs into an audit-trail table drain through `getNextCrudTransaction` as
 * normal PUT ops (the upload path is unaffected).
 */
import { AppSchema, type Database } from '../schema';
import { createNodeTestDatabase } from './powersync-node';

const NOW = '2026-09-21T00:00:00.000Z';

describe('AppSchema shape', () => {
  it('declares the 15 MVP tables', () => {
    const names = AppSchema.tables.map((table) => table.name).sort();
    expect(names).toEqual(
      [
        'calendar_actions',
        'completion_records',
        'contexts',
        'focus_sessions',
        'habit_days',
        'habits',
        'inbox_items',
        'next_actions',
        'projects',
        'reference_items',
        'reminders',
        'review_records',
        'settings',
        'someday_maybe_items',
        'waiting_for_items',
      ].sort(),
    );
  });

  it('deliberately avoids createInsertOnly (audit trails stay locally readable)', () => {
    // PowerSync's createInsertOnly never applies a local write to the local
    // DB, which would leave the append-only audit trails unreadable offline
    // until a server round-trip. They are regular upsert tables instead; the
    // append-only guarantee is enforced at the server /upload endpoint.
    const insertOnly = AppSchema.tables.filter((table) => table.insertOnly).map((table) => table.name);
    expect(insertOnly).toEqual([]);
  });
});

describe('audit-trail tables and the crud queue', () => {
  it('INSERTs into an audit-trail table drain as one crud transaction', async () => {
    const { powersync, kysely, close } = await createNodeTestDatabase<Database>(AppSchema);
    try {
      await kysely
        .insertInto('review_records')
        .values({
          id: 'r1',
          created_at: NOW,
          updated_at: NOW,
          deleted_at: null,
          kind: 'daily',
          at: NOW,
          snapshot: '{}',
          answers: '{}',
        })
        .execute();

      const tx = await powersync.getNextCrudTransaction();
      expect(tx).not.toBeNull();
      expect(tx?.crud).toHaveLength(1);
      expect(tx?.crud[0]).toMatchObject({ op: 'PUT', id: 'r1', table: 'review_records' });
      if (tx !== null) {
        await tx.complete();
      }
      expect(await powersync.getNextCrudTransaction()).toBeNull();
    } finally {
      await close();
    }
  }, 20_000);
});
