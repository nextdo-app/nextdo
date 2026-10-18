# Next Action Engine

> The differentiating capability (Proposal §6). Answers: "given what the user has
> organized, what should I do **now**?" A **pure function** in
> `packages/core/src/engine` — no DB, no clock, no side effects. The app feeds it a
> snapshot; the app applies the user's decision via the `packages/db` transactions.

---

## Contract

```ts
// packages/core/src/engine/types.ts (shape, not literal code)

type CandidateKind = "next" | "habit" | "calendar";

interface CandidateBase {
  id: string;
  kind: CandidateKind;
  title: string;
  contextIds: string[];
  estMinutes: number;
  value: 1 | 2 | 3 | 4 | 5;
  category?: "work" | "health" | "life" | "other";
  projectId?: string;
  dependsOnId?: string;          // v1: at most one, direct
  windowStart?: string;          // "HH:mm", device-local
  windowEnd?: string;            // "HH:mm", device-local
  windowDays?: number[];         // 0=Sunday … 6=Saturday, device-local; undefined = every day
  dueDate?: string;              // ISO date (soft)
  deadline?: string;             // ISO datetime (exact moment; h = deadline − now)
  snoozedUntil?: string;         // ISO datetime
  consecutiveSkips: number;
  lastSkippedAt?: string;
  dependencyDone: boolean;       // resolved by the pool query (true when no dependency)
  createdAt: string;             // ISO datetime
  lastSnoozedAt?: string;
}
interface NextCandidate     extends CandidateBase { kind: "next" }
interface HabitCandidate    extends CandidateBase { kind: "habit"; habitId: string; cycleDay: number; cycleDays: number }
interface CalendarCandidate extends CandidateBase { kind: "calendar"; startsAt: string }
type CandidateAction = NextCandidate | HabitCandidate | CalendarCandidate;
// DB row → Candidate mapping lives in packages/db (queries build the pool);
// the engine never sees raw rows.
//
// Pool contract (enforced by the packages/db pool query, trusted by the engine):
//   - only open, non-deleted candidates — done/deleted filtering is the pool's job,
//     not the engine's;
//   - a `next_actions` row whose `project_id` points to a project that is not
//     active (or deleted/missing) is not a candidate; projectless actions,
//     CalendarActions (no projectId in v1) and today's HabitDays are unaffected;
//   - dependencyDone = the referenced action is done (or no dependency);
//   - the pool query tags CalendarBlocks that originate from an open CalendarAction
//     with its `sourceActionId`; the engine ignores a candidate's own block at check
//     time (one shared `calendar` array serves all candidates).

interface EngineInput {
  actions: CandidateAction[];    // open NextActions + today's open HabitDays + CalendarActions (today or starting soon)
  calendar: CalendarBlock[];     // hard schedule blocks — v1: other open CalendarActions
                                 // (manual time blocks + system-calendar import: post-MVP).
  projects: { id: string; value: number; status: string }[]; // ALL non-deleted projects (incl.
                                                             // non-active — the engine applies
                                                             // the `active` check itself)
  context: EngineContext;
  now: Date;                     // INJECTED — never Date.now()
}
interface CalendarBlock {
  start: string;                 // ISO datetime
  end: string;                   // ISO datetime
  sourceActionId?: string;       // set when the block originates from an open CalendarAction
}
interface EngineContext {
  contextIds: string[];          // where the user is: ["computer", "office"]
                                 // NOTE (#46): the app always feeds `[]` — the
                                 // 场景 UI is offline, so nothing is filtered by
                                 // location. The contract stays: `[]` means
                                 // "anywhere" and legacy tagged rows keep matching.
  availableMinutes: number;      // the time slot the user can give right now
}

type ReasonType = "score" | "eligibility";
interface Reason { type: ReasonType; code: ReasonCode; detail?: string }

interface ScoredAction {
  actionId: string;
  score: number;                 // deterministic; see formula
  reasons: Reason[];             // non-empty for every eligible action
}
interface FilteredAction { actionId: string; rule: FilterRuleId }

interface EngineOutput {
  recommended: ScoredAction | null;   // the ONE action for the Now screen
  eligible: ScoredAction[];           // hard-filter survivors, ranked — backs "换一个"
  filtered: FilteredAction[];         // exclusions + rule — explainability/debug
  needsReclarify: { actionId: string; consecutiveSkips: number }[];
}
```

`ReasonCode` = score codes (`deadline-urgency`, `goal-value`, `project-importance`,
`time-fit`, `waiting-time`, `habit-commitment`, `health-protection`) ∪ eligibility
codes (`context-match`, `window-open`, `time-fits`, `dependency-clear`,
`calendar-preempt`). `FilterRuleId` = the rule ids in the table below.

## Implementation (real files — task 09-21-monorepo-scaffold, 2026-09-21)

