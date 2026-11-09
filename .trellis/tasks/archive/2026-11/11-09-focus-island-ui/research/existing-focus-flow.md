# Existing Focus Flow Evidence

Inspected 2026-11-09. Source review only; no runtime verification or product edits.

## Reference and Reuse

- Reference: https://github.com/ipfred/focus-island. README, `src/components/CapsuleFocus.vue`, `src/composables/useIslandState.ts`, and `src/composables/useDockMode.ts` were inspected during planning. Reuse capsule/expand concepts, not its mouse-position polling.
- Upstream is Apache-2.0. Plan an original implementation using Nextdo tokens/components, not copied assets/code.
- `apps/mobile/app/focus/[id].tsx:66` calls `useFocusSession`, its only product caller. It also owns title lookup, duration settings, capture, and action completion.
- `apps/mobile/hooks/use-focus-session.ts:41` loads one action's sessions. Start returns session/null; other mutations catch errors and return void. Each uses a captured app-clock value.
- `use-app-clock.ts` ticks each minute and recalibrates on foreground/focus. Hook Guidelines Rule 4 documents a sub-minute timing exception.
- `apps/mobile/lib/focus-timer.ts` computes elapsed/remaining from timestamps and pause totals with injected `now`. Reuse in both views.
- `packages/db/src/queries/focus.ts` persists active sessions from start; pause writes an absolute accumulated total; complete/abandon finalize only the session. No schema change needed.

## State and Defects

| Source | Finding | Consequence |
| --- | --- | --- |
| `[id].tsx:84` | Pause/frozen state is route-local | Lift ownership above navigation |
| `[id].tsx:116,214` | Effect guards are route-local | One main runtime owns effects |
| `[id].tsx:128` | Auto-start waits for recovery | Preserve ordering and guard duplicate starts |
| `[id].tsx:150` | Invalid-param return precedes later hooks | Keep hooks unconditional during extraction |
| `[id].tsx:231` | Break/notification lifecycle is route-local | Retain through navigation |
| `[id].tsx:242,359` | Expiry leaves deadline set; render prioritizes deadline | Clear live deadline; test natural expiry |
| `[id].tsx:272` | Completion proceeds after a void failure result | Require committed result for completed UI |
| `[id].tsx:304` | Abandon accounts for current pause; complete does not | Shared pause finalization with retry coverage |

Anchors refer to pre-implementation source. Existing `apps/mobile/__tests__/focus-screen.test.tsx` regressions remain relevant. Router mocks may need the shared owner. Now (`app/(tabs)/now.tsx:976`), Clarify (`components/clarify-wizard.tsx:372,387`), and notification links reach the focus route.

## Root and Native Hazards

- `_layout.tsx:148` initializes PowerSync; the provider also mounts reminder/calendar delivery. Root owns token hygiene, update prompts, permissions, and fonts. A full second root duplicates services.
- `+html.tsx:43` supplies opaque backgrounds; loading UI is opaque too. Transparency must cover both and stay capsule-scoped.
- `lib/theme.ts` has an existing subscription pattern; no extra state library is needed. Its native setter targets main, so capsule consumes main's resolved theme without writing it.
- `apps/desktop/src-tauri/src/lib.rs:828` creates only main from the app origin. Dev is port 8081; release serves on `127.0.0.1:52123` for PowerSync module workers. Use the same app origin for capsule.
- `lib.rs:919` hides every close-requested window; `:948` restores main only when no windows are visible. Capsule visibility changes that condition; handle windows by label.
- Capabilities grant main core/Stronghold/notifications. Do not copy these to capsule; guard application commands too.
- Versions: Rust Tauri 2.11.6, JS API 2.11.1, CLI 2.11.5. Mobile currently has typed invoke adapters but no direct Tauri API dependency. Use official listener APIs rather than copying private internals.
- `ci.yml` checks JS, not Rust. `release.yml` builds/publishes installers. A green JS gate does not prove native compatibility.

## Applicable Specs

App component/hook/state/testing guidelines; project structure/conventions/quality guidelines; cross-layer and code-reuse guides. Keep data authoritative in the DB, per-second ticks outside shared Context, and transport decoding in one owner.
