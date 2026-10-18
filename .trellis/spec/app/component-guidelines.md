# Component Guidelines

> How components are built in `apps/mobile` and `packages/ui`.

---

## Patterns

- Function components only. Named exports only (`export function ActionCard(...)`) —
  no default exports, **except** Expo Router route/layout files under
  `apps/mobile/app/**`, which must default-export (see project/conventions.md).
- **One component per file**, file name `kebab-case`, component name matches (file
  `action-card.tsx` → `export function ActionCard`).
- Presentational components receive data + callbacks as props; they never query the DB
  and never import from `packages/db`. Data flows in from hooks (see Hook Guidelines).
- Composition over configuration: prefer a `children` slot and small composable parts
  (`<Card>`, `<CardTitle>`) over a `variant` prop with 10 branches.
- Keep components reviewable in one pass — split into subcomponents or a hook once
  that stops being the case (~150 lines is a soft trigger for a look, not a limit).

## Props

- Props type is an `interface` named `<Component>Props`, defined and exported in the same file.
- Required props first; optional props default to `undefined`, not to values that hide mistakes.
- No `props: any`, no destructuring with silent fallbacks for required data.

## Styling (NativeWind)

- Styling is NativeWind class strings + design tokens from `packages/ui/tokens`
  (colors, spacing, radii, typography). **No raw hex colors, no magic pixel numbers**
  outside tokens.
- Dynamic classes: build the full class string (`cn()` helper in `packages/ui`) —
  NativeWind does not recognize classes assembled from partial fragments at runtime.
- Dark mode: class-based (`dark:` variant). Tokens are defined for both modes.
- Text styling: text color and typography classes (`text-*`, `font-*`) must be placed directly on `<Text>` elements, never on `<View>` containers (React Native native runtimes do not cascade text styles from View to Text).

## Lists

- Task/action lists render from a **bounded, pre-fetched** slice (the engine or a query
  already limits rows). No "load 500 rows then filter in `map`".
- `FlashList` only when scroll performance problems are observed on a large list;
  `FlatList` is the default otherwise (evidence-driven, not row-count-driven).
- Keys are stable entity `id`s — never array index.

## Accessibility

- Every tappable element: `accessibilityRole="button"` + `accessibilityLabel` that names
  the action and its object (`"Start focus session: run baseline"`).
- Touch targets ≥ 44×44 pt (use padding or `hitSlop` on compact visual elements, not smaller hit areas).
- Color is never the only state signal (due/overdue gets an icon or text, not just red).

## Forms (date/time)

- The user never hand-types an ISO string: date/time fields open the
  `DateTimePicker` modal (`apps/mobile/components/datetime-picker.tsx` —
  pure RN, identical on all platforms including web). The community native
  picker (`@react-native-community/datetimepicker`) renders NOTHING on web
  and must not be introduced — the web build is the desktop surface.
- Field values stay `'YYYY-MM-DD'` / `'HH:mm'` strings (the clarify-flow
  contract); the picker's defaults come from the app clock (`now` prop).
- This applies to EVERY date/time field, not just the ones that started out
  as pickers — the habit form's optional time window was two free-text
  `HH:mm` inputs until issue #13 and had to be converted. A text input for a
  value the picker already owns is a defect, not a shortcut.
- `mode="datetime"` is the third mode (task 10-17): it emits
  `'YYYY-MM-DDTHH:mm'`, and — because its wheels start on a real time — it
  emits plain `'YYYY-MM-DD'` when the user picked a day and never touched a
  time control (the 「不调整时刻 = 只记日期（当天截止）」 hint sits above the
  wheels). That date-only shape is the deadline convention: stored as that
  day's local 23:59:59 via `endOfLocalDayIso`, read back with the plain-date
  wording (`DATE_ONLY_DEADLINE_HHMM` sentinel in `packages/core`
  `deadline.ts`). Only a deadline that carries a real time spells it out
  (`今天 18:00 截止`).