| Spec concept | File (`packages/core/src/engine/`) | Export |
|---|---|---|
| The contract above (verbatim shape) | `types.ts` | `CandidateAction`, `EngineInput`, `EngineOutput`, `Reason`, … |
| v1 weights `W` | `weights.ts` | `W` |
| Re-clarify threshold | `weights.ts` | `RECLARIFY_THRESHOLD = 3` |
| Hard filter (fixed order) + calendar preemption | `filters.ts` | `hardFilter()` → `{ ranked, preempted, filtered }` |
| Signals, score, score reasons | `rank.ts` | `SCORE_CODES`, `scoreCandidate()` |
| Orchestration (filter → preempt → rank → `needsReclarify`) + tie-breaks | `recommend.ts` | `recommend()` → `EngineOutput` |
| Shared test fixtures (fixed `now` = 2026-09-21T09:00Z) | `fixtures.ts` | `NOW`, `iso()`, `makeNext`/`makeHabit`/`makeCalendar` |

All public via `packages/core/src/index.ts` (explicit re-exports). Tests are
co-located (`filters.test.ts`, `rank.test.ts`, `recommend.test.ts`) — Jest with
the device-local pin done as `TZ=UTC` in the test script (`test-setup.ts`
documents why the script-level pin is the effective one). The `consecutiveSkips`
lifecycle (skip transaction; resets on complete/snooze/re-clarify) lives in the
mutation transactions of `packages/db/src/queries/actions.ts`
(`skipAction` / `completeAction` / `snoozeAction`) — the engine only reads the
counter.

## Hard Filter (Proposal §6.1) — fixed order, every exclusion recorded

(Candidates arrive per the pool contract — already open and non-deleted.)

| Rule id | Excludes when |
|---------|---------------|
| `snoozed` | `snoozedUntil > now` |
| `context-mismatch` | `context.contextIds.length > 0` and `action.contextIds.length > 0` and `action.contextIds ∩ context.contextIds = ∅` (empty user context matches any action; empty action context matches anywhere) |
| `too-long` | `estMinutes > context.availableMinutes` |
| `window-mismatch` | `windowStart/windowEnd` and/or `windowDays` set, and `now` (device-local) outside the window (weekday mask first, then HH:mm range) |
| `dependency` | `dependencyDone === false` |
| `calendar-conflict` | a fixed-time candidate overlaps a `CalendarBlock` with `sourceActionId !== candidate.id` (a candidate never conflicts with its own block; non-action blocks have no `sourceActionId`) |

**Calendar preemption** (Proposal §6.1, last item): a `CalendarCandidate` with
`startsAt` within the next 60 minutes is placed **first in `eligible` before ranking**
with a `calendar-preempt` eligibility reason; ranking applies to the rest. It stays in
`eligible`, so "换一个" still works.

## Value Ranking (Proposal §6.2) — fixed v1 weights, exact formula

Weights are a named constant in `packages/core/src/engine/weights.ts` (v1 defaults;
user-tunable later via the `settings` table):

```text
W = { deadline-urgency: 1.0, goal-value: 0.8, project-importance: 0.6,
      time-fit: 0.2, waiting-time: 0.2, habit-commitment: 0.5, health-protection: 0.4 }

score = Σ W[c] × signal(c)          (each signal in [0, 1])
```

| code | signal |
|------|--------|
| `deadline-urgency` | Hard deadline takes strict precedence over soft `dueDate`:<br>• **Hard `deadline`**: let `h = deadline − now`: `h ≤ 0` (overdue) → 1.0; `0 < h ≤ 24 h` → 0.9; `24 h < h ≤ 72 h` → 0.7; `72 h < h ≤ 168 h` → 0.4; `h > 168 h` → 0. Band edges are inclusive on the upper bound.<br>• **Soft `dueDate`** (fallback when no `deadline`): evaluated against local end-of-day (`23:59:59.999`), let `h = dueEndOfDay − now`: `h ≤ 0` (soft overdue) → 0.85; `0 < h ≤ 24 h` (due today) → 0.75; `24 h < h ≤ 72 h` (within 3 days) → 0.5; `72 h < h ≤ 168 h` (within 7 days) → 0.25; `h > 168 h` → 0. |
| `goal-value` | `value / 5` |
| `project-importance` | `project.value / 5` when `projectId` set and project `active`, else 0 |
| `time-fit` | `max(0, 1 − estMinutes / availableMinutes)` |
| `waiting-time` | `min(days(now − max(createdAt, lastSnoozedAt)), 14) / 14` (cap: 14 days) |
| `habit-commitment` | habit candidates only: `0.5`, + `0.5` when `now` ≥ `windowEnd − ⅓ × window length`; 0 for other kinds |
| `health-protection` | `1` when `category === "health"`, else 0 — a normal weighted **boost, not a top-slot guarantee**. Each value level is worth 0.16 score (0.8 × 1/5), so the 0.4 boost equals **+2.5 value levels**: a value-3 health action (0.8×0.6 + 0.4 = **0.88**) beats an otherwise identical value-5 work action (0.8×1.0 = **0.80**), but a deadline still outranks it (value-5 with deadline ≤ 72 h: 0.80 + 0.70 = **1.50**). "Protection" = health habits are not buried near-equal work |

