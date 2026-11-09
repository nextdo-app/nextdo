# Research: Desktop focus capsule APIs and window isolation

- Query: Identify the supported Tauri window, event, security, and timing APIs for a standalone always-on-top focus capsule; preserve one authoritative focus controller in the main window.
- Scope: mixed; source inspection and current official documentation, without implementation or native runtime tests.
- Date: 2026-11-09

## Findings

### Versions and files found

| File | Relevant evidence |
| --- | --- |
| `apps/desktop/package.json` | JavaScript API 2.11.1; CLI 2.11.5. |
| `apps/desktop/src-tauri/Cargo.toml` | Tauri 2.11.6 with `tray-icon`; no explicit `macos-private-api` feature. |
| `apps/desktop/src-tauri/tauri.conf.json` | Windows are created in Rust; `app.macOSPrivateApi` is absent. |
| `apps/desktop/src-tauri/build.rs:1` | Calls `tauri_build::build()`; no app command ACL manifest. |
| `apps/desktop/src-tauri/capabilities/default.json:5` | Existing capability applies only to `main`; includes core, Stronghold, and notification permissions. |
| `apps/desktop/src-tauri/src/lib.rs:828` | Main window creation; existing development/release frontend bases must also resolve the capsule entry. |
| `apps/desktop/src-tauri/src/lib.rs:919` | Existing close handling hides every window; capsule behavior requires label-specific handling. |
| `apps/desktop/src-tauri/src/lib.rs:948` | macOS reopen uses overall window visibility; a visible capsule must not prevent restoration of main. |
| `apps/mobile/app/+html.tsx:43` | Opaque document backgrounds require a capsule-scoped transparency override. |
| `apps/desktop/node_modules/@tauri-apps/api/event.js:71` | Official event listener implementation returns asynchronous cleanup; use the supported API rather than its private protocol. |

Pinned Rust source references below use `T = /Users/printsdf/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.6/src`. The installed companion config source is `U = /Users/printsdf/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-utils-2.9.3/src/config.rs`.

### Window construction and platform limits

| Concern | Pinned source / official API | Consequence for this task |
| --- | --- | --- |
| Frameless topmost window | `T/webview/webview_window.rs:549`, `:564`: `decorations(false)`, `always_on_top(true)` | Create a separate named webview window; keep creation, sizing, and visibility in Rust. |
| Initial focus | `T/webview/webview_window.rs:535`: `focused(false)`; `:864`: separate `focusable(bool)` | Initial unfocused creation does not make the window permanently non-focusable. Keep keyboard interaction possible; test showing an existing capsule without stealing focus. |
| Independence from main | `T/webview/webview_window.rs:618`: parent/owner behavior | Do not set `parent(&main)`. Windows hides owned windows when the owner is minimized; macOS creates a child window. |
| Transparency on pinned macOS version | `T/webview/webview_window.rs:1075`: method is gated by `macos-private-api`; `U:3071`, `U:3098`: `app.macOSPrivateApi` maps to that feature | Set the v2 config field and ensure the Cargo feature is enabled for direct Cargo checks. Current project configuration does not yet satisfy this. |
| Taskbar and workspace behavior | `T/webview/webview_window.rs:590`; `T/window/mod.rs:583` | `skip_taskbar(true)` is unsupported on macOS. `visible_on_all_workspaces(true)` is unsupported on Windows. Do not promise identical virtual-desktop or full-screen behavior. |
| Native shadow | `T/webview/webview_window.rs:612` | Linux shadow API is unsupported. Windows undecorated shadows add a 1px border; use an explicitly chosen shadow policy and verify the transparent edge. |
| Position and size units | `T/webview/webview_window.rs:799`, `:806` | Builder positions and sizes are logical pixels. |
| Monitor bounds | `T/window/mod.rs:90`, `:96`, `:101`: monitor position, work area, scale factor | Work area is a physical rectangle with signed position. Derive top-center placement in one coordinate system; convert logical capsule size by the monitor scale before computing physical placement. Preserve negative monitor coordinates. |
| Runtime size and position | `T/webview/webview_window.rs:2232`, `:2255` | Resize and reposition through Rust on expansion/collapse. Keep the visible capsule centered and inside the work area; recheck after monitor/scale changes. |

Create the capsule hidden, initialize listeners, obtain the first authoritative snapshot, and then show it. This avoids exposing an empty or opaque route during initialization. The HTML/body, React Native Web root, and capsule content all require compatible backgrounds; native transparency alone is insufficient.

