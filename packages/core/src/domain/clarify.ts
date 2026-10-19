/**
 * The Clarify decision table (spec: domain-model.md §Clarify — complete,
 * no implicit branches).
 *
 * Pure classification: given the user's answers, which target row(s)
 * must the (single) DB transaction create? The DB layer applies the
 * outcome; the target row carries `sourceInboxId` for traceability.
 */
import { ValidationNextdoError } from '../lib/errors';

/** Default value for the two-minute "DO NOW → became a NextAction" path. */
export const NEXT_ACTION_DEFAULT_VALUE = 3 as const;

/**
 * Issue #62: what kind of action the user picked in the action form.
 * `waiting` / `delegated` become a WaitingForItem (never a NextAction);
 * `none` means "project without a first action" (project form only).
 */
export type ClarifyActionType = 'next' | 'waiting' | 'delegated' | 'none';

export interface ClarifyAnswers {
  /** Q1: 可以行动吗？ */
  actionable: boolean;
  /** Issue #62: 行动类型（缺省视作 `next`）。 */
  actionType?: ClarifyActionType;
  /** Q1 follow-up, required when `actionable === false`. */
  nonActionableKind?: 'reference' | 'someday' | 'trash';
  /** Q2, actionable only: 这件事属于某个项目吗？ (wizard q2) */
  inProject: boolean;
  /**
   * Q3, `inProject` only: 新建项目，还是加到已有项目？ (wizard q2b) —
   * `'new'` creates the Project (+ its first NextAction); `'existing'`
   * attaches the NextAction to `projectId` (wizard q2c). Absent while
   * `inProject` is true = incomplete answers (no implicit branch).
   */
  projectChoice?: 'new' | 'existing';
  /** Required when `projectChoice === 'new'`: the project outcome (what "done" means). */
  projectOutcome?: string;
  /** Q3, single-step only: 约 2 分钟内能完成吗？ */
  twoMinutes: boolean;
  /** Q3 follow-up: completed on the spot? */
  completedOnTheSpot?: boolean;
  /** Q4, not two-minute only: 应该由我完成吗？ */
  myResponsibility: boolean;
  /** Q5, my responsibility only: 必须在特定日期/时间执行吗？ */
  fixedTime: boolean;
  /**
   * Required when `projectChoice === 'existing'` (wizard q2c): the project
   * to attach to. Only meaningful with `inProject === true` — a stray id
   * alongside `inProject === false` ("不属于项目") is ignored, and
   * re-clarify's explicit `null` means the same thing: no attachment.
   */
  projectId?: string | null;
}

export type ClarifyOutcome =
  | { kind: 'reference' }
  | { kind: 'someday' }
  | { kind: 'trash' }
  /**
   * DO NOW, completed on the spot: CompletionRecord(actionKind="do_now",
   * actionId = sourceInboxId) + trash the InboxItem. No action entity.
   */
  | { kind: 'do-now-completed' }
  /**
   * Two-minute, not completed on the spot → NextAction with
   * value = NEXT_ACTION_DEFAULT_VALUE; questions 4–5 do not apply.
   */
  | { kind: 'next-action'; source: 'two-minute' }
  /**
   * Q2b/q2c: attach to an EXISTING project — the db layer validates the
   * project (exists / live / active) and defaults the value to the
   * project's value.
   * Questions 4–5 do not apply (v1: CalendarAction has no projectId, and
   * re-asking responsibility for a project action is redundant).
   */
  | { kind: 'next-action'; source: 'project-attach' }
  | { kind: 'project' }
  | { kind: 'waiting-for' }
  | { kind: 'calendar-action' }
  | { kind: 'next-action'; source: 'clarified' };

/**
 * Walk the decision table. Throws ValidationNextdoError when the answers
 * are incomplete for the branch taken: an in-project item without a
 * `projectChoice` (`clarify.incomplete`), an attach without a project id
 * (`clarify.project-required`), or a new project without an outcome
 * (`project.needs-outcome`).
 */
export function classifyInboxItem(answers: ClarifyAnswers): ClarifyOutcome {
  if (!answers.actionable) {
    switch (answers.nonActionableKind) {
      case 'reference':
        return { kind: 'reference' };
      case 'someday':
        return { kind: 'someday' };
      case 'trash':
        return { kind: 'trash' };
      default:
        throw new ValidationNextdoError(
          'clarify.incomplete',
          'Non-actionable items require nonActionableKind: reference | someday | trash',
        );
    }
  }

  // Issue #62: an action marked waiting/delegated is a WaitingForItem — it
  // is not the user's next action, so the project questions do not apply.
  if (answers.actionType === 'waiting' || answers.actionType === 'delegated') {
    return { kind: 'waiting-for' };
  }

  if (answers.inProject) {
    switch (answers.projectChoice) {
      case 'existing':
        // Q2c: attach to an existing project — the id is what carries the
        // choice, so an empty one is incomplete, not "no attachment".
        if (typeof answers.projectId !== 'string' || answers.projectId === '') {
          throw new ValidationNextdoError(
            'clarify.project-required',
            'Attaching to an existing project requires projectId',
          );
        }
        return { kind: 'next-action', source: 'project-attach' };
      case 'new':
        if (answers.projectOutcome === undefined || answers.projectOutcome.trim() === '') {
          throw new ValidationNextdoError(
            'project.needs-outcome',
            'A project requires an outcome (what "done" means)',
          );
        }
        // Project + its first NextAction are created ATOMICALLY by the
        // caller. A stray projectId does not win over the new-project
        // choice.
        return { kind: 'project' };
      default:
        // No implicit branch: an in-project item must say which way.
        throw new ValidationNextdoError(
          'clarify.incomplete',
          "An in-project item requires projectChoice: 'new' | 'existing'",
        );
    }
  }

  if (answers.twoMinutes) {
    if (answers.completedOnTheSpot) {
      return { kind: 'do-now-completed' };
    }
    return { kind: 'next-action', source: 'two-minute' };
  }

  if (!answers.myResponsibility) {
    return { kind: 'waiting-for' };
  }

  return answers.fixedTime ? { kind: 'calendar-action' } : { kind: 'next-action', source: 'clarified' };
}