- The 「提醒时间（可选）」 field (`apps/mobile/hooks/use-action-reminder.ts` +
  `apps/mobile/lib/datetime-field.ts`) pre-fills from the deadline — the same
  moment when it has a time, that day at `DEFAULT_DATE_ONLY_REMINDER_HHMM`
  (10:00) when it is date-only, nothing when the prefilled moment already
  passed — and a save touches the `reminders` table ONLY when the value
  changed (`reminderWriteIfChanged`): a rename must never disarm a snooze
  reminder. Reminders exist for ACTIONS only — `reminders.action_kind` has no
  `project`, so the project form shows the deadline alone.

## Clarify wizard (question steps)

- **Answers carry equal visual weight.** Every answer to one question renders through
  the same component with the same variant (`Choices` → `Button size="lg"
  variant="secondary"`, or the project row in the q2c picker). No accent fill, no
  "recommended" badge, no different size — a heavier option reads as the app's choice
  rather than the user's (issue #44).
- **No preselected option on display.** The keyboard nav hook
  (`apps/mobile/hooks/use-option-keyboard-nav.ts`) paints its accent ring only after
  the FIRST arrow/Home/End press (`keyboardEngaged`); entering a question shows both
  answers unlit. `Enter`/`Space` confirm nothing until the ring is visible — a stray
  Enter must never answer an option the user never saw selected.
- **The question chain follows the Clarify decision table** (domain-model.md):
  q1 → q2 属于某个项目吗？ → (属于) q2b 新建/已有 → (已有) q2c 加到哪个项目？ →
  (不属于) q3 2 分钟内？ → … The 「不属于项目」answer lives on q2 and jumps straight
  to q3; q2c is a picker of ACTIVE projects only, with an empty-state explanation
  (no auto-jump to the new-project form). The chain constant and the progress
  denominator (`PROGRESS_MAX`) must be updated together with any new step.

## Forms (field labels)

- A field's NAME is a visible label above the control — `FormField`
  (`apps/mobile/components/form-field.tsx`) — never the placeholder alone.
  A placeholder disappears the moment the field holds a value, so a filled
  box (or a picked date) reads as unexplained text; the placeholder stays a
  hint INSIDE the box. The clarify wizard's `Field` and the edit-action
  modal's label-over-control blocks are the same rule, locally.
- The label is rendered even when the field is empty, so label + placeholder
  may repeat the same words (e.g. 项目标题). That redundancy is deliberate:
  the name must survive typing, and the placeholder must keep working for
  tests and hints.

## 桌面端视口与全宽自然排版规范（Desktop / Web Layout）

- 所有主 Tab 页面（`inbox.tsx`, `now.tsx`, `projects.tsx`, `review.tsx`, `settings.tsx`）及二级页面在桌面端与宽屏视口下采用全宽自然延伸（`w-full`），不设置硬编码居中宽度限制（如 `max-w-5xl mx-auto`），消除窗口两侧的人工大面积黑底留白。
- 底部标签栏在 `apps/mobile/app/(tabs)/_layout.tsx` 中全宽自然延展，水平内边距使用安全边距 `paddingLeft/Right: Math.max(insets.left/right, 8)`，与窗口边界紧密贴合。

## Cloud sync (Settings tab, `apps/mobile/app/(tabs)/settings.tsx`)

- Cloud sync is OPTIONAL and USER-CONFIGURED (prod-deploy R6 + OSS
  09-28 — the R3 first-launch ConnectGate is DELETED): the app is local-first
  and renders the main tree unconditionally; with no owner token **or** no
  stored server config, PowerSync stays disconnected and the local DB is
  still the source of truth. The Settings tab (5th tab, 「设置」) is the
  single entry point.
