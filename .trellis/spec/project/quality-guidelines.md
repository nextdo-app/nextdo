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

### 构建产物由 CI 产出

安装包（桌面 `.dmg` / `.exe` / `.AppImage`、Android `.apk`）不在本地构建：
推分支并开 PR，由 `.github/workflows/ci.yml` 跑门禁、`.github/workflows/release.yml`
在 `v*` tag 或 `workflow_dispatch` 时构建并发布 Release。本地构建产物
（`apps/desktop/src-tauri/target`、`apps/mobile/dist`）不要留在工作区。

### 交互态截图（headless Chrome + CDP）

静态路由截图可以「打开即拍」，但表单一类的交互态必须先点到目标状态再拍。既有脚本
`scripts/capture-verify-screenshots.mjs` 只做前者；需要点击/输入的实测按下面四条写脚本
（完整例子：`.verify/form-field-labels/capture.mjs`，任务 10-16-form-field-labels）：

- **等界面出现要用可见文本，不能用 placeholder**：`document.body.innerText` 不包含 placeholder，
  用它当等待信号必然超时；等标签、标题或按钮文案。
- **点击要用真实指针事件**：React Native Web 的 `Pressable` 只认指针事件 —— 算出叶子节点中心坐标后
  发 `Input.dispatchMouseEvent`（mousePressed + mouseReleased）；直接 `el.click()` 不可靠。
- **输入框灌值要走原生 setter + input 事件**：先
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)`，再
  `el.dispatchEvent(new Event('input', { bubbles: true }))`；直接改 `el.value` React 收不到。
- **表单校验会让提交按钮禁用**，此时点击是静默无效的：先把表单填成合法状态再提交，否则后续依赖
  「数据真的落库」的步骤会全部超时 —— 这类失败要当脚本缺陷修，不要在断言里放宽。

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
- **The release BODY is the in-app ChangeLog — never write a file list into it.**
  The app renders exactly what `releases.atom` carries in `<content>`, which is the
  GitHub release *body* verbatim (`apps/mobile/lib/app-update.ts` →
  `parseAtomFeedEntries`). `release.yml` used to pass `--notes "Nextdo $TAG —
  $KIND. Assets: …"`, so users on older builds saw `.apk` / `.dmg` / `worker.js`
  file names under 「更新说明 (ChangeLog)」 (v0.1.6-beta.4 shipped that way). The
  body now comes from `scripts/build-release-notes.mjs` — commit subjects between
  the previous and the current tag, grouped into sections — and the release job
  checks out with `fetch-depth: 0`, because that script walks `git log`.
  Repairing a published body takes BOTH sides: `gh release view <tag> --json body`
  for the API view, and the feed the app actually reads
  (`https://proxyd.picpi.top/https://github.com/nextdo-app/nextdo/releases.atom`)
  for the rendered ChangeLog. Re-running the release workflow refreshes an
  existing release's body too (`gh release edit … --notes-file notes.md`).

## Review Standards (what a checker looks for)

1. Behavior matches `prd.md` / `design.md` for the active task; no unrequested features.
2. Dependency direction respected (`project/directory-structure.md` Rule 1); no deep imports.
3. Errors follow the typed-error convention; no swallowed catches.
4. New engine logic is deterministic (no hidden `Date.now()`, no `Math.random()` without an injected seed).
5. No new runtime dependency in `packages/core`; any new dependency anywhere is justified in the PR description.
6. No placeholder text, `TODO` without an issue link, or commented-out code.
