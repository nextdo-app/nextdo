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

## Forbidden

- `console.*`, `alert()`, direct network calls, direct SQLite access in components.
- Side effects in render (assignment, `setState` during render, subscription setup — use effects or the data layer).
- Business rules (clarify logic, skip counting, deadline math) in components — that belongs in `packages/core`.