**Documentation version drift:** the live [configuration reference](https://v2.tauri.app/reference/config/#macosprivateapi) says `macOSPrivateApi` is a no-op from **2.12.1** because these APIs are always enabled. That statement does not apply to this repository's **2.11.6**. Its local source still compile-gates transparency. `U:2022` also documents the private-API App Store restriction for this pinned generation; this task does not change the release channel.

### Command authority and event transport

The official [capabilities guide](https://v2.tauri.app/security/capabilities/) explicitly states that application commands registered with `invoke_handler` are available to every app window by default. It documents `AppManifest::commands` as the way to opt into application command ACLs. Pinned implementation confirms this at `T/webview/mod.rs:1794` and `:1820`: plugin calls, app-ACL-enabled calls, and remote calls undergo ACL rejection; a local custom command without an app manifest does not gain per-window protection from plugin capabilities.

Therefore, adding a narrow capsule capability is necessary but does not isolate the existing custom commands. Guard both new focus bridge commands and existing main-only application commands. For the smallest change, inject `tauri::WebviewWindow` into each relevant command and apply a shared caller-label check. `T/webview/webview_window.rs:1487` derives this value from the actual IPC message's webview, so it is not a caller-supplied identity. An alternative is a complete app command manifest plus explicit per-window command permissions; do not introduce a partial manifest without checking every existing command.

Recommended transport contract:

1. Main alone mounts the existing database/sync providers, focus controller, and notification effects. Its authoritative transition state includes pause/break state. Each view calculates its displayed seconds locally from timestamps; do not broadcast seconds through shared React context.
2. The capsule mounts a lightweight entry that displays a minimal snapshot and issues a closed set of commands. It does not initialize another PowerSync provider or app startup effects.
3. Main-only publish commands accept a bounded snapshot. Capsule-only action commands accept an action enum, session identity, and request identity. Rust validates the actual caller, validates the payload, and selects the destination itself. Never accept an arbitrary target label or event name from the caller.
4. Rust uses `Emitter::emit_to`, preferably `EventTarget::webview_window(...)`, to deliver snapshots to the capsule and action requests to main. Pinned evidence: `T/lib.rs:981`. Avoid global delivery of focus data.
5. Use the official JavaScript 2.11.1 listener API in the web adapter. If imported from `apps/mobile`, declare that exact package version there; desktop's dependency alone is not the mobile workspace's dependency. Await listener registration before the ready/snapshot request and call the returned unlisten function on cleanup, including cleanup after a pending registration resolves.
6. Define matching TypeScript/Rust payloads and validate runtime input. Include session identity and a monotonically increasing revision to reject stale transitions. A command needs an authoritative success/error acknowledgment tied to its request identity. The Rust invoke succeeding only proves forwarding succeeded, not that the database mutation succeeded.
7. On acknowledgment timeout, show a recoverable error and offer a native `open main` action. Do not silently mark the command successful. Retrying a timed-out mutation requires deduplication or an idempotent operation because timeout does not prove the original command was unexecuted.

The capsule can be limited to event listen/unlisten permissions and its validated custom invokes. It does not need Stronghold, notification, broad window creation, or arbitrary event-emission permissions. The official [calling-frontend guide](https://v2.tauri.app/develop/calling-frontend/) states that events have no fine-grained capability control over event data/channels. Consequently, a small listener capability is not a payload security boundary; keep event data minimal and targeted. The [calling-rust guide](https://v2.tauri.app/develop/calling-rust/) documents both injected `WebviewWindow` parameters and listener cleanup. Generic TypeScript event types do not provide runtime type safety.

### Main-window suspension is a real reliability limit

`T/webview/webview_window.rs:1188` and the live [backgroundThrottling reference](https://v2.tauri.app/reference/config/#backgroundthrottling) describe default throttling and possible view suspension/unloading after roughly five minutes hidden or minimized. This is documented behavior, not an exact deadline measured in Nextdo.

`WebviewWindowBuilder::background_throttling(BackgroundThrottlingPolicy::Disabled)` is supported on **macOS 14+** and iOS 17+. It is **unsupported on Windows/Linux/Android**. `U:1838` defines `Disabled`, `Suspend`, and `Throttle`. Apply the supported policy to main, which owns completion effects and DB writes; applying it only to the visible capsule does not protect the controller. The documentation mentions a pending WebLock as a possible workaround, but does not establish a cross-platform guarantee. Do not claim one.

Timestamp-based local rendering prevents countdown drift after a delayed render. It does not execute a suspended controller's DB write, notification, or pause/resume action. The visible capsule can remain responsive while main is unavailable. Its deadline display must not imply that an unacknowledged completion was persisted. Native acknowledgment timeout plus restoration of main is a bounded recovery path. Guaranteed completion while main is suspended would require a different authority/timer design; that is outside this narrow main-authoritative proposal.

### Related specifications and acceptance evidence

- `.trellis/workflow.md`: research precedes implementation; this artifact supplies evidence for the planning documents.
- `.trellis/spec/index.md`: desktop loads the Expo web application; local database remains the source of truth; package versions use exact pins.
- `.trellis/spec/project/quality-guidelines.md`: final application changes require `pnpm verify:web`, affected UI exercise, and screenshots under a task-specific `.verify/` directory. Installer builds belong to GitHub Actions.
- Future native checks must cover app switching; main hide/minimize for more than five minutes; pause/resume/end command acknowledgment; controller failure recovery; one DB transition and one notification per completion; top-center placement on different DPI monitors; transparent edges; expanding/collapsing without unwanted focus; tray/Dock reopening main while the capsule is visible.
- Use `.verify/focus-island-ui/` for browser evidence. Browser tests cannot establish native topmost, transparency, workspace, focus, or background-controller behavior. Native results must name the OS/version; macOS results do not verify Windows or Linux.

### External references checked

- [Tauri v2 configuration](https://v2.tauri.app/reference/config/) — live documentation, accessed 2026-11-09; contains newer-version differences described above.
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/) — application command defaults and app manifest.
- [Tauri permissions](https://v2.tauri.app/security/permissions/) — permission system context.
- [Calling the frontend from Rust](https://v2.tauri.app/develop/calling-frontend/) — targeted events and event-system limitations.
- [Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/) — caller-window injection and official event listener APIs.
- [Pinned Rust WebviewWindowBuilder API](https://docs.rs/tauri/2.11.6/tauri/webview/struct.WebviewWindowBuilder.html) — version-specific reference; API details were checked against the installed 2.11.6 source listed above.

## Caveats / Not Found

- No product code, task plan, spec, or config was changed by this research.
- No compilation, browser interaction, or native runtime check was executed. API availability is source-backed; window behavior remains unverified.
- No supported Tauri setting was found that guarantees an indefinitely live hidden main webview across Windows, Linux, and older macOS versions.
- The product design must expose command failure/recovery rather than promise successful hidden-main execution on untested platforms.


## Position correction (2026-11-09)

The user reported that the capsule sat below the status/menu bar. On the test
monitor, work-area top is 33 logical pixels, so the original top + 8 formula
produced y41. Changing only the anchor to physical screen top requested y8 but
native CGWindow inspection still reported y33 (`native-position-clamped.json`).

Pinned Tao 0.35.3 positions via `NSWindow.setFrameTopLeftPoint`; its ordinary
always-on-top level is floating (5). The macOS-only correction applies native
status-window level 25 once after the island is created, before first positioning.
It uses existing objc2 through Tauri `with_webview`, which guarantees main-thread
execution. The raw pointer remains callback-local. No new dependency or global
window-class override is needed. Other platforms keep their work-area top.

- [Apple statusBar level](https://developer.apple.com/documentation/appkit/nswindow/level-swift.struct/statusbar): public status-window level.
- Pinned `objc2-app-kit-0.3.2/src/generated/NSWindow.rs:283`: `NSStatusWindowLevel = 25`.
- Pinned `tauri-2.11.6/src/webview/webview_window.rs:2316`: main-thread `with_webview`.
- Pinned tauri-runtime-wry 2.11.4 uses `Retained::into_raw` for platform handles;
  avoid invoking `with_webview` for this one-time configuration on every resize.

Native retry with level 25 reached y8, both collapsed (360 wide, 88 high) and
expanded (420 wide, 228 high). Screen-region and isolated-window screenshots show
legible controls at the top. This is macOS runtime evidence, not Windows/Linux
verification. Final acceptance evidence is recorded in `verification.md`.


## User refinement: edge-attached compact island (2026-11-09)

The user requested 0pt top spacing and a narrower island because the previous
360x88 logical-pixel native window still covered text. Reference source reads:

- https://raw.githubusercontent.com/ipfred/focus-island/master/src-tauri/src/lib.rs
  defines a base capsule of 360x42, scales both dimensions, and centers it at
  `monitor.position().y` in `set_island_size` / `set_island_custom_size`.
- https://raw.githubusercontent.com/ipfred/focus-island/master/src/composables/useSettings.ts
  defaults `islandScale` to 1.0 and documents the 0.5–1.5 range.
- Reference Vue component fetches did not return usable source, so no exact CSS
  or screenshot matching is claimed.

Nextdo's narrower adaptation uses a 240x32 desktop collapsed window at y0 on
macOS. Removing the desktop client's outer padding is necessary: the prior
native y8 plus p-2 made the visible top y16. A desktop-only compact presentation
keeps title, clock, state accessibility, and keyboard expansion; the regular
in-app island and expanded command buttons retain their existing larger targets.
The desktop pointer/keyboard capsule is an intentional exception to the usual
44pt touch target; it must not create a larger invisible window over app text.
No scale setting or additional preferences are introduced. Other desktop
platforms retain the 8pt work-area gap. The expanded window remains 420pt wide.

Validation target: native y0, width240, collapsed height32; top-center screenshot
shows the collapsed panel ends within this host's 33pt menu band. This does not
guarantee an empty menu-bar center for every app or all monitor configurations.
