# Verification and acceptance

The user accepted the final focus island on 2026-11-09 and explicitly requested
cleanup of temporary files/local build output and a commit. Remaining platform
checks below are disclosed limitations, not claims of verification.

## Final result

- Desktop collapsed window: 240x32 logical pixels, visible top at y0 on macOS.
- Expanded window: 420 logical pixels wide; final observed height 212.
- The compact header shows phase, truncated title, and clock on one line.
  Expansion shows the full title and controls. In-app/mobile defaults retain
  their previous layout and touch targets.
- macOS status-window level25 is applied once after creation. Other platforms
  retain their 8pt work-area gap. The compact desktop header deliberately uses
  a 32pt pointer/keyboard target to avoid an invisible overlay below the menu bar.

## Automated checks

- `pnpm verify:web --no-serve`: passed lint, workspace type checks, 100 suites /
  1551 tests, Expo web export, and PWA postprocessing.
- `CARGO_TARGET_DIR=/private/tmp/nextdo-focus-island-target cargo test
  --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked --offline`:
  passed all 8 tests.
- The corresponding `cargo check --locked --offline`: passed.
- Scoped formatting checks and task-owned `git diff --check`: passed.
- Final full-scope code review found no blocking defect across app runtime,
  database mutation outcomes, lightweight root, IPC permissions/validation,
  native lifecycle, and compact UI.

## Browser observation

The isolated Chrome harness exercised the actual exported application with
pointer events and keyboard Enter. Twelve in-app screenshots covered invalid
custom duration, compact/expanded layouts, pause, failed terminal writes,
continuation after time-up, breaks, natural break completion, dark/narrow layout,
quick capture, and auto-start recovery. All assertions passed with no uncaught
browser exceptions. An injected terminal-write failure kept the session active
and retry did not double-count pause duration. Session end left the action open.

The additional compact desktop browser fixture checked:

- Actual DOM bounds x0/y0/240x32, including a long title and 13-hour clock.
- Title truncation and clock/phase remaining inside the panel.
- `aria-describedby` reaching the browser accessibility tree with complete
  title, phase, and clock; `aria-expanded` updates correctly.
- Keyboard Enter expansion, paused controls, dark compact rendering, and 32px
  height after re-collapse.

The browser fixture supplies only a test IPC adapter; native observations below
establish native window behavior independently.

## Native observation

Host: macOS 27.2 (26B123). The isolated `tauri dev` app used identifier
`com.nextdo.focusisland.verify` and origin `http://127.0.0.1:4180`; no installed
Nextdo app or user database was used. No installer build was run for this task.
Accessibility and Screen Recording permissions were available.

Final process51822/window37171 inspection and screenshots showed:

- Collapsed: x615, y0, width240, height32; level25.
- Expanded: x525, y0, width420, height212; level25.
- Collapse/expand and island hide/show preserve the top edge and center.
- Pause and resume synchronize between main and island.
- Hiding/showing the island preserves the paused session.
- Main close hides main while the island remains visible. The island's open-main
  control restores main without changing island geometry.
- The top-center screen screenshot shows the collapsed panel within this host's
  33pt menu-bar band, with the application text below it unobscured.
- Previous native observations covered main minimization, ordinary-app topmost
  order, focus preservation, and transparent surroundings. Native pixel-alpha
  checks confirmed transparency after fixing the actual exported SPA shell.

The final compact/expanded and screen-top screenshots were visually inspected.
This establishes the tested monitor's geometry; it does not guarantee an empty
menu-bar center for every application or monitor configuration.

## Unverified limits accepted at closeout

- More than five minutes hidden followed by controls; sleep/wake recalibration.
- Native keyboard navigation and tray/Dock restoration; browser keyboard
  expansion and island open-main restoration were verified separately.
- Windows/Linux runtime behavior, mixed-monitor runtime placement, and fullscreen
  or secure-screen overlay behavior.

## Evidence cleanup requested by user

Screenshots, logs, and one-off harnesses were generated under
`.verify/focus-island-ui/`, with final compact evidence in its `compact-top/`
subdirectory. The user explicitly requested their deletion after acceptance.
This document preserves the observed results; those temporary evidence files
are not shipped or retained as repository artifacts.

The test app and server were stopped. Cleanup removes the task's verification
folder, `apps/mobile/dist`, local `apps/desktop/src-tauri/target`, task-specific
Rust/Swift caches, temporary web exports/configs, and isolated browser profiles.
Distributable installers remain the responsibility of GitHub Actions.
