/**
 * Watched-query builders for the app's data hooks (the `@powersync/react`
 * boundary — database-guidelines). Each returns a `CompilableQuery` (see
 * `../watch-query.ts`) that the app passes straight to `useQuery`; the app
 * never builds Kysely itself.
 *
 * These are the READ-path queries the mobile shell renders. They mirror the
 * plain (non-reactive) list functions in the per-aggregate query modules but
 * are expressed as watchable queries so the React hooks update live.
 */
import { sql } from 'kysely';
import type { InboxItem, Project, ReviewRecord, WaitingForItem } from '@nextdo/core';
import type { CompilableQuery } from '@powersync/common';
import {
  inboxItemFromRow,
  parseJson,
  projectFromRow,
  reviewRecordFromRow,
  waitingForItemFromRow,
} from '../schema';
import { toCompilableQuery } from '../watch-query';
import { poolWatchQuery } from './pool';
import type { NextdoDb } from '../types';

/** Inbox capture list (raw, non-deleted InboxItems, oldest first). */
export function inboxItemsWatchQuery(db: NextdoDb): CompilableQuery<InboxItem> {
  const builder = db
    .selectFrom('inbox_items')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('captured_at');
  return toCompilableQuery(builder, inboxItemFromRow);
}

/** A project plus its derived action-coverage flag (coverage is always
 *  derived, never stored — domain-model.md). `hasOpenAction` is true when the
 *  project has ≥ 1 open, non-deleted NextAction. */
export interface ProjectWithCoverage extends Project {
  hasOpenAction: boolean;
}

/** Project list with the derived `hasOpenAction` coverage flag. The explicit
 *  column list (schema.ts is the source of truth — a schema change breaks
 *  `projectFromRow`'s type check until this follows) plus the scalar
 *  subquery keep the query a single statement, so PowerSync's table-dependency
 *  tracking re-fires the watch on changes to either `projects` or
 *  `next_actions`. */
export function projectsWatchQuery(db: NextdoDb): CompilableQuery<ProjectWithCoverage> {
  const builder = db
    .selectFrom('projects')
    .select([
      'id',
      'created_at',
      'updated_at',
      'deleted_at',
      'title',
      'outcome',
      'value',
      'status',
      'deadline',
      sql<number>`(SELECT COUNT(*) FROM next_actions na
        WHERE na.project_id = projects.id
          AND na.status = 'open'
          AND na.deleted_at IS NULL)`.as('open_action_count'),
    ])
    .where('deleted_at', 'is', null)
    .orderBy('created_at');
  return toCompilableQuery(builder, (row) => ({
    ...projectFromRow(row),
    hasOpenAction: row.open_action_count > 0,
  }));
}

/**
 * A project rendered as a Projects-screen card (design §4.1): the Project
 * plus its derived action stats. `progress` is NOT a field — the screen
 * derives it from the counts (completedCount / (openCount + completedCount),
 * 0 when there is no action); and `stalled` is not derived here either:
 * the watch mapper does not re-run on the app clock's minute tick, so the
 * screen computes it with the exported `isStalled` (queries/reviews.ts)
 * against its own `now` (hook-guidelines Rule 4 — precedent:
 * `shouldOfferReclarify` exported from use-now.ts).
 */
export interface ProjectCard extends Project {
  openCount: number;
  /** Non-deleted actions with status = 'done' (the domain's completed
   *  status — ActionStatus is 'open' | 'done'). */
  completedCount: number;
  /** MIN(deadline) over the OPEN actions that carry a deadline. */
  earliestOpenDeadline: string | null;
  /** The latest completion (append-only `completion_records`) over the
   *  project's actions; null when none of them was ever completed.
   *  (next_actions has no completed_at column.) */
  lastProgressAt: string | null;
  /** The current next action — the best OPEN action per "earliest, most
   *  certain first" (deadline-null last, then deadline, then created_at);
   *  null when the project has no open action. */
  nextAction: {
    id: string;
    title: string;
    contextIds: string[];
    deadline: string | null;
    estMinutes: number;
  } | null;
}

/**
 * Project list with the derived card stats — same single-statement +
 * scalar-subquery pattern as `projectsWatchQuery`, so PowerSync's
 * table-dependency tracking re-fires the watch on changes to `projects`,
 * `next_actions` AND `completion_records`.
 *
 * The five next-action subqueries are ONE selection repeated (identical
 * WHERE + ORDER BY … LIMIT 1), so they always pick the same row:
 * deadline-null sorts last, ties break by capture time. Only OPEN
 * non-deleted actions qualify — a done action is not a next action (a
 * project whose actions are all done has `nextAction: null`).
 */
