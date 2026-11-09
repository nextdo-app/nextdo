# Focus Island Implementation Plan

Status: accepted; closeout authorized. The user approved the final planning summary on 2026-11-09 and `task.py start` succeeded. Requirements: `prd.md`; contracts: `design.md`; evidence: `research/`.

## Change Boundary

| Area | Expected files | Purpose |
| --- | --- | --- |
| Lifecycle | `apps/mobile/hooks/use-focus-session.ts`, focus controller/provider and display hook | One owner, transient state survives navigation, explicit mutation outcomes |
| Focus UI | `apps/mobile/app/focus/[id].tsx` | Island with existing duration/capture/action flows |
| Shared UI | `packages/ui/src/components/focus-island.tsx`, `src/index.ts` | Same presentational capsule in both windows |
| Root/client | `apps/mobile/app/_layout.tsx`, `scripts/post-export-web.mjs`, `app/focus-island.tsx`, bridge under `lib/` | Lightweight root, scoped transparency, typed transport |
| Desktop | `apps/desktop/src-tauri/src/lib.rs`, focused module if useful, Cargo/config/capabilities | Native lifecycle, caller checks, geometry and transparency |
| Dependencies | Mobile `package.json`, `pnpm-lock.yaml`; Cargo lock only if resolution changes | Pinned official Tauri API; no framework upgrade |
| Tests | Focus screen/controller/bridge/root tests, affected router mocks, native helper tests | Behavioral and boundary regressions |

Review Now, Clarify, notification links, theme, and root test mocks. Edit only where the shared-root contract requires it. No unrelated pages, schemas, server code, or user edits.

## Ordered Work

1. [x] After approval, validate manifests and run `task.py start`. Use `trellis-before-dev`; record dirty paths. Dispatch `trellis-implement` with this task path, direct implementation, and explicit ownership; no nested implement/check agents.
2. [x] Extract the main-root owner. Preserve recovery and entry points. Fix mutation outcomes, duplicate starts, paused terminal retries, and break expiry with behavioral regressions.
3. [x] Build the shared island and refit focus UI. Preserve capture, custom validation, two-minute auto-start, and action completion. Check extraction has not changed unrelated behavior.
4. [x] Add bridge contracts and lightweight root. Test zero second DB/sync/calendar/reminder/updater instances. Guard platform imports and scope transparency.
5. [x] Add native create/show/hide/resize/restore and directed commands. Restrict capabilities and app commands. Correct two-window tray/Dock/close behavior.
6. [x] Wire snapshots, controls, theme, readiness, cleanup, timeout/reconnect, and failures. Test stale/concurrent commands and pause failure retries.
7. [x] Dispatch `trellis-check` for full-scope review/fixes. Use ponytail-review to remove unnecessary abstractions. Preserve unrelated dirty files.
8. [x] Run full gate, browser checks, and available native checks below. Record actual evidence and limitations.
9. [x] Review spec updates for the owner/bridge and timing exception. Follow normal commit/finish workflow. Do not publish installers/releases for this task.

## Behavioral Tests

| Case | Observable assertion |
| --- | --- |
| Preset/free + expand/collapse | Correct clock/progress, one session, timing continues |
| Auto-start/double-click/two windows | No duplicate accepted start/terminal mutation |
| Pause → navigate/hide → resume | Same paused clock; accumulated pause stored once |
| Pause → finish fails → retry | No false completion/double-counted pause; navigation waits |
| Time-up → collapse/reopen/continue | Effects once; same session continues |
| Complete → break → expire/end early | Distinct break completion; obsolete reminder canceled |
| Session completion → action choice | Action untouched until explicit completion |
| Different action while live | Existing focus remains controlled and reachable |
| Ready/stale generation/session/revision | Resync succeeds; stale commands cannot mutate current data |
| Window/bridge/write failure | Visible error; main usable; no false success |
| Capsule root/privileged call | No duplicate services; non-focus native call rejected |
| Theme/title/keyboard/narrow width | Readable state, accessible expansion, usable controls |

Use injected/fake time and existing DB mocks. Regression tests must fail if the guarded behavior is removed; do not merely mirror component structure.

## Commands and Browser Evidence

- Inner loop: `pnpm --filter @nextdo/mobile test --runInBand focus-screen`, corresponding new test filenames, `pnpm lint`, and `pnpm typecheck` as appropriate.
- Final gate: **`pnpm verify:web`**, without skipping tests/build. Fix failures before browser checks.
- Open its printed `http://localhost:4180` in a real browser. Exercise start, expansion, pause/resume, time-up, completion choice, breaks, capture, custom input errors, and injected write/bridge failures in isolated test data.
- Save evidence under `.verify/focus-island-ui/`: for example `web-collapsed-light.png`, `web-expanded-dark.png`, `web-mobile.png`, `web-paused.png`, `web-time-up.png`, `web-break-complete.png`, `web-write-error.png`. Record viewport and steps.
- Keep temporary harnesses/evidence in that ignored directory. Remove only task-generated web/desktop build artifacts afterward; preserve artifacts from other work.

## Native Verification

- AC5 requires native observation. Use `pnpm --filter @nextdo/desktop dev` when GUI execution is available; request actual sandbox/GUI permission if required. Put Rust output in a temporary target directory. Never run local `tauri build` or create installer packages.
- Switch to another ordinary app; hide/minimize main for more than five minutes; pause/resume/end via capsule; compare both views after restoring main. Check sleep/wake recalibration when available.
- Check compact/expanded bounds, monitor/DPI placement, theme/transparency, no focus theft, hide/show without ending, close behavior, tray restore, and macOS Dock restore with capsule visible.
- Save `.verify/focus-island-ui/desktop-*.png`, with OS/version and observed timings. Unavailable native checks remain explicitly unverified; do not claim full desktop completion.
- Inspect/check Rust on the available host without packaging. Current `ci.yml` runs JS checks only. Cross-platform compilation requires separate evidence. Release packaging belongs to `release.yml`; do not trigger publication merely for verification. Never infer Windows/Linux runtime results from macOS/browser checks.

## Checkpoints

- After extraction: compare existing focus behavior before appearance changes.
- After root split: inspect main startup/font/error loading and capsule startup separately.
- After native wiring: verify restrictions and actual background behavior.
- Material scope/behavior changes return to planning review. Routine implementation details remain within this plan.

## Final handoff

Steps1–9 are complete through verification and spec synchronization. The final
user refinement uses macOS visible y0 and desktop collapsed240x32 with zero
outer padding. In-app layout, expanded420pt panel, timer ownership, and IPC
remain intact. Full web gate100 suites/1551 tests, browser checks, Rust8/check,
and native geometry/control observations passed. The user accepted the result
and authorized artifact cleanup and commit. Remaining platform/background limits
are recorded explicitly in `verification.md` and are not reported as verified.
