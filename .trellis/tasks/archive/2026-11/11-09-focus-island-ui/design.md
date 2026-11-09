# Focus Island Design

## Boundary

The gap is continuous access to one session through an expandable island, including outside the main desktop window. It spans focus lifecycle, presentation, root mounting, and Tauri window management. A second full app root would duplicate database/sync services and leave pause/break state inconsistent. Keep one task because these parts share a lifecycle contract. No new task database, scheduler, or general event framework.

## Main-Window Session Owner

- Mount one controller below `PowerSyncProvider`, above navigation. Keep the session row in the data-hook owner. Expose low-frequency state transitions and commands through a provider; no second row store or new Zustand dependency. One-second display ticks stay in a display hook, outside shared Context.
- Lift pause-start, time-up dismissal/effect guards, pending operation, completion follow-up, and break deadline from `[id].tsx`. Keep input drafts, capture modal, and action-completion form state in the route.
- First focus entry attaches an action and recovers its active row. Same-action re-entry is idempotent. Another action cannot replace a live session/break; offer return to the current focus. Do not clean up legacy active rows. After process restart, recovery occurs when its focus route reopens; no automatic capsule startup or new pause/break persistence.
- Lifecycle mutations return a committed row or explicit failure. Guard overlapping operations synchronously, including double start and auto-start. Keep logging and visible errors. Capture one `now` per command and inject it into pure/query functions. Document the hook-guideline exception for the dedicated sub-minute runtime; do not use a stale minute tick to timestamp commands.
- Resume/complete/abandon account for an in-flight pause. If pause persistence succeeds but termination fails, rebase the pause anchor at that committed instant so retry cannot double-count it. Failed writes keep the appropriate active/paused UI; successful terminal writes alone enter completed/abandoned UI.
- One runtime effect owns time-up/break effects from absolute timestamps. Natural break expiry clears the deadline and enters `break-complete`. Route/capsule close does not cancel an owned break; explicit early end or owner teardown does.

## Shared Presentation

Add presentational `FocusIsland` to `packages/ui` and its public entrypoint. Props contain title, formatted clock, state text, optional progress, expanded state, callbacks/children. No DB/app imports. Reuse Button, Tag, ProgressBar, and tokens.

The main page composes the island with existing duration selection, capture, completion choice, and permission notice. The page fills available width; the compact island is intentionally bounded. Preserve safe areas, minimum targets, and keyboard access. Capsule titles truncate; expanded titles remain readable. Free timing has no percentage; preset progress clamps at the target. Continuing past time-up preserves the session and existing clock semantics.

Desktop controls: pause/resume, end session, continue after time-up, five-/ten-minute breaks, early break end, and open main. Capture, abandonment, and action completion remain in main. Ending from the capsule shows completion without forcing main to foreground.

## Lightweight Desktop Root

- Add `/focus-island` and select its lightweight root before normal providers/effects mount. Resolve native window identity through native metadata/initialization; URL parameters are not authorization.
- Mount only presentation, theme/fonts, and bridge. Never initialize PowerSync, reminder/calendar delivery, token hygiene, updates, or permission prompts. Enforce isolation through root composition.
- Scope transparent HTML/body/root/loading backgrounds to the capsule in the exported SPA shell (`scripts/post-export-web.mjs`); Expo single-output mode does not use `+html.tsx`. Preserve normal app appearance.
- Consume main's resolved theme from snapshots without writing preferences or calling its native theme setter. A plain browser on the desktop-only route gets a return action without native APIs.

## Narrow Bridge

Reuse pinned Tauri versions. Add JS API **2.11.1**, already selected by desktop, to mobile for official event listeners in a guarded web adapter. Keep Tauri execution off native mobile; do not implement its private callback protocol or add a polling bus.

| Message | Contract | Direction |
| --- | --- | --- |
| Snapshot | owner generation, revision, session/action ID/kind/title, phase, theme, clock anchors, pending/error | Main → native → capsule |
| Clock anchors | ISO start, planned minutes or null, paused seconds, pause-start or null, break-end or null | Display only; no stored decrementing countdown |
| Control | request ID, expected generation/session/revision, command enum; break minutes restricted to 5 or 10 | Capsule → native → main |
| Result | request ID, owner generation, success/error; the following snapshot carries the current revision | Main → capsule after required local commit |
| Ready/resync | Request latest state after listener installation | Capsule → main; never starts a session |
| Window action | Show/hide, expand/collapse, open main | Native command; no arbitrary URL/label arguments |

- One module owns TS types and decoding. Rust uses typed arguments and caller-label validation. Validate action kinds, finite clock values, command enums, and generation/session/revision association. Renderers receive normalized data.
- Generation distinguishes owner reloads; revisions order transitions. Ignore stale commands/out-of-order snapshots; resync on readiness/reconnect. Never automatically replay timed-out mutations.
- Main alone writes and delivers effects. Capsule derives its clock locally from anchors, without per-second IPC. A provisional time-up display cannot send notifications or claim successful mutation.
- Disable conflicting controls while pending. Delivery failure/bounded timeout shows a connection error and open-main recovery; resync before another write. Clean up asynchronous event subscriptions.
- Use directed native events and minimal capsule capabilities. Guard existing app commands too: removing plugin permissions alone does not restrict default-allowed application commands. Use centralized caller-label checks or equivalent app ACL to deny capsule access to secrets, updates, arbitrary URL opening, and calendar operations. Do not copy main's broad capabilities.

## Native Lifecycle

- Lazily create `focus-island`, hidden, at the existing app HTTP origin. Show after a usable snapshot. Frameless, topmost, transparent surroundings, and no focus theft. Do not parent it to main: Windows owned windows follow owner minimization.
- Position horizontally at the center of the current monitor work area. Following the user's position correction, macOS uses the physical screen top with zero gap, rather than the work-area top below the menu bar. Other platforms retain their work-area top plus 8 logical pixels. Convert physical/logical coordinates with scale factor; preserve the top and center on expansion, and clamp the bottom to the usable area. Provide a monitor-lookup fallback. Native observation must verify the actual position because AppKit may constrain a requested frame.
- Desktop collapsed bounds are 240x32 logical pixels with zero outer padding and a single-line header. The desktop-only compact variant preserves keyboard and accessible state; the in-app island keeps its original presentation and touch targets. Expanded width remains 420 logical pixels with readable full title/state and 44pt command controls. Bounds fit the visible content. No oversized transparent overlay, OS resizing, persistent positioning, or hover polling.
- Show once for a new controlled session. User hide remains effective until explicit show or a new session; updates cannot reopen it. Hide never abandons.
- Handle close by label. Main close keeps the owner alive; capsule close hides only capsule. Tray/macOS Dock restore main even while capsule is visible. Explicit quit closes both.
- Apply documented background-throttling support where available. Test main hidden for more than five minutes and recalibration after sleep. Unsupported/suspended owners get open-main recovery; browser tests cannot prove this behavior.
- Use pinned-version macOS transparency feature/config requirements from research; keep main opaque.

## Compatibility and Rollback

No migration, server change, history rewrite, or new storage format. Native creation failure leaves in-app focus usable with an error. Key risks: hidden-webview scheduling, compositing, Dock visibility, and duplicate root side effects. Ordinary desktop windows are the acceptance target; fullscreen/secure screens/native mobile overlays are excluded.

Extract lifecycle before native wiring to isolate regressions. Roll back feature code/config/dependencies together without touching session data or unrelated user edits.