export function projectCardsWatchQuery(db: NextdoDb): CompilableQuery<ProjectCard> {
  const NA_PROJECT = 'na.project_id = projects.id AND na.deleted_at IS NULL';
  const NA_OPEN = `${NA_PROJECT} AND na.status = 'open'`;
  const NEXT_ACTION_ORDER =
    'ORDER BY (na.deadline IS NULL) ASC, na.deadline ASC, na.created_at ASC LIMIT 1';
  const builder = db
    .selectFrom('projects')
    .select([
      'id',
      'created_at',
      'updated_at',
      'deleted_at',
      'title',
      'outcome',
      'value',
      'status',
      'deadline',
      sql<number> `(SELECT COUNT(*) FROM next_actions na WHERE ${sql.raw(NA_OPEN)})`.as('open_count'),
      sql<number> `(SELECT COUNT(*) FROM next_actions na
        WHERE ${sql.raw(NA_PROJECT)} AND na.status = 'done')`.as('completed_count'),
      sql<string | null> `(SELECT MIN(na.deadline) FROM next_actions na
        WHERE ${sql.raw(NA_OPEN)} AND na.deadline IS NOT NULL)`.as('earliest_open_deadline'),
      sql<string | null> `(SELECT MAX(cr.completed_at) FROM completion_records cr
        JOIN next_actions na ON na.id = cr.action_id
        WHERE ${sql.raw(NA_PROJECT)})`.as('last_progress_at'),
      sql<string | null> `(SELECT na.id FROM next_actions na
        WHERE ${sql.raw(NA_OPEN)} ${sql.raw(NEXT_ACTION_ORDER)})`.as('next_action_id'),
      sql<string | null> `(SELECT na.title FROM next_actions na
        WHERE ${sql.raw(NA_OPEN)} ${sql.raw(NEXT_ACTION_ORDER)})`.as('next_action_title'),
      sql<string | null> `(SELECT na.deadline FROM next_actions na
        WHERE ${sql.raw(NA_OPEN)} ${sql.raw(NEXT_ACTION_ORDER)})`.as('next_action_deadline'),
      sql<number | null> `(SELECT na.est_minutes FROM next_actions na
        WHERE ${sql.raw(NA_OPEN)} ${sql.raw(NEXT_ACTION_ORDER)})`.as('next_action_est_minutes'),
      sql<string | null> `(SELECT na.context_ids FROM next_actions na
        WHERE ${sql.raw(NA_OPEN)} ${sql.raw(NEXT_ACTION_ORDER)})`.as('next_action_context_ids'),
    ])
    .where('deleted_at', 'is', null)
    .orderBy('created_at');
  return toCompilableQuery(builder, (row) => ({
    ...projectFromRow(row),
    openCount: row.open_count,
    completedCount: row.completed_count,
    earliestOpenDeadline: row.earliest_open_deadline,
    lastProgressAt: row.last_progress_at,
    nextAction:
      row.next_action_id === null
        ? null
        : {
            id: row.next_action_id,
            title: row.next_action_title ?? '',
            contextIds: parseJson<string[]>(row.next_action_context_ids, []),
            deadline: row.next_action_deadline,
            estMinutes: row.next_action_est_minutes ?? 0,
          },
  }));
}

/** Review record list (append-only audit trail, oldest first). */
export function reviewRecordsWatchQuery(db: NextdoDb): CompilableQuery<ReviewRecord> {
  const builder = db
    .selectFrom('review_records')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('at');
  return toCompilableQuery(builder, (row) => reviewRecordFromRow(row).record);
}

/**
 * Invalidation trigger for the engine pool (see `useActionPool`): one row per
 * pool-relevant table. The rows themselves are unused — the hook recomputes
 * the pool with `queryEnginePool` whenever this watch fires (data change) or
 * the app clock ticks. The union keeps every source table in the SQL so
 * PowerSync tracks all of them as dependencies.
 */
export function poolTriggerWatchQuery(db: NextdoDb): CompilableQuery<{ id: string }> {
  return toCompilableQuery(poolWatchQuery(db));
}

/**
 * WaitingForItem watch query (live, non-deleted items, newest first).
 */
export function waitingForWatchQuery(db: NextdoDb): CompilableQuery<WaitingForItem> {
  const builder = db
    .selectFrom('waiting_for_items')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc');
  return toCompilableQuery(builder, waitingForItemFromRow);
}

