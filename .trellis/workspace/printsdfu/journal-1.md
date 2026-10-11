# Journal - printsdfu (Part 1)

> AI development session journal
> Started: 2026-09-20

---

## 2026-09-20 — `00-bootstrap-guidelines` completed (archived)

Greenfield spec bootstrap for Nextdo (lightweight GTD, local-first, mobile + desktop).

- Decisions locked with the user: Expo/RN + TypeScript, PowerSync cloud + Postgres,
  Tauri v2 shell over the Expo Web build, pnpm monorepo (`apps/mobile`, `apps/desktop`,
  `packages/core`, `packages/db`, `packages/ui`, `server/app`), Hono backend on Node 20.
- Spec restructured from the template's backend/frontend split into
  `project/` + `app/` + `domain/` layers (13 files, all filled, English).
- Advisor (Codex gpt-5.6-sol, xhigh, read-only) review loop: pass 1 REVISE (11) →
  pass 2 REVISE (8) → pass 3 REVISE (6) → pass 4 REVISE (4) → **pass 5 APPROVE**
  (no blocking, no non-blocking). Full history in the task's prd.md.
- Greenfield exception: no real code examples in spec (deferred to the scaffold
  task, which adds concrete file references in its Phase 3.3).
- Next: create and start the scaffold task.



## 2026-09-21 — PowerSync v2 upgrade (task 040) — packages/core + packages/db

**Environment change discovered mid-task:** `server/app` (the 038 backend) and
`apps/mobile` (the 042 shell) no longer exist on disk; `.trellis/tasks/` was
reorganized (only `09-21-monorepo-scaffold` + archive remain); research/ was
rewritten (versions-*.md re-verified 2026-09-21, incl. service 1.26.1,
sync-config `sync_config` key, JWT via `jose`). Git only has 3 commits;
`packages/db/` is untracked. Backend/mobile verification is therefore out of
scope for this session.

**Work delivered (all in `packages/`):**

- `packages/core` → version 2.0.0 (no code change; zero runtime deps, no
  PowerSync surface).
