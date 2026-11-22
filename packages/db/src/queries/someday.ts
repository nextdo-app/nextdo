/**
 * SomedayMaybeItem queries (spec: domain/domain-model.md "SomedayMaybeItem").
 * "以后可能做" — the weekly review re-asks: promote, keep, or trash.
 */
import {
  NEXT_ACTION_DEFAULT_VALUE,
  SOMEDAY_PROMOTION_DEFAULT_EST_MINUTES,
  StorageNextdoError,
  assertValidNextAction,
  assertValidProject,
  assertValidSomedayMaybeItem,
  toIso,
  ulid,
  type NextAction,
  type Project,
  type SomedayMaybeItem,
  type SomedayPromotion,
  type Value,
} from '@nextdo/core';
import type { Kysely } from 'kysely';
import {
  nextActionToRow,
  projectToRow,
  somedayMaybeItemFromRow,
  somedayMaybeItemToRow,
  type Database,
} from '../schema';
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

// ---------------------------------------------------------------------------
// Promotion (issue #91)
// ---------------------------------------------------------------------------

export interface SomedayPromotionResult {
  somedayId: string;
  projectId?: string;
  actionId?: string;
  /** The source item's note, when it had one — the review record keeps it. */
  sourceNote?: string;
}

function buildPromotedNextAction(input: {
  now: Date;
  title: string;
  estMinutes?: number;
  value?: Value;
  projectId?: string;
  note?: string;
}): NextAction {
  const nowIso = toIso(input.now);
  const action: NextAction = {
    id: ulid(input.now),
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    title: input.title,
    projectId: input.projectId,
    contextIds: [],
    estMinutes: input.estMinutes ?? SOMEDAY_PROMOTION_DEFAULT_EST_MINUTES,
    value: input.value ?? NEXT_ACTION_DEFAULT_VALUE,
    consecutiveSkips: 0,
    status: 'open',
    // A parked action kept its note; promotion must not drop that context.
    note: input.note,
  };
  // Core owns the title/estimate/value rules; a promoted row obeys them
  // exactly like a clarified one.
  assertValidNextAction(action);
  return action;
}

/**
 * Turn one live Someday item into a NextAction or a Project (issue #91).
 *
 * Runs inside the CALLER'S transaction: the weekly review composes it with
 * the review-record INSERT, so a failed submission leaves neither a created
 * row nor a trashed Someday item behind. Ordering inside: create the target
 * row(s) first, soft-delete the Someday item last — any throw aborts the
 * whole transaction.
 *
 * Defaults come from the domain: title = the Someday title, estimate = 10
 * minutes, value = 3. A project REQUIRES a non-empty outcome (core's
 * `assertValidProject`); this function does not invent one.
 */
export async function promoteSomedayMaybeItemInTransaction(
  db: Kysely<Database>,
  args: { id: string; to: 'action' | 'project'; promotion?: SomedayPromotion; now: Date },
): Promise<SomedayPromotionResult> {
  const { id, to, promotion, now } = args;
  // Throws somedayMaybeItem.not-found when the row is missing or trashed —
  // before anything is written.
  const someday = somedayMaybeItemFromRow(await loadRow(db, id));
  const nowIso = toIso(now);
  const title = (promotion?.title ?? someday.title).trim();

  if (to === 'action') {
    const action = buildPromotedNextAction({
      now,
      title,
      estMinutes: promotion?.estMinutes,
      value: promotion?.value,
      note: someday.note,
    });
    await db
      .insertInto('next_actions')
      .values({ id: action.id, ...nextActionToRow(action) })
      .execute();
    await trashSomedayMaybeItem(db, { id, now });
    return { somedayId: id, actionId: action.id, sourceNote: someday.note };
  }

  const project: Project = {
    id: ulid(now),
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    title,
    outcome: (promotion?.outcome ?? '').trim(),
    value: promotion?.value ?? NEXT_ACTION_DEFAULT_VALUE,
    status: 'active',
  };
  assertValidProject(project);
  await db
    .insertInto('projects')
    .values({ id: project.id, ...projectToRow(project) })
    .execute();

  let actionId: string | undefined;
  if (promotion?.firstAction !== undefined) {
    const first = promotion.firstAction;
    const action = buildPromotedNextAction({
      now,
      title: (first.title ?? project.title).trim(),
      estMinutes: first.estMinutes,
      value: promotion.value,
      projectId: project.id,
      note: someday.note,
    });
    await db
      .insertInto('next_actions')
      .values({ id: action.id, ...nextActionToRow(action) })
      .execute();
    actionId = action.id;
  }

  await trashSomedayMaybeItem(db, { id, now });
  return { somedayId: id, projectId: project.id, actionId, sourceNote: someday.note };
}
