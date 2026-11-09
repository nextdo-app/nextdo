# Focus Island for Nextdo

## Goal

Replace the large focus timer card with a compact, expandable focus island. Keep the current action and timer visible above ordinary desktop applications while the user works elsewhere. Reuse Nextdo's session history and action workflow.

Status: accepted by the user on 2026-11-09; ready for commit and archive. The user selected option 1 for the independent desktop capsule, then approved the final planning summary with a subsequent option 1 on 2026-11-09. Implementation is authorized.

## Background

- The reference [README](https://github.com/ipfred/focus-island/blob/master/README.md) describes a desktop top capsule, task panel, focus/break timers, statistics, memos, and radio. This adaptation uses the capsule and focus controls; Nextdo already owns tasks and quick capture.
- Reference [CapsuleFocus.vue](https://github.com/ipfred/focus-island/blob/master/src/components/CapsuleFocus.vue) renders the current task, countdown, phase color, and pause indicator.
- Nextdo's current focus route renders the full focus card at `apps/mobile/app/focus/[id].tsx:321`. Its screen-local pause and break state appears at lines 84 and 231.
- Existing session commands and recovery live in `apps/mobile/hooks/use-focus-session.ts:30`. Timer completion and action completion are separate operations (`apps/mobile/app/focus/[id].tsx:272`).
- Existing focus-screen regression coverage starts at `apps/mobile/__tests__/focus-screen.test.tsx:211`.
- The desktop shell creates the `main` window (`apps/desktop/src-tauri/src/lib.rs:828`), hides windows on close (`:919`), and restores `main` from the tray (`:858`). The inspected window flow has no independent focus capsule. Capabilities currently apply to `main` only (`apps/desktop/src-tauri/capabilities/default.json:5`).
- These findings come from source inspection, not runtime verification.

## Requirements

- **R1 — Compact presentation.** Show action title, clock, and text state in a top capsule. Preset timing shows remaining time and bounded progress; free timing shows elapsed time without a fictional target. Long titles truncate in the capsule and remain readable when expanded.
- **R2 — Expandable controls.** Click/tap or keyboard activation expands/collapses the island without restarting focus. The desktop window fits its content instead of placing an oversized transparent input surface over other apps. No hover-only controls.
- **R3 — Preserve workflows.** Retain presets 15/25/45/60, custom 1–180 minutes, remembered duration, free timing, pause/resume, complete/abandon, and quick capture. Preserve Clarify's two-minute auto-start and existing links. Desktop capsule controls include pause/resume and session completion; quick capture and abandonment remain in the main focus page.
- **R4 — Time-up and breaks.** Time-up offers continuing the same session or ending it. After completion, retain five-/ten-minute breaks and early break end. Show a distinct break-complete state. Expansion, route re-entry, and window switching must not duplicate time-up sounds/notifications. Notification denial does not block timing.
- **R5 — Separate completion.** Session completion records focus history only. Action completion requires a separate explicit choice in the main page. The desktop island links back to that choice and never completes the action itself.
- **R6 — Accessible UI.** Use Nextdo light/dark tokens, safe areas, readable text, labeled keyboard-accessible controls, visible expanded state, and at least 44pt touch targets for in-app and expanded controls. The desktop-only collapsed island uses a 32pt pointer/keyboard target to fit the menu-bar band, following the user's compactness request. Support narrow and wide layouts.
- **R7 — Independent desktop window.** Show a frameless, transparent-surround, topmost capsule at the horizontal center of the current monitor's usable area. On macOS, anchor its visible top at the physical screen edge (0pt gap), following the user's latest position correction; other platforms keep the 8pt usable-area gap. The desktop collapsed island is 240x32 logical pixels, with no outer padding; expansion retains a 420pt-wide readable panel. Keep it visible above ordinary apps and when main is hidden/minimized. Showing/updating it does not steal focus. Users can hide it without stopping focus and show it again from main. Browser/mobile use an in-app island. The independent desktop scope is user-confirmed by option 1.
- **R8 — One live controller.** Main and capsule control the same session. Pause/break/time-up state survives route changes and main hide/minimize during the app lifetime. After restart, reopening the focus route recovers its stored active session, as today. Opening a different action must not silently replace a controlled live session; guide the user back to it. Do not rewrite old session history.
- **R9 — Honest failures.** Show local-write/window/bridge errors with recovery. Never show successful resume/end before required writes succeed. Reject stale or overlapping commands. If main stops responding, show a connection error and offer to open it. Preserve pause accounting on failed termination. Related existing defects: `use-focus-session.ts:97,112` returns no success signal; `[id].tsx:272` switches to completion unconditionally; `[id].tsx:242` leaves the expired break deadline set while `:359` prioritizes it over break completion. These defects must not be carried into the shared controller.

## Constraints

- Follow existing NativeWind tokens and component accessibility conventions.
- Keep changes limited to the selected focus-island scope. Existing unrelated server and database-guideline edits belong to the user.
- Use existing session persistence where possible; changes to its contracts require explicit design and regression coverage.
- No database schema, server, or sync-protocol change is required.
- The capsule must not initialize another database/sync connection, reminder/calendar service, token check, or updater. Restrict its native commands to focus-window operations.
- Build distributable desktop packages through GitHub Actions, not local `tauri build`.

## Acceptance Criteria

- [x] AC1 (R1–R2): Preset/free clocks and progress are correct across expand/collapse; no extra session is created. Long titles remain readable.
- [x] AC2 (R3, R8): Existing duration, validation, auto-start, pause/resume, abandon, and capture flows work. Route re-entry/main hiding retain live pause/break state. Another action cannot silently take over.
- [x] AC3 (R4–R5): Time-up, continuing, completion, breaks, and separate action completion are reachable. Natural break expiry leaves `00:00` and shows completion. Each time-up effect occurs once per session in the running app.
- [x] AC4 (R6): Browser checks cover narrow/wide, light/dark, keyboard expansion, accessible names, and touch targets.
- [x] AC5 (R7–R8): Accepted with disclosed limits: macOS checks cover app switching, main close/minimize, capsule hide/show, expansion, open-main restoration, and shared controls. Tray/Dock, extended background, sleep/wake, and other-OS checks remain unverified in verification.md. Browser checks do not prove topmost behavior.
- [x] AC6 (R9): Injected write failures do not show completion or advance navigation; retries preserve pause accounting. A stale command cannot mutate a newer session. Bridge/window failure leaves main usable.
- [x] AC7 (all): Focus regressions and full `pnpm verify:web` pass. Browser checks include failure states and screenshots under `.verify/focus-island-ui/`. Record Rust/native coverage separately.

## Out of Scope and Compatibility Limits

- Radio/music streaming, a second task/memo system, new statistics dashboards, and a theme-customization panel.
- Unrelated Now/Settings redesign and server/sync changes.
- Mouse polling, hover expansion, global shortcuts, persistent custom positions, and cross-device session locking.
- Fullscreen-exclusive apps, secure OS screens, and a universal all-Spaces overlay guarantee. Ordinary desktop windows are the acceptance target.
- No new pause/break persistence across process termination. Stored session timestamps support route re-entry; pause-start and break UI state remain app-lifetime state. Quitting Nextdo closes the island.
- Hidden-webview scheduling differs by OS. Check it natively and do not report an untested platform as verified.

## Planning Artifacts

- `prd.md`: requirements and acceptance, including confirmed desktop scope.
- `design.md`: controller, presentation, bridge, and window design.
- `implement.md`: ordered implementation and verification plan.
- `research/`: code and third-party API evidence.
- `implement.jsonl` and `check.jsonl`: spec/research context for implementation and review.

## Verification Status

The user accepted the final 240x32 desktop island at visible y0 on 2026-11-09
and requested cleanup and commit. The full web gate passed100 suites/1551 tests;
browser and native compact geometry/control checks passed. See `verification.md`
for exact observations and unverified platform/background limits. Temporary
verification artifacts and local build output are removed per the user's request.