- `packages/db` → version 3.0.0:
  - `src/schema.ts` — REBUILT. The pre-upgrade file was overwritten before it
    could be recovered (untracked, no git history); reconstructed from
    research/schema-mapping.md (read earlier in session) + core domain types +
    every consumer (queries/*, fixtures.ts, tests). Now v2 builder API:
    `new Schema({...})` + `new Table({...}, {indexes})` + `column.text/integer`,
    `Table.createInsertOnly` for review_records/completion_records,
    `export type Database = typeof AppSchema.types` (verified per-table
    per-column precise via a deliberate @ts-expect-error probe). 16 tables,
    all 14 entity row-mapper pairs + `parseJson` (signature widened to accept
    `undefined` — pool.ts required it). No `Tag` core type exists → no tag
    mappers (junction table stays schema-only).
  - `src/powersync.ts` — NEW: lazy platform client selection
    (`@powersync/react-native` vs `@powersync/web` via `navigator.product`,
    lazy `require` so plain Node/jest never loads native),
    `createPowerSyncDatabase()`, v2 connector `createPowerSyncConnector(config)`
    (injected `NextdoPowerSyncConfig`, no env fallbacks; `fetchCredentials`
    → GET /credentials w/ owner token, null = not signed in, throw =
    temporary; `uploadData` = one crud transaction per call → POST /upload
    body `{ ops: [{ op, id, table, opData }] }`, `complete()` ONLY on 2xx —
    the 2xx-on-rejection protocol), `subscribeAppStream` (stream 'all').
  - `src/owner-token.ts` — NEW: per-user KV session storage (the only
    AsyncStorage-key touchpoint): `nextdo.auth.current-user` +
    `nextdo.auth.owner-token.<userId>`; setSession/clearSession/getOwnerToken/
    getCurrentUserId; lazy backend (AsyncStorage native / localStorage web /
    in-memory Node) + `__setStorageBackendForTests`.
  - `src/test/connector.test.ts` — NEW: 16 tests covering the owner-token
    session semantics + both connector methods (null-when-signed-out,
    2xx-on-rejection completes, non-2xx/network throws without completing,
    exact /upload body, Bearer headers, stream subscription).
  - Fixed 2 pre-existing 043 typecheck errors: `queries/inbox.ts` dead
    `case 'do-now-completed'` (unreachable after the early return) and
    `test/powersync-node.ts` `match[1]!` under noUncheckedIndexedAccess.
  - package.json: removed dead deps `@tauri-apps/plugin-stronghold` +
    `expo-secure-store` (superseded token-crypto design, zero imports);
    added `@react-native-async-storage/async-storage@3.1.1` (lazy require in
    owner-token.ts must resolve under Metro/pnpm); KEPT
    `@powersync/node@1.0.1` devDep — contrary to the task description, the
    test helper `src/test/powersync-node.ts` still needs it for the native
    PowerSync SQLite extension binary.

**Quality gate (green):** `pnpm -r typecheck` (core+db) ✓ · `pnpm -r test`
core 153/153 + db 19/19 ✓ · `pnpm lint` clean ✓.

**Leftovers / notes:**
- Backend rebuild must match the connector contract: /credentials
  `Authorization: Bearer <ownerToken>` → `{ token }`; /upload body
  `{ ops: [{ op: PUT|PATCH|DELETE, id, table, opData }] }`, 2xx-on-rejection.
- `apps/mobile` (re)creation must pin op-sqlite 18.2.5 + copy @powersync/web
  worker assets (research/versions-powersync.md §unverified).

## 2026-09-21 — apps/mobile 重建 + Web 平台支持（scaffold 目标 7）

上会话已重建 `apps/mobile`（Expo 57 / SDK 54 代际、Expo Router 4 tabs、
NativeWind v4、`@nextdo/db` 连接器接线、登录门、owner-token 会话）。
本会话补上 **Web 平台**：`@powersync/react-native` 是原生-only，web export
会在运行时 `Cannot read property 'product' of undefined` 崩溃。

**改动：**
- `packages/db`：
  - `src/powersync.ts` — 重写为**按平台分发工厂**：
    `createPowerSyncDatabase()` 内做惰性 `require('@powersync/react-native')` /
    `require('@powersync/web')` 分发（Metro 与 webpack 都不会预打包
    react-native 原生模块，避免 web 崩溃与 node/jest 加载原生模块）。
    `PowerSyncInstance` 是两 SDK 的最小公共子集结构类型（无 import，
    避免 @types/react 传递依赖）。导出 `PowerSyncInstanceExport` /
    `PowerSyncDatabase`（db 包内别名）。
  - `src/index.ts` — 改导出工厂 + 类型（删除 `powerSync` 单例导出）。
  - `src/test/connector.test.ts` — mock 从 `../powersync` 改为
    `@powersync/react-native`（新结构下 connector 直接从 SDK 取 client）；
    新增"非 RN 平台分发到 @powersync/web"用例（jest.doMock web 模块）→ 20 测试。
  - `src/test/powersync-node.ts` — 原生 Node 实例改为 `new PowerSyncDatabase()`
    （@powersync/node），不再经由工厂。
  - 新增 devDep `@powersync/web@1.0.1`（与 @powersync/react-native 1.1.1
    同为 v1.0.1 core —— 两 SDK 的 core 版本必须一致，见
    `.trellis/tasks/09-21-monorepo-scaffold/research/versions-powersync.md`）。
- `apps/mobile`：
  - `package.json` + 根 `pnpm-workspace.yaml` — 新增 `@powersync/web`
    （catalog:）；根 `pnpm install` 通过。
  - `app/_layout.tsx` — `usePowerSync(createPowerSyncDatabase())`（替换单例导入）。
  - 根 `babel.config.js` — 新增 `babel-preset-expo/metro-fix`（expo-router
    官方要求的 metro 修复预设）。
  - `tailwind.config.js` — **修复路径 bug**：tokens require 从
    `../packages/ui/...` 改为 `../../packages/ui/...`（上会话写错一级，
    导致 web export 在 jiti 加载配置时崩）。
- `packages/ui` — `package.json` 新增 `@types/react`（peer deps 显式化，
  消除 tsc TS7016）。

**质量门（全绿）：** `pnpm -r typecheck`（ui/core/db/mobile）✓ ·
`pnpm -r test` core 153/153 + db 20/20 ✓ · `pnpm lint` ✓ ·
`expo export --platform web` ✓。

**Web 运行时资产验证：** `dist/@powersync/worker.js` + 4 个 `.wasm` 就位
（来自 `public/@powersync/`），entry bundle 引用 `/@powersync/worker.js`，
本地静态服务 curl 探测 MIME 正确（worker=text/javascript，wasm=application/wasm）。
**未验证：** 真实浏览器运行时启动（本会话 IDE 浏览器 MCP 持续报
"MCP descriptor not found"，停止重试）；完整同步 E2E 需 PowerSync server
（本工作区无 server 项目）。


## Session 1: Monorepo scaffold: Step 6 verification, clean gate, spec backfill
<!-- trellis-session: v=2 fp=30aa3e8c3062e1c0 -->

**Date**: 2026-09-22
**Task**: Monorepo scaffold: Step 6 verification, clean gate, spec backfill
**Branch**: `main`

### Summary

Verified Step 6 server backend against the client contract (51 mocked-pg tests, tsc build, JWT/sync-config parity). Independently reproduced and fixed the packages/db cold-parallel jest failure (inline babel plugin functions dropped by jest config serialization -> path-based .cjs plugin); db cold+parallel 127/127 green 3/3. Ran the Step 7 clean-state gate (rm node_modules -> pnpm install -> lint/typecheck/test): all green (core 153, db 127, mobile 4, server 51). Step 8: backfilled .trellis/spec from intent to reality (directory-structure tree, next-action-engine Implementation mapping, database-guidelines real-file citations + jest gotcha + recorded deviations: server app.ts/index.ts split, Tauri stronghold defect).

### Git Commits

| Hash | Message |
|------|---------|
| `9e7b904` | fix(db): load the import.meta babel plugin by path (cold parallel) |
| `bdda947` | feat(server): Step 6 Hono backend + PowerSync service |
| `0ff05ec` | docs(spec): Step 8 backfill spec from intent to reality |

### Status

[OK] **Completed**


## Session 2: E2E sync round-trip: real-chain verification green, scaffold runtime fixes
<!-- trellis-session: v=2 fp=6d01105dedfbed3f -->

**Date**: 2026-09-22
**Task**: E2E sync round-trip: real-chain verification green, scaffold runtime fixes
**Branch**: `main`

### Summary

Built the re-runnable E2E runner (e2e/sync-roundtrip.ts, @powersync/node clients on node:sqlite, 7-step protocol: bootstrap -> auth negatives -> JWT acceptance -> read path -> write path incl. append-only 2xx -> cross-client -> cleanup) and drove the real chain to green: final run 7/7 PASS, 14s, exit 0. Found and fixed 3 scaffold runtime bugs the compose-only validation missed: POWERSYNC_CONFIG_PATH (service exited 150 / ran without sync config -> PSYNC_S2302 on every /sync/stream while connect+subscribe still succeeded), postgres wal_level=logical, and CREATE PUBLICATION powersync in the init DDL (PSYNC_S1141); init scripts only run at container creation, so existing postgres needs a recreate. Also fixed 2 e2e-tool bugs: crudQueueDepth queried a non-existent ps_crud.table_name column (v2 schema: id/data/tx_id, table name at json_extract(data,'$.type'), probe-verified 1/2/3) and awaitWithTimeout's unref'd timer drained the event loop when the SDK close() promise stayed pending -> 'unsettled top-level await' exit 13 (ref'd timer + clearTimeout in finally; close() itself settles in <10ms once the loop stays alive). No product-code bugs: connector, JWT minting, /upload, append-only trigger all behaved as designed; no product regression tests needed — the E2E suite is the regression test for the service layer. Root gate green (lint/typecheck/test). Spec updated: database-guidelines gained the self-hosted service operational contract (hard requirements + failure/symptom matrix + ps_crud v2 debugging) and the E2E runner entry in Testing; app/index.md Quality Check gained the 'sync-chain changes must pass the E2E runner' item. Note: the implementation subagent died twice on transient Anthropic 502s (its orphaned background run had already proven the sync chain works); the parent session completed the remaining work directly. Docker stack left running by design (down subcommand documented).

### Git Commits

| Hash | Message |
|------|---------|
| `b9f2513` | fix(server): self-hosted stack runtime fixes — POWERSYNC_CONFIG_PATH, wal_level=logical, powersync publication |
| `20a004b` | test(e2e): real sync-chain round-trip runner (manual, outside root gate) |
| `18b35ec` | docs(spec): self-hosted service contract + e2e runner in database guidelines |

### Status

[OK] **Completed**


## Session 3: App UI 四 tab 功能化收尾：走查补全 + 根门 + 提交归档
<!-- trellis-session: v=2 fp=1aaa0c26ad6a2d9e -->

**Date**: 2026-09-23
**Task**: App UI 四 tab 功能化收尾：走查补全 + 根门 + 提交归档
**Branch**: `main`

### Summary

完成 09-22-app-ui-screens 收尾（步骤 8 + Phase 3）。浏览器补走 AC2 全 7 分支（reference 拦截+落行、do-now Q3b 直提、someday/waiting/calendar/project 行各归其位，远期日程不入池为 spec 预期）、AC4 放弃+重入不恢复、AC6 已完成勾选+排期 2026-09-24、AC7 删 someday；文案中文化扫描通过。根门复跑全绿（466→check pass 补 4 条边界用例后 470 passed）。trellis-check 全量审查：db 只增不改、now 纪律、提交顺序均合规；自修日期校验边界（不可能日期/无效排期拦截）+ 文档数字修正。spec 增补：testing-guidelines 新篇 + hook-guidelines Rule 6（PowerSync watch error: null truthy 判空，B1 白屏回归）。3 个工作提交 + 归档 + 日志。

### Git Commits

| Hash | Message |
|------|---------|
| `a3509d7` | feat(db): review snapshot queries and completion record listing |
| `b4caf50` | feat(app): functional four-tab UI — capture + clarify wizard, now, focus, projects, review |
| `ff46ae9` | docs(spec): app testing guidelines + powersync watch error rule |

### Status

[OK] **Completed**


## Session 4: app-owned PowerSync connect/disconnect driven by owner token
<!-- trellis-session: v=2 fp=b0b666e5272dbe52 -->

**Date**: 2026-09-23
**Task**: app-owned PowerSync connect/disconnect driven by owner token
**Branch**: `main`

### Summary

Fix PowerSync v2 'Not signed in' sync-loop spam by letting the app own connect/disconnect based on owner-token state

### Main Changes

- db/owner-token: new subscribeToOwnerTokenChange (notify after write, snapshot iteration, listener error isolation)
- mobile _layout: PowerSyncProvider connects only with owner token, disconnects without, follows token changes
- connector.test: +5 subscription lifecycle tests; 8 screen test mocks extended

### Git Commits

| Hash | Message |
|------|---------|
| `51e29a1` | fix(sync): app-owned PowerSync connect/disconnect driven by owner token |

### Testing

- [OK] Root gate green: lint/typecheck/test 0 failures (475 tests: db 146, mobile 125, core 153, server 51); browser smoke clean at :8081/now

### Status

[OK] **Completed**

### Next Steps

- Add owner-token entry UI so sync can actually activate


## Session 5: iOS 简约风 UI 重新设计与重构
<!-- trellis-session: v=2 fp=b0f1af1366cdb086 -->

**Date**: 2026-09-23
**Task**: iOS 简约风 UI 重新设计与重构
**Branch**: `feature/app-ui-ios-redesign`

### Summary

基于 iOS 简约风格重构 Design Tokens（Grouped 背景与 Inset 卡片）、重排 Tab 导航（收件箱居首）、增加开屏极速捕获弹窗 QuickCaptureModal、重构 Now 屏大按钮与操作栏空间解耦、去除角落多余按钮，全量 39 个测试套件通过并在 Web 端走查验证

### Git Commits

| Hash | Message |
|------|---------|
| `3f686f7` | feat(ui): upgrade tokens and components to iOS minimalist system |
| `f64799e` | feat(mobile): redesign navigation, quick capture modal, and tabs for iOS style |

### Status

[OK] **Completed**


## Session 6: 捕获后即时澄清 + 问题链内置项目归属
<!-- trellis-session: v=2 fp=capture-clarify-flow -->

**Date**: 2026-09-23
**Task**: 09-23-capture-clarify-flow — 捕获后即时澄清 + 问题链内置项目归属
**Branch**: `feature/capture-clarify-flow`

### Summary

捕获（弹窗/内联条）保存后立即进入 Clarify 逐步提问（记一条问一条）；完成步改为「再记一条/完成」显式出口（再记一条经一次性 `recapture=1` 路由参数重开捕获弹窗）。问题链 Q2=否 后新增 Q2b「它属于哪个项目？」：挂接已有 active 项目（直接进行动表单，价值继承项目价值，跳过 Q3–Q5）/ 新建项目 / 不属于项目；re-clarify 经 Q2b 可保持/改挂/解除（db 三态 string/null/undefined）。core 新增 `ClarifyAnswers.projectId` + `project-attach` outcome；db 新增 `loadAttachableProject` 校验（`clarify.project-not-found` / `clarify.project-not-active`，事务前校验零脏写）。518 测试全绿；Web 端完整冒烟通过（建项目→再捕获→Q2b 挂接→项目详情出现挂接行动且价值继承）。spec `domain-model.md` 决策表已补 Q2b 分支与 capture-handoff 规则。

### Git Commits

| Hash | Message |
|------|---------|
| `f24582a` | feat: clarify captured items immediately; project attach in the clarify question chain |
| `163e611` | docs(trellis): add capture-clarify-flow task artifacts |

### Status

[OK] **Completed**

### Next Steps

- 分支 `feature/capture-clarify-flow` 待合并（base: `feature/app-ui-ios-redesign`）
- 可选：`CalendarAction` 支持 `projectId`（v1 互斥，当前固定时间与项目归属不可并存）


## Session 7: Stitch UI 重做收尾：hero 验证 + chips 去计数 + 归档
<!-- trellis-session: v=2 fp=8038e71277f827aa -->

**Date**: 2026-09-24
**Task**: Stitch UI 重做收尾：hero 验证 + chips 去计数 + 归档
**Branch**: `feature/stitch-ui-redesign`

### Summary

web 冒烟复核（空态 + hero 态截图，8091 旧导出已按当前树重新 export）；用户拍板：任意=空场景维持 spec、情境过滤 chips 去掉计数（now.tsx + 3 处测试断言 + design/implement 工件同步）；spec 三处更新（domain-model 种子事实、ContextChip/ProgressBar 组件、useProjectCards 时间敏感 watch 先例）；5 个工作提交 + 归档 + 本 journal。

### Git Commits

| Hash | Message |
|------|---------|
| `39533ae` | feat(ui): Paper Serenity tokens, Tag restyle, ContextChip and ProgressBar |
| `c541df7` | feat(db): project card watch query, context seeding, isStalled export |
| `50095c7` | feat(mobile): restyle Inbox/Clarify/Projects/Now on Paper Serenity baseline |
| `f4b8f0c` | docs(spec): record context seeding, ContextChip/ProgressBar, time-sensitive watch precedent |
| `f2b6e66` | docs(trellis): add stitch-ui-redesign task artifacts and design baseline |

### Status

[OK] **Completed**


## Session 8: owner token 改部署时生成（移除 /claim）+ 生产服务器升级
<!-- trellis-session: v=2 fp=c6e80202a67b2fa4 -->

**Date**: 2026-09-28
**Task**: owner token 改部署时生成（移除 /claim）+ 生产服务器升级
**Branch**: `feature/prod-deploy-connect`

### Summary

实机「连不上服务器」定位为生产跑旧代码（/claim 404 被归为 network）；用户拍板撤销 claim 机制，token 改为部署时 openssl rand -hex 32 写入 .env（必填、空则拒启动），客户端 token 恢复必填（内联「请先输入 owner token」零网络）。server/db/mobile/deploy/spec 五层实施，gate 全绿 + e2e 7/7 + 本机 docker 实跑 + trellis-check 零修改，5 个提交；Tauri 重建并重装。后经 SSH 用 bundle 把生产服务器 6e2cb45 升级到 5ec16c6 并公网验证（/credentials 200/401、/claim 404、/upload 200、日志零 token），读出并验证生产 token，用户实机连接成功；push 至 GitHub，归档 4 个任务。

### Git Commits

| Hash | Message |
|------|---------|
| `b4d836b` | feat(server): require NEXTDO_OWNER_TOKEN at boot; drop /claim + file persistence |
| `9fa19df` | feat(mobile): owner token input required again (drop claim bootstrap) |
| `090b258` | feat(db): remove claimOwnerTokenOnce (claim endpoint retired) |
| `916baf2` | chore(deploy): NEXTDO_OWNER_TOKEN required; drop data volume + claim docs |
| `5ec16c6` | docs(trellis): deploy-owned owner token — spec sync + task 09-28-deploy-owned-owner-token |

### Status

[OK] **Completed**


## Session 9: v0.1.1 发布：修复 release 流程、macOS 双架构、EAS Android 接入
<!-- trellis-session: v=2 fp=27b64e1d25c997ca -->

**Date**: 2026-09-28
**Task**: v0.1.1 发布：修复 release 流程、macOS 双架构、EAS Android 接入
**Branch**: `feature/prod-deploy-connect`

### Summary

定位并修复 v0.1.0 发布三连败根因（release job 缺 actions/checkout 导致 gh release create 报 not a git repository）；发布步骤改为幂等（release 已存在时仅 --clobber 上传 asset），--target 改为 github.sha；macOS 任务交叉编译 x86_64，release 补齐 Nextdo_0.1.1_x64.dmg（共 6 个桌面 asset 全部就绪）；版本号统一升 0.1.1 并强移 v0.1.1 tag 重跑成功。移动端：创建并关联 EAS 项目 @printsdf/nextdo（app.json extra.eas.projectId），EAS_TOKEN 存为 repo secret，release.yml 新增 build-android 任务（EAS 云端编译 APK 并入同一 Release）。遗留：本轮 Android APK 构建仍在 EAS 队列中，出包后需下载上传到 v0.1.1 release；孤儿 tag v0.1.0 未处理（无对应 release）。

### Git Commits

| Hash | Message |
|------|---------|
| `3baae9f` | fix(release): checkout in publish job, dynamic dmg name, dispatch publish; bump to v0.1.1 |
| `c3cf28d` | ci(release): build both macOS arches, idempotent publish; mobile version 0.1.1 |
| `0966fca` | chore(mobile): link EAS project @printsdf/nextdo |
| `346e093` | ci(release): build Android via EAS and include APK in the release |

### Status

[OK] **Completed**


## Session 10: 项目与行动的编辑/归档操作
<!-- trellis-session: v=2 fp=8463bc3f75d01ab2 -->

**Date**: 2026-09-29
**Task**: 项目与行动的编辑/归档操作
**Branch**: `feature/project-action-edit-archive`

### Summary

项目详情编辑/归档/恢复 + 行动编辑：删除改归档（on-hold 可逆）、池子过滤非 active 项目行动、patch 式更新钩子；db 212/mobile 240 测试全绿 + web 冒烟全流程通过，trellis-check 4 项修复含 spec 同步

### Main Changes

- db: queryEnginePool 排除非 active 项目的 next 行动（池子契约 R5，core 零改动）
- mobile: 项目详情 [编辑][归档/恢复] + 行动行 [编辑]，新增 useUpdateProject/useUpdateNextAction
- spec: next-action-engine 池子契约 + domain-model 状态快捷切换 + hook-guidelines patch 钩子先例

### Git Commits

| Hash | Message |
|------|---------|
| `900f855` | feat(db): exclude non-active project actions from the engine pool |
| `95d6e5d` | feat(mobile): project edit + archive/resume and action edit on project detail |
| `3794a3a` | docs(spec): pool contract R5 clause, project status quick-switch, patch-hook precedent |
| `25991dd` | docs(trellis): add project-action-edit-trash task artifacts |
| `e366c47` | chore(task): archive 09-28-project-action-edit-trash |

### Testing

- [OK] typecheck 6 包 + 测试全绿（core 157/db 212/server 69/mobile 240）+ web 冒烟：归档→Now 消失→恢复→回来→编辑生效

### Status

[OK] **Completed**

### Next Steps

- 分支 feature/project-action-edit-archive 待合并/推送（base: feature/prod-deploy-connect）
- 可选：回收站页面（软删除的恢复/硬删入口）+ 项目真删除；CalendarAction 支持 projectId


## Session 11: Web 返回修复 + 0.1.2 Android 发布
<!-- trellis-session: v=2 fp=4438f86c33d325c3 -->

**Date**: 2026-09-29
**Task**: Web 返回修复 + 0.1.2 Android 发布
**Branch**: `fix/web-go-back-fallback`

### Summary

Web 深链返回修复：新增 goBack 助手（无父路由时 replace 到 tab 根），替换 focus/projects/review/clarify-wizard 共 12 处 router.back()，新增 3 个 deep-load 测试，mobile 242 测试全绿 + tsc/eslint 干净；声明 babel-preset-expo 依赖；CI 发布：Android 拆 per-ABI APK、EXPO_TOKEN 接入 eas-cli、修复 EAS Download 步骤；EAS 构建 pin Node 22 + pnpm 12.5.1；app 版本升到 0.1.2

### Git Commits

| Hash | Message |
|------|---------|
| `6485b2b` | fix(mobile): declare babel-preset-expo dependency |
| `d4b7bea` | fix(mobile): robust back navigation on web deep-load |
| `07fb5a9` | ci(release): split Android into per-ABI APKs |
| `08c0d99` | ci(release): expose EXPO_TOKEN for eas-cli on CI |
| `c37f839` | ci(mobile): fix EAS Download step (EXPO_TOKEN + invalid build:view flag) |
| `1e4f65e` | fix(mobile): pin Node 22 + pnpm 12.5.1 for EAS |
| `0691436` | chore(mobile): bump app version to 0.1.2 for release |

### Status

[OK] **Completed**


## Session 12: Mobile UI/UX Ergonomics and Usability Optimization
<!-- trellis-session: v=2 fp=b4a7a1fce9fe9f21 -->

**Date**: 2026-09-29
**Task**: Mobile UI/UX Ergonomics and Usability Optimization
**Branch**: `main`

### Summary

Audited and overhauled mobile UI ergonomics in a dedicated worktree: added safe area insets and status bar styling, scroll containers on overflowing screens, keyboard avoidance on input forms, unified DateTimePicker in project action forms, vector iconography on the bottom tab bar, and a persistent light/dark/system theme toggle in Settings. Verified with 100% passing tests and merged to main.

### Git Commits

| Hash | Message |
|------|---------|
| `5117298` | feat(mobile): optimize UI ergonomics, safe area insets, navigation, and theme toggle |
| `aa33c07` | Merge branch 'feature/mobile-ui-optimization' into main |

### Status

[OK] **Completed**


## Session 13: 提醒通知投递、稍后提醒与厘清返回体验优化
<!-- trellis-session: v=2 fp=43293e2623de49b3 -->

**Date**: 2026-10-01
**Task**: 提醒通知投递、稍后提醒与厘清返回体验优化
**Branch**: `feature/reminder-notification-delivery`

### Summary

完成了提醒通知本地投递与桌面诊断链路、稍后提醒自定义时间滚轮选择器重构，以及厘清向导逐步返回上一步历史栈支持。

### Main Changes

- 桌面端与移动端提醒通知投递及现场诊断链路（tauri-plugin-notification 与 expo-notifications）
- 稍后提醒浮层重构为「10分钟后」常用档位与「自定义时间」组合
- 跨平台 DateTimePicker 滚轮选择器（7天日期条 + 时分滚轮 + 相对时间距离）
- 厘清向导逐步返回（← 上一步）历史栈机制与表单回退

### Git Commits

| Hash | Message |
|------|---------|
| `771b026` | feat(reminders): field diagnostics and desktop notification delivery hardening |
| `16b7b84` | feat(mobile): custom datetime picker with wheel selector and snooze sheet overhaul |
| `4c35b76` | feat(clarify): step-by-step back navigation with wizard history stack |

### Testing

- [OK] pnpm test 全绿（25 test suites, 290 tests）
- [OK] pnpm typecheck 与 eslint 全绿

### Status

[OK] **Completed**


## Session 14: Unblock v0.1.2 release: EAS image pin + Babel plugin resolution
<!-- trellis-session: v=2 fp=2950fd04714ead97 -->

**Date**: 2026-10-01
**Task**: Unblock v0.1.2 release: EAS image pin + Babel plugin resolution
**Branch**: `feature/reminder-notification-delivery`

### Summary

Released v0.1.2 with all 4 Android ABIs after fixing three consecutive blockers that each failed the EAS Android legs.

### Main Changes

- Pin the EAS Android build image to ubuntu-26.04-jdk-17-ndk-r27b-sdk-57 — EAS 'auto' resolution picked the legacy ubuntu-22.04-jdk-11-ndk-r21e image (Java 11) for this SDK 57 project, but Gradle on RN 0.86 requires JVM 17+, so every Android leg died at the Gradle step.
- Declare @babel/plugin-transform-react-jsx (7.29.7) in apps/mobile devDependencies. nativewind/babel delegates to react-native-css-interop/babel, which returns the plugin as a bare string; Babel resolves string plugin names from the config's directory, and react-native-css-interop does not list it in its own dependencies, so pnpm's strict layout left apps/mobile/node_modules/@babel empty and :app:createBundleReleaseJsAndAssets failed with 'Cannot find module @babel/plugin-transform-react-jsx'. Desktop legs were unaffected because the web platform does not go through this preset.
- Apply both fixes to main via a clean worktree so the in-flight feature/reminder-notification-delivery working tree was left untouched; move tag v0.1.2 to the fix commit and re-run the release.

### Git Commits

| Hash | Message |
|------|---------|
| `d88585c` | fix(mobile): pin EAS Android build image to JDK 17 for SDK 57 |
| `516cc5d` | fix(mobile): declare @babel/plugin-transform-react-jsx explicitly |

### Testing

- [OK] pnpm install --frozen-lockfile passes; apps/mobile/node_modules/@babel/plugin-transform-react-jsx is generated (the exact path EAS was missing); expo export --platform android succeeds on a clean origin/main worktree.
- [OK] GitHub Actions run 36848026921: all 8 jobs success, including Build Android (EAS) for arm64-v8a, armeabi-v7a, x86 and x86_64. Release published with 10 assets.

### Status

[OK] **Completed**

### Next Steps

- Desktop version is still 0.1.1 in apps/desktop/package.json and apps/desktop/src-tauri/tauri.conf.json while mobile is 0.1.2, so published desktop artifacts are named Nextdo_0.1.1_*. Bump both desktop files together next time the version changes; fixing it later needs a desktop-only rebuild (no EAS Android quota cost).
- EAS Free plan allows 15 Android builds per billing period (resets on the 1st). This cycle used 4 of 15.


## Session 15: 简化云同步连接：单地址 + 服务端下发 endpoint
<!-- trellis-session: v=2 fp=f43f8aa7b5fd7f7d -->

**Date**: 2026-10-02
**Task**: 简化云同步连接：单地址 + 服务端下发 endpoint
**Branch**: `main`

### Summary

把设置页的三个手填输入（后端地址/同步流地址/owner token）收敛为「一个服务器地址 + 一个连接串」。新增 NEXTDO_SYNC_ENDPOINT 让服务端在 /credentials 下发 sync endpoint（本次唯一破坏性变更：既有部署升级前必须补该变量），客户端 deriveSyncConfig 推导路径并在服务端未下发时回落，连接串支持竖线分隔纯文本与 nextdo:// deep link 两种形态。存储形状不变，旧设备零迁移。核验阶段修复三个缺陷：预填的高级设置会静默压过用户输入的地址（显示新地址却请求旧服务器）、字符串比较剥后缀在带 query 的粘贴上产出 /api/api、deep link 布尔闩锁使第二条连接串进死页面。验证：根级 859 测试 + typecheck + lint 全绿，真实 Docker 栈 e2e 七步全过（第 3 步确认连接器采用服务端下发的 endpoint）。

### Git Commits

| Hash | Message |
|------|---------|
| `bb4d7a8` | feat(server): /credentials 下发 sync endpoint |
| `d4508cb` | feat(sync): 单地址连接 + 连接串 + deep link 配对 |
| `e3c4208` | docs(spec): 记录 /credentials 协议扩展与连接串格式 |
| `5e6188c` | docs(deploy): 连接设备改为「一个地址 + 一个连接串」 |

### Status

[OK] **Completed**


## Session 16: 习惯创建表单与 21 天挑战启动
<!-- trellis-session: v=2 fp=cc6d948f2244479b -->

**Date**: 2026-10-04
**Task**: 习惯创建表单与 21 天挑战启动
**Branch**: `main`

### Summary

为 db 层已就绪但UI 无入口的 Habit 能力补上创建路径：新增独立路由 app/habits.tsx（创建表单 + 第 N/21 天进度列表 + 删除），提交走 startHabit 原子事务，入口在设置页与 Now 屏习惯条（空态引导 / 非空「管理」）。周期日计算复用 packages/db 导出的 habitCycleDay，app 层零复刻。价值选择器顺带收敛为 packages/ui 的 ValueChips，并修掉 projects/[id].tsx 三处 32pt 触摸目标的无障碍缺口。质量门：lint/typecheck 全绿，872 测试通过，web 导出通过。过程中修正两处假绿测试：useHabitDays 的软删除过滤器空转、now-screen 的「返回刷新」用例摘掉 useFocusEffect 仍通过（renderRouter 下 push 栈路由会重新挂载 tab）。

### Git Commits

| Hash | Message |
|------|---------|
| `8bcf46a` | refactor(ui): 价值选择器收敛为共享 ValueChips |
| `2c19f05` | feat(habits): 习惯创建表单 + 21 天挑战启动 |
| `c26cfc2` | docs(spec): 记录焦点刷新、周期日唯一真相源与 mock 工厂覆盖 |
| `855852d` | chore(task): 记录 10-02-habit-create-challenge 规划产物 |
| `731f17f` | chore(backlog): 移除已交付的习惯创建表单条目 |

### Status

[OK] **Completed**


## Session 17: 0.1.3-beta.1 测试版发布（仅 macOS）
<!-- trellis-session: v=2 fp=e38f082daa16daea -->

**Date**: 2026-10-04
**Task**: 0.1.3-beta.1 测试版发布（仅 macOS）
**Branch**: `release/v0.1.3-beta.1`

### Summary

在 release/v0.1.3-beta.1 分支发测试版，不动main。release.yml 新增 build_targets 输入让workflow_dispatch 只构建指定平台，run_id 改为可选（空=用本次构建产物），发布步骤在部分构建 job 被跳过时也能运行；tag 含 semver 预发布后缀时自动加 --prerelease。版本号 0.1.3-beta.1 同步到根 package.json、desktop package.json/tauri.conf.json/Cargo.toml/Cargo.lock、mobile app.json。CI run 37212920913 仅构建 macOS 成功，产出 aarch64 + x64 两个 DMG，Release v0.1.3-beta.1 已标Pre-release，v0.1.2 仍为 Latest。工作区另有两处与本次发布无关的 _layout.tsx 字体子路径导入改动未提交。

### Git Commits

| Hash | Message |
|------|---------|
| `3bbba41` | chore(release): bump to 0.1.3-beta.1 + scoped/prerelease release dispatch |

### Status

[OK] **Completed**


## Session 18: 优化同步配对UI：连接串优先与多端导出配对
<!-- trellis-session: v=2 fp=cfad0cd878062f78 -->

**Date**: 2026-10-07
**Task**: 优化同步配对UI：连接串优先与多端导出配对
**Branch**: `feature/sync-pairing-ui`

### Summary

重构移动端设置页同步配置交互：未连接状态改为单一连接串主输入，收敛服务器与自定义URL至高级设置；已连接状态支持一键复制连接串与纯前端SVG二维码展示；补齐测试与端到端校验。

### Main Changes

- 未连接视图重构为单一连接串优先，服务器地址与自定义URL收敛至折叠的高级设置
- 已连接视图新增复制连接串（带反馈）与扫码配对展示（基于 qrcode 纯前端SVG渲染，生成 deep link）
- 在 sync-connection 中实现 formatConnectionString 与 formatDeepLink 工具函数
- useCloudSync 暴露已连接设备的 ownerToken 用于多端导出

### Git Commits

| Hash | Message |
|------|---------|
| `4c63bb3` | feat(mobile): 连接串优先配对与多端导出（复制与二维码） |

### Testing

- [OK] 全量测试通过：pnpm lint、pnpm typecheck 与 pnpm test (移动端381个用例全绿)

### Status

[OK] **Completed**


## Session 19: 习惯归属项目（Habits in Projects）
<!-- trellis-session: v=2 fp=aa6c74381285c4f3 -->

**Date**: 2026-10-07
**Task**: 习惯归属项目（Habits in Projects）
**Branch**: `feature/habits-in-projects`

### Summary

为 habits 增加 project_id 字段以支持归属项目，四处 schema 声明与多端同步配置同步扩展；行动池生成补齐项目状态过滤；移动端项目详情页新增习惯列表、21天挑战网格打卡与内嵌创建表单；全量单测、类型检查与 lint 全绿通过。

### Git Commits

| Hash | Message |
|------|---------|
| `a562596` | chore(task): 记录 10-07-habits-in-projects 规划与实施产物 |
| `e24f006` | feat(core,db,server): 习惯支持归属项目与多端同步扩展 |
| `ad34f27` | feat(mobile): 项目详情页支持习惯列表、打卡与内嵌创建 |

### Status

[OK] **Completed**


## Session 20: 场景软删除管理与二级页面返回键统一样式
<!-- trellis-session: v=2 fp=56b1c1ee8a972eea -->

**Date**: 2026-10-07
**Task**: 场景软删除管理与二级页面返回键统一样式
**Branch**: `feat/context-trash`

### Summary

为场景（contexts）增加软删除与独立管理页入口，并在 Now 屏增加管理跳转与聚焦刷新；统一习惯（habits）与场景（contexts）二级页面的返回按钮至左上角，与项目详情、回顾和专注页等全局交互规范保持一致；全量类型检查、代码风格检查与单元测试全部通过。

### Git Commits

| Hash | Message |
|------|---------|
| `ba5063f` | feat(mobile): 新增场景管理页与场景软删除功能 |
| `61c1894` | fix(mobile): 统一二级页面返回按钮至左上角 |

### Status

[OK] **Completed**


## Session 21: 统一澄清向导返回键与 0.1.3-beta.2 macOS DMG 打包
<!-- trellis-session: v=2 fp=56b1c1ee8a972eea -->

**Date**: 2026-10-07
**Task**: 统一澄清向导返回键与 0.1.3-beta.2 macOS DMG 打包
**Branch**: `release/v0.1.3-beta.2`

### Summary

优化澄清向导（`clarify-wizard`）的头部导航交互，解决此前进入多步流程后退出返回键在左上角与右上角之间跳变的问题，将 `← 返回` 固定锚定在左上角，并使 `← 上一步` 并列置于左侧；将整体工程版本号升级至 `0.1.3-beta.2`，通过全量单元测试与类型检查，并成功完成 macOS Apple Silicon (aarch64) DMG 安装包构建。

### Git Commits

| Hash | Message |
|------|---------|
| `4a85f08` | fix(mobile): 统一澄清向导返回按钮至左上角 |
| `c948a0b` | chore(release): 0.1.3-beta.2 |

### Status

[OK] **Completed**


## Session 22: 实现服务端首次免密认领与移除设置页习惯入口
<!-- trellis-session: v=2 fp=1c652dc4b4a9468c -->

**Date**: 2026-10-08
**Task**: 实现服务端首次免密认领与移除设置页习惯入口
**Branch**: `release/v0.1.3-beta.2`

### Summary

移除设置页冗余习惯卡片收拢至核心执行界面；服务端支持未预设token时的首台设备自动免密认领与64-hex随机Token生成持久化，打通首台直连与后续设备扫码配对闭环

### Git Commits

| Hash | Message |
|------|---------|
| `7c1ccbe` | refactor(mobile): 将习惯管理入口从设置页移出并收拢至核心行动界面 |
| `653d0b2` | feat(sync): 服务端支持首次免密认领与自动生成 token，打通首台一键绑定与扫码配对 |

### Status

[OK] **Completed**


## Session 23: 自动化 CI 质量门禁配置与主干同步准备
<!-- trellis-session: v=2 fp=ci-quality-gate -->

**Date**: 2026-10-08
**Task**: 自动化 CI 质量门禁配置与主干同步准备
**Branch**: `release/v0.1.3-beta.2`

### Summary

配置 GitHub Actions PR/Push 自动化质量门禁工作流（lint、typecheck、test 与聚合 quality-gate），统一对齐 Node 22、pnpm 12.5.1 与 UTC 时区基准，并更新 backlog 归档。

### Main Changes

- 新增 `.github/workflows/ci.yml`，在 push 和 PR 到 main 分支时并行执行 lint、typecheck、test，并通过 Quality Gate 进行聚合状态汇总
- 对齐 Node 22、pnpm 12.5.1 环境版本，开启 pnpm store 缓存以加快构建
- 本地验证根门禁全绿（ESLint 零告警、全 workspace TypeScript 零错误、近 900 项单测全部通过）
- 更新 `.trellis/backlog.md` 归档已交付的 PR 级 CI 门禁项

### Git Commits

| Hash | Message |
|------|---------|
| `c773102` | ci: 增加 GitHub Actions 自动化质量门禁 (lint, typecheck, test) |
| `cf80cf5` | chore(task): archive 10-08-ci-quality-gate |

### Status

[OK] **Completed**



## Session 24: Waiting For 事项管理独立页与数据流
<!-- trellis-session: v=2 fp=2f6eea4e7862c991 -->

**Date**: 2026-10-08
**Task**: Waiting For 事项管理独立页与数据流
**Branch**: `feat/waiting-for-management`

### Summary

根据用户决策移除 references 独立展示规划，增加 Waiting For 事项管理专屏、响应式 Hook 与收件箱入口导航

### Main Changes

- db: 新增 waitingForWatchQuery 响应式查询，导出 add/trashWaitingForItem 操作
- mobile: 新增 useWaitingForItems hook 与 waiting.tsx 管理页，在收件箱顶部提供跳转入口
- backlog: 更新推荐池，明确 References 移出由知识库承接，聚焦 Waiting For

### Git Commits

| Hash | Message |
|------|---------|
| `390641d` | feat(mobile): 增加 Waiting For 事项管理独立页、响应式 Hook 与收件箱入口 |

### Testing

- [OK] packages/db 单元测试全绿（275/275）
- [OK] apps/mobile 屏幕测试全绿（410/410）

### Status

[OK] **Completed**


## Session 25: 优化「现在」Tab 行动加载与渲染性能
<!-- trellis-session: v=2 fp=4acaff27b1a14b8e -->

**Date**: 2026-10-08
**Task**: 优化「现在」Tab 行动加载与渲染性能
**Branch**: `main`

### Summary

完成「现在」Tab 底层 SQL 并发、飞行查询去重、原生 Keychain 缓存与视图组件 Memoization 优化

### Main Changes

- 将 queryEnginePool 的 8 个串行 SQL 查询改用 Promise.all 并发执行，并添加在飞 Promise 去重
- 在 engine-context.ts 中增加 SecureStore 模块级单例内存缓存与 Promise 复用
- 在 use-project-titles.ts 和 use-contexts.ts 中加入模块级内存缓存，实现 0 延迟首屏瞬时渲染
- 在 now.tsx 中为核心子组件与派生数据添加 memo/useMemo/useCallback，并消除首屏 mount 重复查询

### Git Commits

| Hash | Message |
|------|---------|
| `409c8e0` | perf(now): optimize action loading and render performance |

### Testing

- [OK] 运行 pnpm -r typecheck 静态类型检查全绿
- [OK] 运行 pnpm test 全仓库 653 个测试全部 PASS

### Status

[OK] **Completed**


## Session 26: 零成本多端云同步与免源码极简接入
<!-- trellis-session: v=2 fp=afecc25e1810ee -->

**Date**: 2026-10-09
**Task**: 零成本多端云同步与免源码极简接入
**Branch**: `main`

### Summary

围绕终端用户只安装 DMG/APK 且不下载源码、不使用本地开发环境的场景，落地 Cloudflare Workers + Neon + PowerSync 零成本自建云同步闭环与客户端无缝配对

### Main Changes

- 实现 `server/app/src/worker.ts` 与 `schema-init.ts`：Cloudflare Workers 边缘无服务器运行时，首次请求自动执行 14 张核心表与逻辑复制 Publication 创建，用户无需手动操作 SQL
- 实现免密自动认领机制：通过 `/claim/claim` 与 `system_settings` 持久化首台设备随机高强度令牌
- 客户端自适应连接与直达教程：在 `settings.tsx` 中智能识别 Workers 网址并免密认领，添加「📖 查看云同步教程」按钮直达文档
- 单文件打包与 CI 分发：在 `.github/workflows/release.yml` 增加 `build-worker` 阶段，随 Releases 附件发布单文件 `worker.js`，并在 `server/deploy/worker.js` 提供一键复制代码直链
- 重构主 `README.md` 与 `FREE_CLOUD_DEPLOY.md`，提供纯网页 3 分钟零代码傻瓜式指南

### Git Commits

| Hash | Message |
|------|---------|
| `afecc25` | feat(sync): 支持零成本纯网页云同步架构与全平台免源码极简接入 |
| `8a10f43` | chore(task): archive 10-09-zero-cost-cloud-sync |

### Testing

- [OK] apps/mobile 单元与屏幕测试全绿（411/411）
- [OK] server/app 单元测试全绿（92/92）
- [OK] packages/core 单元测试全绿（157/157）
- [OK] packages/db 单元测试全绿（275/275）
- [OK] 全仓库静态类型检查全绿（`pnpm -r typecheck`）

### Status

[OK] **Completed**


## Session 27: Fix P0 core issues: context filter, claim security, sync rejection handling
<!-- trellis-session: v=2 fp=958c7fd0fd32d483 -->

**Date**: 2026-10-09
**Task**: Fix P0 core issues: context filter, claim security, sync rejection handling
**Branch**: `main`

### Summary

修复空场景筛选不匹配任意任务的缺陷；增加服务端 claimSecret 保护首次认领；记录并暴露客户端同步上传失败与死信 op 并在设置页中提供状态反馈

### Git Commits

| Hash | Message |
|------|---------|
| `3ff142e` | fix(core): 允许空场景筛选匹配所有任务并更新规范 |
| `345147d` | feat(server): 增加可选 claimSecret 防护首次认领接口 |
| `ccf766f` | feat(db,mobile): 记录同步上传被拒操作并在设置页面展示状态 |

### Status

[OK] **Completed**


## Session 28: 优化 P1 可靠性缺陷并重写 README 与 TopBook 鸣谢
<!-- trellis-session: v=2 fp=1ce5b55ac053fb8d -->

**Date**: 2026-10-09
**Task**: 优化 P1 可靠性缺陷并重写 README 与 TopBook 鸣谢
**Branch**: `main`

### Summary

优化桌面端场景/时间持久化、修复习惯周期夏令时时区偏移、增加应用时钟前台唤醒立即校准机制；全面重构 README，补充软件 GTD 理念、核心特性、架构与 TopBook 特别致谢。

### Git Commits

| Hash | Message |
|------|---------|
| `084b366` | fix(desktop,db,mobile): 优化桌面端设置持久化、习惯时区计算与时钟前台校准 |
| `c07a4ae` | docs: 全面重构 README 并增加系统介绍与 TopBook 致谢 |

### Status

[OK] **Completed**


## Session 29: 优化推荐理由权重贡献、可信度过滤与 Now 页面视觉层级
<!-- trellis-session: v=2 fp=042a090e447cb923 -->

**Date**: 2026-10-09
**Task**: 优化推荐理由权重贡献、可信度过滤与 Now 页面视觉层级
**Branch**: `main`

### Summary

按实际加权得分贡献重排序推荐理由、过滤低价值标签、支持软到期日紧急度推导，并在 Now 页面增加备选事项清单折叠功能与精简统计栏样式

### Git Commits

| Hash | Message |
|------|---------|
| `13b348f` | docs: 完善各平台安装包架构与格式说明 |
| `001e6fb` | feat(core): 优化推荐理由权重贡献排序与软到期日紧急度 |
| `c71c038` | feat(mobile): 精简 Now 页面视觉负荷并支持备选事项清单折叠 |
| `ee47a4e` | docs(spec): 更新推荐引擎规范中的软到期日与理由过滤规则 |

### Status

[OK] **Completed**


## Session 30: Android 架构精简至 arm64-v8a、更新 README 与重新发布 v0.1.4
<!-- trellis-session: v=2 fp=33ebb77b14780cdb -->

**Date**: 2026-10-11
**Task**: Android 架构精简至 arm64-v8a、更新 README 与重新发布 v0.1.4
**Branch**: `main`

### Summary

更新 README 下载表格仅保留 64 位 arm64-v8a 架构说明，清理 v0.1.4 历史多架构 APK 资产，强移 v0.1.4 tag 触发全平台发布重新构建

### Git Commits

| Hash | Message |
|------|---------|
| `f79afa9` | docs(readme): update android download table to arm64-v8a only |
| `336b62e` | build(android): ship arm64-v8a only to cut APK size |

### Status

[OK] **Completed**


## Session 31: 还原全平台经典图标与优化 .verify 规范结构
<!-- trellis-session: v=2 fp=ac71cc034c8fe9bf -->

**Date**: 2026-10-11
**Task**: 还原全平台经典图标与优化 .verify 规范结构
**Branch**: `feature/stitch-scene-redesign`

### Summary

全平台图标还原为原版深墨色清单条样式；更新交付前验证 Spec，要求 .verify 截图按功能/session 独立子文件夹归档，并整理历史验证文件

### Git Commits

| Hash | Message |
|------|---------|
| `fd42de8` | fix(icons): revert app icons to original task-list motif across all platforms |
| `5395226` | docs(spec): require feature subdirectories under .verify for browser verification |

### Status

[OK] **Completed**
