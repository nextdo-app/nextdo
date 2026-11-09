# Focus Island Contract

## 1. Scope / Trigger

Use this contract when changing the focus route, `FocusProvider`, its runtime,
the desktop capsule, or Tauri application commands. Desktop and main share one
session; a second window must not become a second database/effect owner.

Source owners:

- `hooks/use-focus-session.ts`: local row read/write results.
- `hooks/use-focus-runtime.ts`: app-lifetime transitions and effect guards.
- `hooks/use-focus-display.ts`: timestamp-derived clock, local display tick.
- `lib/focus-island-contract.ts`: typed payloads and runtime guards.
- `components/focus-desktop-bridge.tsx`: main command dispatch and snapshots.
- `components/focus-island-client.tsx`: presentation, pending/error/reconnect UI.
- `apps/desktop/src-tauri/src/focus_island.rs`: native windows and directed IPC.

## 2. Signatures

Lifecycle writes return `Promise<FocusSession | null>`, where null means failure.
`start({ actionId, actionKind, minutes, now })`,
`recordPause(sessionId, pausedSec, now)`, `complete(sessionId, now)`, and
`abandon(sessionId, now)` receive the command timestamp. Capture a fresh timestamp
once per command in the dedicated runtime (Hook Guidelines' sub-minute exception).
The ordinary app clock's last minute tick is not a command timestamp.

| Native invoke | Authorized caller | Input |
| --- | --- | --- |
| `focus_island_show` | `main` | none |
| `focus_island_hide` | `main`, `focus-island` | none |
| `focus_island_resize` | `focus-island` | `expanded: boolean`, finite `height: number` |
| `focus_island_open_main` | `focus-island` | none |
| `focus_island_ready` | `focus-island` | none |
| `focus_island_publish` | `main` | `{ snapshot }` |
| `focus_island_command` | `focus-island` | `{ request }` |
| `focus_island_reply` | `main` | `{ result }` |

These invokes return transport/window success, not database mutation success.
Existing privileged application commands remain main-only. Validate the actual
invoking webview label in the dispatcher; a caller-supplied label is not identity.

## 3. Contracts

- Snapshot: `generation`, monotonic `revision`, nullable `sessionId`/`actionId`/
  `actionKind`, `title`, `phase`, nullable `startedAt`/`endedAt`,
  `plannedMinutes`, `pausedSec`, nullable `pauseStartedAt`/`breakEndsAt`,
  `breakMinutes`, `isDark`, `busy`, and nullable `error`.
- Phases: `idle`, `running`, `paused`, `time-up`, `completed`, `break`,
  `break-complete`. Planned minutes are null or an integer 1–180; break minutes
  are null, 5, or 10. The TypeScript decoder checks ISO date parsing; native
  validation bounds strings and numeric fields from the authorized publisher.
  Numeric instants must be finite.
- Request: `requestId`, `generation`, `revision`, `sessionId`, `command`.
  Commands: `pause`, `resume`, `complete`, `continue`, `break-5`, `break-10`,
  `end-break`, `finish-break`. Abandonment/action completion stay in main.
- Result: `requestId`, `generation`, `ok`, nullable `error`. Correlate it to the
  pending request; only the owner acknowledges the committed result.
- Directed events: `focus-island:snapshot`, `focus-island:command`,
  `focus-island:result`, `focus-island:ready`, `focus-island:open-main`.
  Register listeners before requesting readiness; dispose async subscriptions.
- `window.__NEXTDO_FOCUS_ISLAND__` is a native-injected UI routing marker only.
  It selects the lightweight root and transparent backgrounds before normal
  providers mount. It does not authorize native calls.
- Expo `web.output='single'` uses the shell modified by
  `apps/mobile/scripts/post-export-web.mjs`, not `app/+html.tsx`. Put the marker
  bootstrap, scoped `html`/`body`/`#root` transparency, and capsule service-worker
  exclusion in the actual exported shell. Check the emitted HTML and native
  screenshot alpha; React root tests alone cannot prove window transparency.
- No new settings, secrets, schema fields, or environment keys are required.
  The capsule follows main's resolved theme and never writes it back.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Malformed payload/enum array instead of string | Reject at decoding; do not coerce with `String(value)` |
| Wrong window invokes a privileged command | Native rejection before its handler executes |
| Stale generation/session/revision or busy owner | Failed result; no mutation |
| Active-session recovery read fails | Keep recovery unloaded; block new sessions and offer explicit retry |
| Retry recovers an existing active row | Reuse that row; never insert a replacement session |
| Pause write fails | Keep paused state and visible error |
| Pause commits, then end fails | Keep active row; rebase pause anchor to prevent retry double-counting |
| End commits | Enter session-completed UI; action remains unchanged |
| Reply times out | Show uncertainty and open-main/reconnect actions; no automatic mutation replay |
| Old snapshot/result arrives after reconnect | Ignore it; never regress the displayed owner state |
| Native window creation fails | Main focus flow remains usable; expose the error |

## 5. Good / Base / Bad Cases

- Good: pause in main, navigate away, resume through the capsule; one row owns
  accumulated pause and both views use its clock anchors.
- Base: browser/mobile use the in-app island without invoking desktop APIs.
- Bad: mounting the normal root in the capsule duplicates PowerSync, reminder/
  calendar services, token checks, and update prompts.
- Bad: parenting the capsule to main hides it with its owner on Windows.
- Window bounds fit the visible panel. Center horizontally in the work area,
  respecting scale factor and negative coordinates. On macOS, anchor the top
  to the physical screen top with zero gap; other platforms retain
  the work-area top plus 8 logical pixels. The native collapsed window is
  240x32 logical pixels with no client outer padding; do not leave an invisible
  72pt minimum window after shrinking the content. This desktop pointer/keyboard
  header is the deliberate 32pt target exception; the regular in-app island
  and expanded command controls retain 44pt minimum targets. Clamp the bottom to the work area. Verify the actual
  native frame because AppKit can constrain requested coordinates. Set the macOS
  capsule's native status-window level (25) once after creation, through
  `with_webview` on the main thread, so it can occupy the menu-bar band. Do not
  repeat this native-handle callback on each resize: pinned Tauri retains its
  platform handles. Hide is not abandon. Dock/tray restore main
  even while the capsule is visible.
- Resize from the visible, bounded panel height, not unbounded scroll content;
  long titles/errors must remain scrollable without breaking the connection.
- Verify expansion in the browser DOM: the installed React Native Web drops
  `accessibilityState.expanded`, so expose `aria-expanded` explicitly as well.
- On pinned Tauri 2.11.6, macOS transparency needs `macos-private-api` and config
  support. macOS `show()` can request focus despite unfocused creation; preserve
  main/other-app focus while retaining later keyboard interaction.
- Disabling background throttling is supported on macOS 14+, not universally
  across desktop platforms. Timestamps correct display drift; they cannot run
  suspended writes/notifications. Native checks must establish the actual limit.

## 6. Tests Required

- Focus flows: preset/free/custom/auto-start, route re-entry, pause/end failure
  retry, natural break expiry, once-per-session effects, separate action completion.
- Bridge: malformed inputs, stale/concurrent commands, result correlation,
  timeout without auto-retry, reconnect and owner-generation changes.
- Root isolation: capsule mount creates zero normal DB/startup services.
- Native boundary: caller allowlist, payload validation, work-area geometry.
- Final `pnpm verify:web` plus browser interaction screenshots. Native app
  switching, main hide/minimize, topmost, transparency, bounds, focus, and tray/
  Dock behavior need native observations with OS/version recorded. Browser
  mocks and Rust compilation are not native runtime evidence.

## 7. Wrong vs Correct

Wrong: `await complete(id); setCompleted(true)` when the hook catches errors and
returns no success signal. A failed write looks completed.

Correct: `const saved = await complete(id, now); if (saved !== null) ...`;
only advance UI/navigation after a committed result.

Wrong: decrement a second stored countdown in the capsule, or publish one IPC
message per second through shared Context.

Correct: publish state transitions and clock anchors; derive each view's clock
locally with `focusDisplay(snapshot, now)`.
