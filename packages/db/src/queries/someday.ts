/**
 * SomedayMaybeItem queries (spec: domain/domain-model.md "SomedayMaybeItem").
 * "以后可能做" — the weekly review re-asks: promote (via Clarify), keep, or
 * trash.
 */
import {
  StorageNextdoError,
  assertValidSomedayMaybeItem,
  toIso,
  type SomedayMaybeItem,
} from '@nextdo/core';
import type { Kysely } from 'kysely';
import { somedayMaybeItemFromRow, somedayMaybeItemToRow, type Database } from '../schema';
import type { NextdoDb } from '../types';

async function loadRow(db: Kysely<Database>, id: string) {
  const row = await db
    .selectFrom('someday_maybe_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('somedayMaybeItem.not-found', `No live SomedayMaybeItem with id ${id}`);
  }
  return row;
}

export async function listSomedayMaybeItems(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<SomedayMaybeItem[]> {
  let query = db.selectFrom('someday_maybe_items').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(somedayMaybeItemFromRow);
}

export async function addSomedayMaybeItem(
  db: NextdoDb,
  item: SomedayMaybeItem,
): Promise<SomedayMaybeItem> {
  assertValidSomedayMaybeItem(item);
  await db
    .insertInto('someday_maybe_items')
    .values({ id: item.id, ...somedayMaybeItemToRow(item) })
    .execute();
  return item;
}

export async function updateSomedayMaybeItem(
  db: NextdoDb,
  item: SomedayMaybeItem,
): Promise<SomedayMaybeItem> {
  assertValidSomedayMaybeItem(item);
  await loadRow(db, item.id);
  await db
    .updateTable('someday_maybe_items')
    .set({ ...somedayMaybeItemToRow(item) })
    .where('id', '=', item.id)
    .execute();
  return item;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). */
export async function trashSomedayMaybeItem(
  db: Kysely<Database>,
  args: { id: string; now: Date },
): Promise<void> {
  const nowIso = toIso(args.now);
  await loadRow(db, args.id);
  await db
    .updateTable('someday_maybe_items')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}