- The disconnected form asks for **TWO** things, not four
  (10-02-simplify-sync-setup):
  1. 「服务器地址」 — ONE base address. `deriveSyncConfig` (packages/db)
     appends `/api` + `/sync`, so a newcomer never sees or types a path.
  2. 「连接串 / owner token」 — accepts a pasted connection string
     (`parseConnectionString`, `apps/mobile/lib/sync-connection.ts`) **or** a
     bare owner token.

  A collapsed **「高级设置」** accordion holds the two original custom URL
  inputs for non-standard reverse-proxy layouts. Filling **both** makes them
  win over the derivation; there is deliberately **no "advanced mode" toggle**
  — a second state that can disagree with the fields themselves. A half-filled
  pair does not take over. A pre-existing stored config pre-fills all three
  address fields (the simple one with the BASE address — never with a derived
  `/api` suffix the user did not type), so 断开 → 重连 needs only a token.
  **Editing the server address clears the prefilled advanced pair** and
  suppresses further advanced pre-fills for that screen's life: otherwise the
  invisible prefilled pair would keep winning (`hasAdvanced` only asks "are
  both filled?") and the app would silently contact the OLD server while the
  field showed the NEW address. Touching only the token must NOT clear it —
  that is the reconnect path a custom path layout depends on.
- The `useCloudSync` UI hook (`apps/mobile/hooks/use-cloud-sync.ts`) owns
  the connection state: on mount + on every poke it re-reads
  `getOwnerToken()` AND `getStoredBackendConfig()`, and subscribes to
  `subscribeToOwnerTokenChange` — the SAME notification the root provider
  uses to drive connect()/disconnect() (the provider re-reads token +
  stored config and only `connect()`s when BOTH are present), so the UI can
  never diverge from the sync lifecycle. The hook also owns
  `connect(input)`, which accepts EITHER `{ serverAddress, token }` (the
  normal path — `deriveSyncConfig` completes it) OR `{ backendUrl, endpoint,
  token }` (the advanced path — used verbatim), runs the SAME client-side
  checks in the SAME order for both, then `fetchCredentialsOnce` →
  `setStoredBackendConfig` **first** then `setOwnerToken`, whose poke flips
  both the provider and this hook; and `disconnect()` (`clearOwnerToken` only —
  the stored addresses are KEPT, so reconnecting is just re-entering the
  token; no confirmation, nothing destructive).
- **The stored `endpoint` may come from the server, not just from what the
  user typed**: when `/credentials` returns a valid `endpoint` (the
  deployment's `NEXTDO_SYNC_ENDPOINT`), it overrides the derived/entered
  value before the config is written. The provider's own subscription
  re-reads token + stored config on the same poke, so it connects with
  whatever the final config says. Older servers that send no `endpoint` keep
  the locally derived value — see the compatibility matrix in Database
  Guidelines.
- The user-facing error copies are the single precedent (never throw, always
  inline, never block), and they are **identical for both input shapes**:
  client-side, pre-network:
  「请先填写服务器地址」/ 「地址无效，应以 http:// 或 https:// 开头」/
  「请先输入 owner token」(token REQUIRED — an empty token is refused
  client-side before any network, the same pattern as the address checks).
  Server three-state: 「token 不正确」(401) /
  「连不上服务器，请稍后重试」(network / 5xx / malformed 200 — the token is
  NOT invalidated) / 「token 验证通过，但保存失败，请重试」(storage write).
  The Settings block ALSO accepts `?syncError=…` in its query — that is how
  the deep-link route (`app/sync.tsx`) hands a failed connect back with the
  reason visible instead of failing silently.
- The deep-link route's once-only guard is a ref holding **the link key**
  (`s` + `t`), NOT a boolean latch. A boolean would freeze the route after
  the first link, so a second tap (a corrected QR, a new server) would hit a
  screen that silently does nothing. Each distinct link is honored exactly
  once; re-rendering with the same params still does not re-post the token
  (a shared secret must not be uploaded twice). An incomplete link is keyed
  too, so it is reported once rather than spinning forever.
- RootLayout runs a non-blocking startup hygiene check (see Database
  Guidelines): it re-reads the stored token + config and, on a 401, clears
  the TOKEN only (the config is kept — the SDK does not spin and the Settings
  tab stays honest).
- **The connected card's status line is the SDK's own state, not a restatement
  of "a token is stored"** (issue #22). `useSyncStatus` derives it with the
  pure `lib/sync-status.ts` (`offline` / `syncing` / `pending` / `synced` /
  `failed`); the screen maps `kind` → copy (the `UPDATE_FAILURE_COPY`
  precedent — the state belongs to the lib, the sentence to the screen). The
  「立即同步」 button beside it is the honest implementation of "sync now" —
  re-`connect()` is the only stable mechanism, see the Database Guidelines.
  「上次同步时间」 comes from `SyncStatus.lastSyncedAt`, which is undefined
  BOTH before the first full sync AND after a PowerSync service restart:
  render 「尚未完成过同步」 rather than a fabricated time. A manual attempt
  that times out must say so — `connect()` never rejects on a dead network.

## Notifications (Settings 「提醒通知」 card + the first-run guide)

- TWO layers gate a reminder notification and the UI must never conflate them:
  the OS permission (read/requested through `lib/reminders/adapters` — the
  screen never imports `expo-notifications`) and the app's own master switch
  (`lib/notification-settings.ts`, default ON so an untouched device keeps the
  pre-#24 behavior). Both must allow delivery.
- **The master switch is a RECONCILE INPUT, not a call-site guard.** It is
  passed to `computeReconcile` as `enabled`; while false the pass returns
  `toCancel: [...pendingIds]` and schedules / fires nothing
  (`lib/reminders/reminder-scheduler.ts`). Merely skipping the delivery call
  would leave the OS holding the schedules a previous pass created, so the
  switch would not take effect until they expired. `use-reminder-delivery.ts`
  reads the stored value BEFORE its first reconcile (otherwise it would
  schedule and immediately withdraw) and re-reconciles on every preference
  poke — that poke is the "即时生效" path, not a poll.
- The one-shot first-run guide (`components/notification-optin-dialog.tsx`,
  mounted in the root layout beside `IosInstallPrompt` / `AutoUpdateNotifier`)
  shows only while the OS state is `undetermined` AND the user has never been
  asked, and it records BOTH answers (`optInPromptSeen`) — a declined user is
  never re-nagged (issue #24 AC3). A preference READ failure counts as
  "already shown": the alternative is a dialog on every launch. It skips
  plain web where the browser exposes no Notification API (iOS Safari before
  「添加到主屏幕」) — a guide whose button cannot do anything is worse than none.
- Device preferences use the `lib/theme.ts` / `lib/habit-reminders.ts` platform
  matrix (native → `expo-secure-store`, web/Tauri → `localStorage`, Node →
  memory). Do NOT store them through `packages/db/src/owner-token.ts`: the
  desktop stronghold backend enforces a two-key contract and rejects any other
  key with `storage.multi-key` — it is for secrets, not preferences. (The
  matrix is now duplicated across four modules; consolidating it is worthwhile
  but must not ride along on an unrelated feature.)

## Tag (packages/ui)

- tone → palette (Paper Serenity solid warm fills, no alpha tints for
  neutral/accent/warning): neutral = `surface-container` + muted;
  accent = `secondary-fixed` + accent; warning = `tag-earth-3` amber;
  danger = danger tint.
- Optional `dot` (live-indicator dot, e.g. the 正在澄清 badge) and `count`
  (solid circular count badge, e.g. the 待处理 control).

## ContextChip / ProgressBar (packages/ui)

- `ContextChip` (`packages/ui/src/components/context-chip.tsx`): the single
  owner of the five earth-tone pairs (`tag-earth-N-bg/-text` in
  `colors.json`). Tone is chosen by the exported pure `contextTone(name)`
  (djb2 hash % 5) — deterministic, so user-created contexts get a stable
  color too. The tone class string is applied to the container **and** the
  `<Text>` (native runtimes do not cascade text styles). Two shapes: no
  `onPress` = read-only row chip (`accessibilityRole="text"`); with
  `onPress` = selector chip (role button, `active` adds an accent border,
  hitSlop gives a 44pt target around the 22px visual pill).
- `ProgressBar` (`packages/ui/src/components/progress-bar.tsx`): thin (h-1.5)
  fully-rounded bar — accent fill on a border-color track; `value` is a
  [0, 1] ratio clamped inside the component; exposes
  `accessibilityRole="progressbar"` + `accessibilityValue` (width is never
  the only signal).

- **DateTimePicker 模态弹窗与滚动体布局（Issue #50）**：
  在未设显式固定 `height` 的弹窗容器中（仅有 `max-height`），内部主体 `ScrollView` 严禁使用 `flex-1`（即 `flexGrow: 1, flexShrink: 1, flexBasis: 0`）。在 React Native Yoga 布局引擎下，未确定主轴高度的容器无法向 `flexBasis: 0` 的子项分配剩余空间，会导致滚动区域固有尺寸测量为 0、整个中间时间转盘坍塌消失。应使用 `className="shrink"` / `style={{ flexGrow: 0, flexShrink: 1 }}`，让 `ScrollView` 自适应由内容撑开，并在内容总高超过容器 `max-height` 约束时触发弹性收缩和内部滚动。

## App update (Settings 「应用更新」 card + startup 「发现新版本」 dialog)

- ONE flow behind two entry points: `apps/mobile/lib/app-update.ts` (feed fetch,
  version compare, installer pick, Tauri IPC wrappers) →
  `hooks/use-app-update.ts` (Settings card state machine) and
  `components/auto-update-dialog.tsx` (startup notifier — at most one prompt per
  version per session). Neither entry point owns a second copy of the version
  rules; the dialog is not a second implementation of the hook.
- The ChangeLog in both places is the GitHub release **body**, rendered as-is
  (source contract: the release-notes pitfall in
  `project/quality-guidelines.md`). Do not re-parse or re-format it.
- **Desktop install goes through `install_update_and_restart`.** The Rust command
  (`apps/desktop/src-tauri/src/lib.rs`) mounts the `.dmg`, spawns a detached
  helper that waits for the app to exit, `ditto`s the new bundle over the running
  one, clears quarantine and relaunches it; on Windows it launches the NSIS
  installer and exits. The user never has to quit the app or drag the installer.
  `open_downloaded_file` hands the file to the OS (Finder / NSIS) — that is the
  manual FALLBACK only (the install-failure state and the Settings card's
  「手动打开安装包」), never the primary 「立即安装并重启」 button.
- After the install command resolves, clear the installing flag only on Linux
  (system installer, no exit) — on macOS / Windows the process is already exiting
  and the promise never settles.
- Both entry points poll download progress with a 400 ms interval **plus one
  immediate read** after `download_update`, so a finished download shows without
  waiting a full interval.

## Settings & Multi-Section Screens

- **Semantic Section Grouping**: Group related settings into semantic categories (e.g. 「通用与偏好」、「提醒与通知」、「数据与同步」、「关于与更新」) using uppercase `SectionHeader` with matching `Ionicons` icons (`text-xs font-bold uppercase tracking-wider text-muted`). Avoid flat uninterrupted card stacks.
- **Desktop Width Constraint**: Single-column form screens and settings screens constrain content width to `max-w-2xl` (~672px) centered horizontally on wide viewports rather than stretching across `max-w-5xl`, preventing distorted full-width text inputs.
- **Component Cell Integration**: Prefer integrating single-purpose entry rows (such as 习惯管理 or 云同步) as list cells inside parent section cards (with icon badge and right `chevron-forward` / button) over creating isolated standalone single-row cards.

## Forbidden

- `console.*`, `alert()`, direct network calls, direct SQLite access in components.
- Side effects in render (assignment, `setState` during render, subscription setup — use effects or the data layer).
- Business rules (clarify logic, skip counting, deadline math) in components — that belongs in `packages/core`.
