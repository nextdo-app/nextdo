# Domain Model

> Entities and lifecycle of the GTD system (Proposal §5). The engine consumes these
> types; the DB layer persists them. Types live in `packages/core/src/domain`.

---

## The Clarify Decision Table (Proposal §5.2 — complete, no implicit branches)

Every `InboxItem` is resolved by exactly this flow. The UI walks the user through the
questions one at a time; the resolution is **one DB transaction** that deletes the
`InboxItem` and creates the target row(s). The target row carries `sourceInboxId`
(= the deleted item's id) for traceability.

```text
InboxItem
├─ 1. 可以行动吗？(Is it actionable?)
│   ├─ NO
│   │   ├─ 有参考价值            → ReferenceItem        (title, url?, note)
│   │   ├─ 以后可能做            → SomedayMaybeItem     (title, note?)
│   │   └─ 否                    → Trash (InboxItem soft-deleted, no target row)
│   └─ YES
│       ├─ 2. 这件事属于某个项目吗？(Is it part of a project?)   ← issue #44
│       │   ├─ 不属于项目 (No) → 3. the regular 3–5 chain below
│       │   └─ 属于某个项目 (Yes) ↓
│       ├─ 2b. 新建项目，还是加到已有项目？(New project, or an existing one?)
│       │   ├─ 新建项目 (New project) → Project + its first NextAction, created
│       │   │       ATOMICALLY in the same transaction. If the user aborts
│       │   │       before both are confirmed, neither row exists
│       │   │       (all-or-nothing; the InboxItem survives).
│       │   └─ 添加到已有项目 (Existing) ↓
│       ├─ 2c. 加到哪个项目？(Which project?)
│       │   └─ <an existing ACTIVE project> → NextAction attached to it:
│       │           `projectId` = the project's id; `value` defaults to the
│       │           project's value (overridable in the action form).
│       │           Questions 3–5 do NOT apply — a project-attached action is
│       │           always a NextAction in v1 (a CalendarAction has no
│       │           `projectId`; fixed-time and project membership are mutually
│       │           exclusive). The project must exist and be `active`
│       │           (db errors `clarify.project-not-found` /
│       │           `clarify.project-not-active`; validated before the
│       │           transaction — no partial writes).
│       ├─ 3. 约 2 分钟内能完成吗？(Doable in ~2 min?)
│       │   ├─ YES → DO NOW: the UI executes it immediately.
│       │   │   • completed on the spot → CompletionRecord(action_kind="do_now",
│       │   │     action_id = sourceInboxId) and the InboxItem is trashed. No action
│       │   │     entity is ever created.
│       │   │   • not completed on the spot → becomes a `NextAction` and the flow
│       │   │     **ends here** (questions 4–5 do not apply — the user already
│       │   │     declared it theirs and immediately doable). Transaction: delete
│       │   │     the InboxItem, insert the NextAction (`sourceInboxId` set,
│       │   │     `value` default 3 — no project context to inherit from).
│       │   └─ NO ↓
│       ├─ 4. 应该由我完成吗？(My responsibility?)
│       │   ├─ NO → WaitingForItem   (waitingOn, expectedBy?)
│       │   └─ YES ↓
│       └─ 5. 必须在特定日期/时间执行吗？(Fixed date/time?)
│           ├─ YES → CalendarAction (startsAt, plus shared action fields)
│           └─ NO  → NextAction
```

Rules:

- A clarification that creates a `Project` must also create its first `NextAction`
  (Proposal §5.3) — a project without a next action is rejected in the UI before the
  transaction, with `ValidationNextdoError("project.needs-outcome")` if the outcome
  field is empty.
- "Trash" is always soft delete (`deleted_at` set); the Trash screen is a query over
  soft-deleted rows, with restore (clears `deleted_at`) and hard-purge.
- Re-clarify (triggered by the engine, see Next Action Engine) re-enters this table at
  question 2 for the existing action: the outcome replaces the old action row
  (old row soft-deleted; `sourceInboxId` chain preserved via the new row's
  `replacesActionId`). Because it re-enters at question 2, re-clarify also asks
  questions 2/2b/2c — the user can attach to a project, create a new one, or say
  「不属于项目」 (detach: the replacement action's `projectId` is null).
- **Answer payload** (`ClarifyAnswers`, core): `inProject: boolean` + (when true)
  `projectChoice: 'new' | 'existing'`; `'existing'` requires a non-empty `projectId`
  (`clarify.project-required`) and `'new'` requires a non-empty `projectOutcome`
  (`project.needs-outcome`). An in-project answer without `projectChoice` is
  `clarify.incomplete` — there is no implicit branch. `inProject: false` ignores a
  stray `projectId` and walks 3–5.
- Capture handoff (v1 UI): each saved capture enters this walk **immediately**
  (one item at a time; after the walk the UI offers "capture another" / "done").
  An aborted walk leaves the InboxItem in the inbox for later.

## Core Entities

Common to every entity: `id` (ULID, minted at creation in
`packages/core/src/lib/ids.ts`), `created_at`, `updated_at` (ISO-8601 UTC),
`deleted_at` (soft delete, see Trash above). Domain types map snake_case DB columns to
camelCase TS fields; the mapping table is the single one in
`packages/db/src/schema.ts`.

### InboxItem
Raw capture (Proposal §5.1). Required: `title` (free text), `capturedAt`. No contexts,
no estimates — captures stay friction-free. The v1 capture UI hands each saved item
straight into the Clarify walk (see "Capture handoff" rule below); an item survives
in the inbox only when the walk is aborted.

### Project
A multi-step outcome (Proposal §5.3).
- `title`, `outcome` (what "done" means; required, see Clarify rules),
- `value: 1..5` (goal importance — used by the engine's `project-importance` signal),
- `status: "active" | "on-hold" | "done" | "dropped"`.
- The project detail screen supports the quick `active ↔ on-hold` switch
  (归档 / 恢复 — task 09-28 project-action-edit-trash); `done` / `dropped`
  remain terminal and are decided by the weekly review only.
- **Coverage is always derived, never stored:** `projectActionCoverage()` (in
  `packages/db`) returns the active projects lacking an open action. The weekly review
  screen and the engine both query it; nothing "bumps" a stored counter.

### NextAction
A single concrete step (Proposal §5.3: "运行 baseline A", never "完成论文实验").
- `title`, `projectId?` (at most one project),
- `contextIds: string[]` (where it can be done),
- `estMinutes: number` (user estimate; feeds the engine's hard filter and `time-fit`),
- `value: 1..5` (set in Clarify; defaults to the parent project's value when created
  from one or attached to one via question 2b — overridable in the form),
- `category?: "work" | "health" | "life" | "other"` (the health signal reads
  `category === "health"`),
- `dueDate?` (ISO date, soft) / `deadline?` (ISO **datetime** — the exact moment;
  drives `deadline-urgency`, computed in exact hours),
- `dependsOnId?: string` (v1: at most one, direct dependency — the id of another
  action; the hard filter excludes the dependent until it is done),
- `windowStart?`, `windowEnd?` ("HH:mm", **device-local timezone**) plus
  `windowDays?: number[]` (0=Sunday … 6=Saturday, device-local weekday; undefined =
  every day) — for actions only doable in a daily window, e.g. "工作日 09:00–17:00
  联系客服" = `windowDays: [1,2,3,4,5]`, `windowStart "09:00"`, `windowEnd "17:00"`,
- `snoozedUntil?` (ISO datetime; set/cleared only by the snooze transaction),
  `lastSnoozedAt?` (set by the snooze transaction; feeds the engine's `waiting-time`),
- `consecutiveSkips: number`, `lastSkippedAt?` (semantics in Next Action Engine),
- `status: "open" | "done"` (**`done → open` is legal** — the user-initiated restore of
  a mis-completed action, issue 27; it is NOT a general un-complete and it never deletes
  history),
- `sourceInboxId?`, `replacesActionId?` (Clarify/re-clarify traceability).
- **Invariant:** one sitting, no sub-list. Enforced softly by Clarify questions 2–2c
  (an item either joins a project as one action or becomes a new project); the
  engine never splits actions itself.

### WaitingForItem
Delegated or blocked on someone/something else (Proposal §5.2).
- `title`, `waitingOn` (who/what), `expectedBy?`, `followUpAt?`.
- When `followUpAt` passes, the item appears in the **Daily Review** list — it never
  enters the engine pool.

### CalendarAction
Time-bound action (Proposal §5.2). `title`, `startsAt` (ISO datetime) + the shared
action fields (contextIds, estMinutes, value, category, deadline optional). Carries
the same execution columns as NextAction (`snoozedUntil`, `lastSnoozedAt`,
`consecutiveSkips`, `lastSkippedAt`) — **snooze/skip transactions target all three
action kinds**. A
`CalendarAction` is a hard schedule entry: the engine preempts it when it is near
(see Next Action Engine). An action is never both `NextAction` and `CalendarAction`.

### SomedayMaybeItem
`title`, `note?`. Weekly review re-asks: promote (→ Project/NextAction via Clarify),
keep, or trash.

### ReferenceItem
External material (Proposal §4.3: v1 = links only). `title`, `url?`, `note?`.

### Context
Named execution environments (Proposal §6.1). Seeded defaults: `home`, `office`,
`computer`, `phone`, `outside`; user can add. Seeding implementation:
`seedDefaultContexts(pool)` (`server/app/src/seed.ts`) — the **single
authoritative (server-side) writer**: at process start, BEFORE the HTTP server
accepts `/upload`, it inserts the five defaults (id = `ulid(now)`) only when the
`contexts` table holds **no row at all (live or soft-deleted)**; otherwise a
no-op returning 0 (a user who deletes all five is not re-seeded — user intent is
respected). Idempotent across restarts; non-fatal (a seed failure never blocks
boot). **Why server-side**: client-side seeding was racy — two fresh client DBs
could both see an empty remote, both seed, and upload two sets of defaults that
then sync back to EVERY client as duplicate context tags. The server process is
the single writer, so it cannot race. The client no longer seeds
(`apps/mobile/app/_layout.tsx` only subscribes to the stream);
`seedDefaultContexts(db, now)` in `packages/db/src/queries/contexts.ts` is
retained for local/offline seeding and the db query tests. Seed rows are ordinary
user data — they ride the existing sync stream to clients (no schema change).
The user's current environments are a
UI-layer declaration (mobile: **manual selection** — location-assisted context is
post-MVP; desktop: `computer` + user selection) and are passed to the engine as
`EngineContext.contextIds` — not stored per action beyond the action's own
`contextIds`.

- **两分钟行动与即时专注（Issue #51）**：
  在澄清（或重新明晰）向导中，当行动符合 2 分钟定律且用户在 Q3b 选择「现在就做完」时，系统物化生成一条合法的 `NextAction`（`estMinutes: 2`, `value: 3`, `status: 'open'`），并立即跳转唤起 2 分钟倒计时专注流程（`preset=2&autoStart=1`）。专注结束后走解耦追问确认：确认完成则写入 `status = 'done'` 与 `CompletionRecord`，自然进入「已完成行动」窗口（支持查看与恢复）；选择先不完成或退出则保持 `status = 'open'`，安全留存在「现在」执行池（待完成列表）中，杜绝任何状态丢失。

### Habit (+ HabitDay)
A rule generating a recurring action (Proposal §7).
- `Habit`: `title`, `actionTitle` (e.g. "阅读 30 min"), `estMinutes`, `value: 1..5`,
  `category?`, `windowStart` / `windowEnd` ("HH:mm", device-local),
  `windowDays?: number[]` (same semantics as NextAction),
  `cycleDays: number` (default 21 — a **challenge cycle**, UI copy must not claim
  "21 days guarantees a habit"), `startedAt`,
  `status: "active" | "completed" | "broken"`.
  - `startedAt` is the challenge's **first day**, chosen by the user (task
    10-11-habit-start-date-picker). The app writes it at the picked day's local
    midnight, so `habitCycleDay` advances by whole calendar days; the stored
    type is unchanged (ISO string) and pre-existing rows keep their meaning.
  - A start date is legal only from **today onwards** — there is no upper
    bound, enforced by `checkHabitStartDate`
    (`packages/core/src/domain/habit-start.ts`). Later than today is fine:
    `seedHabitDays` lays the whole cycle down up front and the pool query
    only ever reads a day whose `localDate` is today, so the days before the
    start date stay inert. Earlier than today is rejected because there is
    no daily backfill job — a habit created after its own cycle began would
    carry days the user can never complete.
  - Status transitions: `active → completed` (last day of the cycle done);
    `active → broken` (a day in the cycle missed — detected at the start of the next
    local day: a current-cycle HabitDay with `localDate < today` not done);
    `broken → active` (user restarts the challenge — new cycle from today);
    `completed → active` (**issue 27** — restoring one of its 打卡 from the
    「已完成行动」 window; a day of the cycle is open again, so the challenge is
    not finished).
- `HabitDay`: one row per habit per **local calendar day** — the generated action
  instance.
  - **Deterministic id: `hd-<habitId>-<YYYYMMDD>`** (device-local date).
  - Unique constraint on `(habitId, localDate)`.
  - Generation is `INSERT OR IGNORE` — idempotent, so offline multi-device generation
    never creates duplicates (Proposal §10).
  - **Seeding lays down the habit's WHOLE cycle** (`seedHabitDays` in
    `packages/db/src/queries/habits.ts`) — every day from `startedAt` through
    `startedAt + cycleDays − 1` — rather than stopping at today. There is no
    daily backfill job, so a day not written at creation time would never
    appear; pre-seeding is what lets a challenge be booked to start in the
    future. The pool query filters on `local_date = today`, so the days before
    the start date never leak into a recommendation. A cycle that is
    **entirely in the past** ⇒ seed nothing (those rows would only ever read
    as missed); the weekday mask still skips individual days either way.
  - `startHabit` returns TODAY's seeded day, which is **null** whenever the
    challenge is not live yet (booked ahead, or a weekday mask excludes
    today). That null is an ordinary outcome, **not** a failure — callers
    must not surface it as an error.
  - "Day" and the window are evaluated in the **device's local calendar timezone** at
    generation time; no server timezone is involved.
  - Persisted `status: "open" | "done"`. **`missed` is derived** (a past localDate
    whose row is not done) — computed at query time, never written.
    **`done → open` is legal** — the issue-27 restore, the exact mirror of the
    action rule, because a 打卡 is a pool row with its own 完成 button and
    "完成即可逆" must hold for it too.
  - HabitDay rows also carry the execution columns (`snoozedUntil`,
    `lastSnoozedAt`, `consecutiveSkips`, `lastSkippedAt`) — see CalendarAction.
  - A `HabitDay` maps to the engine's `HabitCandidate` (see engine types) with
    `cycleDay` = days since `habit.startedAt` + 1.

### Reminder (Proposal §8 — MVP-required)
- `Reminder`: `id`, `actionKind: "next" | "habit" | "calendar"`, `actionId`,
  `firesAt` (ISO datetime), `intensity: "normal" | "important" | "alarm"`,
  `state: "scheduled" | "fired" | "cancelled"`.
- **Creation rules (v1, in `packages/core` so they are testable):**
  | Trigger | firesAt | intensity |
  |---------|---------|-----------|
  | Snooze (any) | = the snooze target time | `normal` |
  | CalendarAction with `startsAt` within 60 min | `startsAt − 15 min` | `important` |
  | Habit window closing | `windowEnd − 30 min` (if before window end) | `normal` |
  | Deadline reminder (task 10-17 — the action form's 「提醒时间」) | = the moment the user picked; a past moment creates nothing | `normal` |
  | Repeated skips / "do nothing" nagging | **never** — forbidden by Proposal §6.4 | — |
- **The deadline reminder (task 10-17)** is the one creator driven by a FORM
  rather than a transaction rule: the action forms carry an optional
  「提醒时间」 (`apps/mobile/hooks/use-action-reminder.ts` +
  `apps/mobile/lib/datetime-field.ts`), pre-filled from the deadline — the same
  moment when it has a time, that day at 10:00
  (`DEFAULT_DATE_ONLY_REMINDER_HHMM`) when it is date-only, nothing when that
  prefilled moment already passed — and the save reconciles the row in the SAME
  transaction as the action write: cancel the action's scheduled rows, arm the
  new one (`reconcileReminder` in `packages/db/src/queries/actions.ts`).
  `addNextAction` / `updateNextAction` take an optional `reminderAt` for this;
  a caller that passes nothing (a rename, a re-clarify) leaves the row alone, so
  a snooze reminder survives edits that have nothing to do with it. One action
  therefore has at most one pending reminder.
- **Project reminders do not exist** — `actionKind` is
  `next | habit | calendar`, and adding `project` is deliberately deferred: an
  unknown kind written into the synced `reminders` table is read by OLDER
  clients as an orphan (no join match) and their delivery layer cancels its
  local notification.
- **Deadline shape (task 10-17)**: `deadline` is always an exact ISO moment. A
  date-only pick is stored as that day's local 23:59:59 (the
  `DATE_ONLY_DEADLINE_HHMM` sentinel in `packages/core/domain/deadline.ts`) —
  which is what every pre-existing row already carried, so there is **no
  migration**. The sentinel is what the chip reads back as 「今天截止 / 还剩 N
  天」; a deadline with a real time spells the time out (「今天 18:00 截止」).
- **Notification actions** (Proposal §8: 完成 / 推迟 / 跳过 in the notification itself).
  A notification deep-links into the app and applies the **same transaction** as the
  in-app equivalent:
  - 完成 → the complete transaction (below);
  - 推迟 → the snooze transaction (creates the next `Reminder`);
  - 跳过 → the skip transaction (`consecutiveSkips += 1`).
  - Idempotency: the reminder row flips to `fired` in the same transaction; a second
    tap on the same notification is a no-op.
- Delivery is best-effort local notification (expo-notifications, scheduled at creation
  and re-armed on foreground). The `Reminder` row is the source of truth; a missed
  delivery surfaces as "due" on the Now screen.
- Snooze is a **DB-only** state: the snooze transaction sets
  `snoozedUntil` (+ creates the `Reminder`) and no copy of it exists in UI state.
- **Snooze presets (Proposal §8)** — named constants in core, resolved against
  `now` (device-local):
  | preset | target |
  |--------|--------|
  | `10m` / `30m` / `1h` | `now + 10 / 30 / 60 min` |
  | `tonight` | 21:00 device-local today; if `now ≥ 21:00`, 21:00 next day |
  | `tomorrow` | 09:00 device-local next day |
- **Platform capability matrix** — the snooze/skip/complete transactions are
  identical on every platform; only delivery differs (v1 implementation,
  task 09-30-reminder-notification-delivery):
  | Platform | Delivery | In-notification actions |
  |----------|----------|-------------------------|
  | Mobile (iOS/Android) | expo-notifications (local, OS-persisted — survives force-kill; the reminder row ID is the OS notification `identifier`, reconciled on launch/foreground/row change) | none in v1: tap deep-links to the Now tab (完成 / 推迟 / 跳过 from the notification is post-MVP) |
  | Desktop (Tauri) | tauri-plugin-notification 2.4.0 — **no native future scheduling on any desktop OS** (verified in the plugin source): a 30s in-app tick fires due rows while the app runs; nothing fires while the app is closed (v1 limitation) | none: click only focuses the app (the plugin has no desktop click callback) |
  Every device delivers its own scheduled rows (no cross-device arbitration —
  one reminder may fire on each online device). Missed delivery on any
  platform: the `Reminder` row stays the source of truth and the item
  surfaces as "due" on the Now screen. The delivery layer never writes
  `state = "fired"` (the OS fires while the app is terminated); rows stay
  `scheduled` until a business transaction cancels them.

### FocusSession (Proposal §9)
- `actionId`, `actionKind`, `mode: "preset" | "free"`,
  `plannedMinutes: number | null` (preset is any whole minute in
  `MIN_FOCUS_MINUTES`–`MAX_FOCUS_MINUTES` = 1–180 — issue #59 made the length
  user-choosable; `null` for free timer),
  `startedAt`, `pausedSec`, `endedAt?` (set when the session leaves `active`, in
  **either** terminal state — elapsed = `endedAt − startedAt − pausedSec`),
  `status: "active" | "completed" | "abandoned"`.
- `completed`: user finishes (or the timer ends and user confirms) → row finalized;
  **timer end ≠ task complete** — since issue 27 the action is NOT completed here at
  all; the screen shows a follow-up step and completing the action is a separate,
  explicit tap that runs the complete transaction.
- `abandoned`: user stops early; the row is kept (with `pausedSec` and elapsed) so
  time spent is visible in review. Abandon does not touch the action.
- The live, in-progress session is the only focus-related value in UI state (see
  app/state-management.md); it is persisted as an `active` row from the moment it
  starts, so app kill/restart recovers it.

### ReviewRecord (Proposal §5.4)
Append-only, a **discriminated union** on `kind`:
`type ReviewRecord = DailyReviewRecord | WeeklyReviewRecord`. Every variant carries
`kind`, `at`, `snapshot`, `answers`:

- `snapshot` — **computed** by a pure core function at review start (machine-generated,
  never hand-edited):
  - daily: `{ inboxCount, completedToday: string[], stillOpen: string[],
    projectsMissingActions: string[], waitingFollowUps: string[],
    calendarToday: string[], calendarTomorrow: string[], repeatedSkips: string[] }`
  - weekly: `{ inboxCount, projects: { id, title, hasOpenAction, lastProgressAt }[],
    waitingFollowUps: string[], somedayCount, stalledProjects: string[]
    (no completion on the project's actions for ≥ 14 days), calendarNext7: string[] }`
- `answers` — **the user's** checklist responses:
  - daily: `{ completedActionIds: string[], rescheduled: { actionId, toDate }[],
    skippedNoted: string[], tomorrowMustDo: string[] }`
  - weekly: `{ inboxCleared: boolean, followUpsRaised: string[],
    calendarReasonable: boolean,
    somedayDecisions: { id, to: "project" | "action" | "keep" | "trash" }[],
    projectDecisions: { id, to: "active" | "on-hold" | "done" | "dropped" }[] }`
- **Validation without dependencies:** core stays dependency-free, so the shapes are
  TS types plus a hand-written pure validator in core (`assertReviewRecord`);
  `packages/db` calls it before every write. No zod (or any runtime dep) in core.
- Review decisions are **applied as real transactions** (e.g. a `projectDecisions`
  entry writes the status change); the record is the audit trail, the entities are
  the state.

### CompletionRecord
`actionKind` + `actionId` (polymorphic: NextAction / HabitDay / CalendarAction /
`"do_now"`), `completedAt`, `estMinutes: number | null` (copied at completion for
estimate-accuracy review; **null for `do_now`** — no estimate ever existed).
Append-only.

## Lifecycle Assertions

Every entity with a lifecycle exposes its statuses as a TS union plus
`assertTransition(entity, to, now)` in `packages/core/src/domain` that throws
`ValidationNextdoError` on illegal jumps (e.g. `done → open`). Transitions with side
effects (complete → CompletionRecord; habit done → cycle advance; re-clarify →
replace) are composed in `packages/db` query functions — assertions check legality;
the DB layer applies, atomically, in one transaction per user intent.

## The Complete Transaction (canonical example)

`completeAction(db, { actionKind, actionId, now })`:
1. `assertTransition(open → done)`;
2. set `status = "done"`, clear `snoozedUntil`, reset `consecutiveSkips = 0`;
3. insert `CompletionRecord`;
4. cancel any `scheduled` Reminder pointing at the action;
5. if the action belonged to a HabitDay: mark the day `done` and, if it was the last
   day of the cycle, set the habit `status = "completed"`.
All five steps in one local transaction (synced in the background — see
app/state-management.md). Project action coverage is **not** updated here; it is
derived on query.

**Completing an action is ALWAYS a separate, explicit user action** (issue 27). A focus
session reaching its end only writes the FocusSession row — `completeFocusSession`
never touches the action (see FocusSession above). The action's own 完成 button is the
only thing that runs the transaction above.

### The Restore Transaction (issue 27)

`reopenAction(db, { actionKind, actionId, now })` — the mirror of the complete
transaction, run from the 「已完成行动」 window:
1. `assertTransition(done → open)`;
2. set `status = "open"`, clear `snoozedUntil`, reset `consecutiveSkips = 0`;
3. **soft-delete** (`deleted_at` set, never a hard delete) the action's
   `CompletionRecord`s — they asserted a completion that no longer holds, so they must
   stop counting toward the review snapshots, while the rows themselves stay;
4. reminders: the complete transaction cancelled them, and `cancelled` is terminal in
   `REMINDER_TRANSITIONS` — they are NOT resurrected. A re-snooze mints a fresh one;
5. habit only: the inverse of the complete transaction's step 5 — a 打卡 taken back
   out of a `completed` habit puts that habit back `active` (its cycle is no longer
   finished).

Every FocusSession of the action is left untouched: the focus history the user actually
performed survives a restore, which is the whole point of separating the two events.

**Reminder-cancel is a property of every action-exit path** (task
09-30-reminder-notification-delivery): any transaction that deletes or
replaces an action must cancel its `scheduled` Reminders in the same
transaction — `completeAction` (step 4), `trashAction` (next/habit/calendar
via `ACTION_TABLES`), `trashCalendarAction`, the re-clarify replace path
(soft-deletes the old action and does not go through `completeAction`, so it
cancels explicitly), and re-snooze (replaces the reminder). The reconcile
loop on each device is the safety net for cross-device races, not the
primary mechanism.

## Invariants

1. Inbox items have no contexts, estimates, or values — raw captures only.
2. An action is never both `NextAction` and `CalendarAction`.
3. `WaitingForItem` never enters the engine pool.
4. Trash = `deleted_at` set; trashing an active project requires the UI to dispose of
   its actions (trash-with-project or keep) — the model exposes `projectActionIds()`.
5. Every `id` is a ULID minted at creation in `packages/core/src/lib/ids.ts`;
   `HabitDay` ids are the deterministic `hd-<habitId>-<YYYYMMDD>` (the one exception,
   required for multi-device idempotency).
