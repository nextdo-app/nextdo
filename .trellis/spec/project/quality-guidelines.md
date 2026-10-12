# Quality Guidelines

> Linting, testing requirements, review standards.

---

## Tooling (fixed, do not swap)

| Concern | Tool |
|---------|------|
| Lint | ESLint (flat config) + `typescript-eslint`; Prettier for formatting (lint handles only what Prettier can't) |
| Types | `tsc --noEmit` per package/app, aggregated by `pnpm typecheck` |
| Unit tests | Jest — `jest-expo` preset in `apps/mobile`, plain TS transform in `packages/*` and `server/app` |
| Component tests | React Native Testing Library (only where behavior — not pixels — is under test) |
| Formatting | Prettier, single config at repo root, run on save |

Root scripts (all tasks must keep them green):

```bash
pnpm lint          # eslint .
pnpm typecheck     # tsc --noEmit in every workspace
pnpm test          # jest across workspaces
```

## Web 验证门禁（交付前必过）

`pnpm lint && pnpm typecheck && pnpm test` 全绿**只是必要条件**。
面向用户的改动还必须用真实浏览器确认界面行为，否则不算验证过。

```bash
pnpm verify:web    # lint → typecheck → test → expo export --platform web → 起静态服务器
```

脚本跑完会打印 `http://localhost:4180` 并保持运行。Expo 的 web 输出是
`output: "single"`（产物只有一个 `index.html`），所以脚本内置了
index.html 回落 —— 直接访问 `/settings` 这类深层路由不会 404，不要因此
以为「路由坏了」。

浏览器环节要做的事：

- 打开上面那个地址，走一遍**本次改动涉及的用户流程**；
- **截图留证并按 session / 功能建子目录存放**：在 `.verify/` 下按本次任务或功能名称建立独立子文件夹（如 `.verify/<feature-slug>/` 或 `.verify/<session-slug>/`，例如 `.verify/app-update-check/`、`.verify/now-hierarchy/`），**禁止将截图平铺堆放在 `.verify/` 根目录下**，以便随时定位和对比检查（`.verify/` 目录已 gitignore）；
- 改动涉及失败路径时，确认界面确实呈现了预期的失败态，而不只是抛了异常；
- 交付说明里写清实测了哪些页面/行为、指出对应的子文件夹路径与截图文件名，不要拿「单测通过」代替。

在 CI 上没有浏览器时，把这一条降级为「至少跑 `pnpm verify:web
--no-serve`」（门禁 + 构建通过），并在交付说明里注明界面未实测。

## Testing Requirements

- **`packages/core` (engine + domain): the strictest bar.** Pure functions are tested with
  plain fixtures: fixed `now`, fixed action pool, asserted output. Every hard-filter rule
  and every ranking signal needs at least one positive and one negative test.
  Recommendation tie-breaks must be tested (same input twice → same output).
- **`packages/db`:** query functions tested against an in-memory/local PowerSync DB or a
  SQLite fixture; schema changes must update the fixture.
- **`apps/mobile`:** test flows, not components. Minimum: Clarify flow (inbox item → each
  outcome), recommendation screen start/skip, focus session start/complete.
- **`server/app`:** the upload apply logic (upserts, append-only guards for
  `completion_records`/`review_records`, 2xx-on-rejection) tested against a temp
  Postgres (or a mocked `pg` client); both endpoints return 401 on missing/invalid
  owner token.
- A bug fix ships with a regression test that fails without the fix.
- No tests that assert on timestamps rendered from real time — pass `now` in.

## Known pitfalls

- **There are TWO `localDateKey` functions, with DIFFERENT formats.** `@nextdo/core`'s
  returns `YYYYMMDD` (no dashes) — that is `HabitDay.localDate` storage.
  `apps/mobile/lib/review-dates.ts`'s returns `YYYY-MM-DD` — that is what
  `DateTimePicker` `date` mode emits and what every form field holds. Importing
  the wrong one produces a value that fails its own regex downstream. When a
  screen needs a picker's value, take the picker-shaped key and keep the
  conversion at the boundary.
- **Do not call the GitHub API from a shipped client.** `api.github.com`
  allows 60 unauthenticated requests per IP per hour, and any CDN /
  acceleration proxy in front of it has a *shared* IP — so a rate-limited
  response is the normal case, not an edge case. The app's update check
  therefore resolves the latest release through the `…/releases/latest`
  redirect (CDN-served, un-metered) and reads the tag from the final URL
  instead. See `apps/mobile/lib/app-update.ts`.

## Review Standards (what a checker looks for)

1. Behavior matches `prd.md` / `design.md` for the active task; no unrequested features.
2. Dependency direction respected (`project/directory-structure.md` Rule 1); no deep imports.
3. Errors follow the typed-error convention; no swallowed catches.
4. New engine logic is deterministic (no hidden `Date.now()`, no `Math.random()` without an injected seed).
5. No new runtime dependency in `packages/core`; any new dependency anywhere is justified in the PR description.
6. No placeholder text, `TODO` without an issue link, or commented-out code.