A `Reason` of `type: "score"` is emitted for every code with signal > 0, subject to **credibility filtering**:
- `goal-value` is only emitted when `candidate.value >= 3` (avoiding confusingly labeling low-value 1-2 items as high value);
- `project-importance` is only emitted when `project.value >= 3`.

Reasons are **sorted descending by actual weighted score contribution** (`W[code] × signals[code]`). Equal contributions preserve the canonical `SCORE_CODES` index order.
`type: "eligibility"` reasons record *why it can run right now* (`context-match`,
`window-open`, `time-fits`, `dependency-clear`, `calendar-preempt`) — these are not
weighted. **"Why this?"** renders the top 3 score reasons by weighted
contribution (with the highest-ranked reason visually accented as the primary driver)
plus the eligibility summary (Proposal §6.3).

**Worked example (Proposal §6.2, `availableMinutes = 60`), a required regression test:**

| | A: 回复普通邮件 | B: 运行论文实验 |
|---|---|---|
| est / value / deadline | 10 min / 2 / 无 | 40 min / 5 / 3 天后 |
| deadline-urgency | 0 | 0.7 |
| goal-value | 0.8 × 0.4 = 0.32 | 0.8 × 1.0 = 0.80 |
| project-importance | 0 | 0.6 × 0.8 = 0.48 (project value 4) |
| time-fit | 0.2 × (1−10/60) ≈ 0.167 | 0.2 × (1−40/60) ≈ 0.067 |
| waiting-time | 0.2 × (1/14) ≈ 0.014 (created 1 day ago) | 0 |
| **score** | **≈ 0.50** | **≈ 2.05** |

B is recommended even though A is easier — easiness must never be a standing
advantage (only the small `time-fit` term).

## Skip & Re-clarify (Proposal §6.4) — consecutive semantics

- **`consecutiveSkips`** (per action, in the DB):
  - `+1` on "换一个" (skip the current recommendation) — the skip transaction;
  - reset to `0` on: complete, snooze, re-clarify, or any edit to the action's
    title/estimate (the user redefined it).
  - It is a **consecutive** counter, not a lifetime total (Proposal: "连续多次跳过").
- **`needsReclarify`** = eligible actions with `consecutiveSkips ≥ 3`
  (`RECLARIFY_THRESHOLD = 3`, a named constant in core). The Now screen shows the
  §6.4 prompt with the **actual count** ("这个任务已经连续跳过 3 次 — 是否需要重新
  明确下一步？"). The proposal's "4 次" is illustrative, not a spec.
- On confirm: re-clarify re-enters the Clarify table at question 2 (domain-model.md);
  the old action row is soft-deleted and the replacement carries `replacesActionId`.
  No audit table in v1 — `CompletionRecord`/soft-delete rows are the history.
- "Why this?" and the filtered list must never be used to raise nag frequency; the
  only skip-driven output is `needsReclarify` (and no reminder is ever created from
  skips — see the Reminder entity).

## Determinism & Testing (hard requirements)

1. Pure: same input (including `now`) → identical output, including `eligible` order.
   Ties break on `(score desc, deadline asc [nulls last], estMinutes asc, id asc)`.
2. No `Date.now()`, no `Math.random()`, no I/O — grep-able.
3. Tests (Jest, co-located, fixed `now` + fixtures):
   - **every** filter rule: one candidate excluded by exactly that rule;
   - boundary tests: deadline exactly 24 h / 72 h / 168 h lands in the documented
     band; `windowDays` mask on an excluded weekday; `dependencyDone = false`
     excludes; a CalendarAction's own row does not self-conflict;
   - **every** ranking signal: one test where it is the deciding factor;
   - the worked example above as a named regression test (exact scores asserted to 2
     decimals);
   - tie-break test; `needsReclarify` fires at exactly 3 consecutive skips and not at 2;
   - reset tests: a snooze or complete between skips zeros the counter;
   - `Object.freeze`-the-input test (the engine never mutates its input);
   - every `eligible` action has ≥ 1 reason; `calendar-preempt` ordering test.
4. Calendar-preempt and `window-mismatch` both use the **device-local** clock for the
   HH:mm window but UTC ISO strings for datetimes — a test covers the local-midnight
   boundary of a habit window.

## What the Engine Must NOT Do

- Decide goals, values, deadlines (Proposal §4.1) — user inputs only.
- Split "完成论文实验" into steps (Clarify, human-in-the-loop).
- Raise nag frequency, schedule notifications, or remember state across calls.
