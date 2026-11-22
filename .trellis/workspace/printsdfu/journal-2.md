# Journal - printsdfu (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-10-25

---



## Session 64: 外部提醒通道（飞书 / 个人微信）
<!-- trellis-session: v=2 fp=d59388d1c7eae9a5 -->

**Date**: 2026-10-25
**Task**: 外部提醒通道（飞书 / 个人微信）
**Branch**: `main`

### Summary

为有 DDL 的任务增加 IM 提醒投递通道：Cloudflare Workers Cron 每分钟扫描到点提醒，推送到飞书自定义机器人或个人微信（经 Server 酱 Turbo 中转），与 app / 日历通道叠加

### Main Changes

- 新增 `server/app/src/channels.ts`：飞书（含可选签名）与 Server 酱适配器，纯函数、凭证仅从环境变量读取
- 新增 `server/app/src/reminder-dispatcher.ts`：到期提醒扫描 → 先占位后投递的去重（`reminder_deliveries`）→ 重试上限与失败落库
- `worker.ts` 增加 `scheduled` handler，`wrangler.jsonc` 增加每分钟 `triggers.crons`，`schema-init.ts` 新增 `reminder_deliveries` 表
- 重新打包 `server/deploy/worker.js`（328.75 KiB），并在 `FREE_CLOUD_DEPLOY.md` 补充 secret 配置与开通步骤

### Git Commits

| Hash | Message |
|------|---------|
| `658ae40` | feat(reminder): 支持飞书与 Server 酱外部提醒通道 |
| `51fa56a` | chore(task): archive 10-24-external-reminder-channels |

### Testing

- [OK] [OK] server/app 单测 116/116，含一条走真实 fetch + loopback HTTP 服务器的端到端投递用例
- [OK] [OK] pnpm typecheck 与 pnpm lint 干净；pnpm verify:web 四道门通过（以 4180 端口 200 探针取证）
- [OK] [ ] 未完成：真实飞书 / 微信收消息验收，需用户凭证与一次 wrangler deploy

### Status

[OK] **Completed**

### Next Steps

- 在 Cloudflare 写入 NEXTDO_FEISHU_WEBHOOK / NEXTDO_SERVERCHAN_SENDKEY 并部署后，完成一次真实通道验收


## Session 65: 行动提醒时间支持多选
<!-- trellis-session: v=2 fp=1e67c6d8250e1da3 -->

**Date**: 2026-10-26
**Task**: 行动提醒时间支持多选
**Branch**: `main`

### Summary

把行动表单的「提醒时间」从单值改为可增删的多时刻列表，写入层按时刻集合对齐 reminders 表

### Main Changes

- core 新增 deadlineReminderSpecs：升序、分钟粒度去重、丢弃已过去时刻
- db 的 reconcileReminder 改为集合对齐，仍被选中的时刻保留原行 id，只取消被移除的、只插入新增的
- listScheduledReminderFor 改为返回全部时刻的 listScheduledRemindersFor
- snoozeAction 传单元素数组，推迟保持单点语义
- mobile 新增 reminder-times-field 组件并接入项目详情页与编辑弹窗

### Git Commits

| Hash | Message |
|------|---------|
| `c2be7f5` | feat(reminder): 行动提醒时间支持多选，按时刻集合对齐待发提醒 |

### Testing

- [OK] pnpm lint 通过
- [OK] pnpm typecheck 五包通过
- [OK] core 268 / db 333 / mobile 713 测试全绿

### Status

[OK] **Completed**

### Next Steps

- 未在真机验证多提醒的实际通知投递与日历事件生成
- 如需保留多选集合，推迟语义需产品确认


## Session 66: 多选提醒时间与 Google / iCloud 日历目标选择
<!-- trellis-session: v=2 fp=21a43f6b76fc4f05 -->

**Date**: 2026-10-26
**Task**: 多选提醒时间与 Google / iCloud 日历目标选择
**Branch**: `main`

### Summary

行动提醒时间改为可多选（core 的 deadlineReminderSpecs、db 的 reconcileReminder 集合对齐、新增 reminder-times-field 组件、编辑/添加表单接入），snooze 保持单点语义（重新选一个时间提醒即可，已在 PR 与 spec 中确认）。新增系统日历目标选择：device 层 listCalendars / findCalendar、store 增加设备本地的 preferredCalendarId、新增 use-calendar-target hook 与设置页「写入哪个日历」选择器；修复选择器被权限条件挡住导致入口不可见的问题，未授权时直接给「授权并读取日历列表」按钮。两个 PR 已合并（#72、#73），发布 0.1.9-beta.14 / .15 / .16。

### Git Commits

| Hash | Message |
|------|---------|
| `c2be7f5` | feat(reminder): 行动提醒时间支持多选，按时刻集合对齐待发提醒 |
| `a495f27` | fix(calendar): 日历选择器不再被权限挡住，未授权时直接给授权入口 |

### Status

[OK] **Completed**


## Session 67: 提醒只发一次 + 专注结束写入日历
<!-- trellis-session: v=2 fp=1a59f8c7631165d0 -->

**Date**: 2026-10-27
**Task**: 提醒只发一次 + 专注结束写入日历
**Branch**: `feat/single-reminder-and-focus-calendar`

### Summary

提醒收敛为单次投递；专注结束自动生成无闹铃的日历记录

### Main Changes

- 客户端「提醒方式」去掉「两者都发」，旧值归一为系统日历；同一分钟的行动事件与提醒事件只保留前者
- 服务端 Cron 按通道顺序择一发送，首个成功即停，并跳过已 sent 的提醒
- 新增 focus-event 计划器：每条已完成专注会话写入「正在完成【行动标题】」事件，无闹钟，受同样日历开关与 focusRecordSince 约束

### Git Commits

| Hash | Message |
|------|---------|
| `84c5275` | fix(reminder): 同一条提醒只送达一次 |
| `3b6b125` | feat(calendar): 专注结束自动写入日历记录 |

### Testing

- [OK] pnpm verify:web --no-serve 全绿（lint / typecheck / 126+268+333+732 测试 / build:web）
- [OK] cargo check（desktop）通过
- [OK] apps/mobile jest lib/calendar-sync 通过（含新增 focus-event 与 reminder-plan 用例）
- [OK] 浏览器实测 01-04 截图 + evidence.md 存于 .verify/10-27-single-reminder-and-focus-calendar/

### Status

[OK] **Completed**

### Next Steps

- 原生端手测：专注结束后日历出现无闹铃的「正在完成【…】」事件，关闭开关后事件被撤回


## Session 68: 提醒同一时刻重复推送：派发按任务+时刻去重
<!-- trellis-session: v=2 fp=7cbe49b496d52e1f -->

**Date**: 2026-10-28
**Task**: 提醒同一时刻重复推送：派发按任务+时刻去重
**Branch**: `main`

### Summary

线上 Worker 先补齐单次投递修复，再按（任务类型+任务 id+触发时刻）去重；交付门禁全绿并已生产部署

### Main Changes

- 派发去重由单行探针改为组级（deliveredForMoment）

### Git Commits

| Hash | Message |
|------|---------|
| `2f9c685` | fix(server): send one message per reminder moment |
| `e6b24d5` | chore(task): archive reminder-moment-dedupe |

### Testing

- [OK] pnpm verify:web --no-serve 全绿；server/app 10 suites / 127 tests

### Status

[OK] **Completed**

### Next Steps

- 观察下一次微信推送是否只到一条


## Session 69: Commit habit history and actionable review repairs
<!-- trellis-session: v=2 fp=a47108a80b2cb86a -->

**Date**: 2026-11-08
**Task**: Commit habit history and actionable review repairs
**Branch**: `fix/habit-review-repairs`

### Summary

User approved the prepared commit plan. Committed habit history and actionable review repairs, archived both child tasks and the parent, and verified the stored acceptance evidence and unchanged runtime source.

### Main Changes

- Committed the 67 paths from the approved plan, including source, regression tests, specs, and acceptance artifacts.
- Archived 11-07-habit-date-history, 11-07-actionable-review, and 11-07-habit-review-repairs.

### Git Commits

| Hash | Message |
|------|---------|
| `ca7efe0` | fix(app): repair habit history and actionable reviews |

### Testing

- [OK] Rechecked the final pnpm verify:web log: lint, typecheck, 95 suites / 1517 tests, and web export passed. No source or test file was modified after that run; tests were not repeated for this commit-only turn.
- [OK] Confirmed saved browser results and 20 acceptance screenshots under .verify/habit-review-repairs/habits/ and review/, covering success, rollback, retry, and missing-data states.
- [OK] git diff --check and git diff --cached --check passed before the work commit.

### Status

[OK] **Completed**

### Next Steps

- Remote push and PR creation require a separate user request; neither was performed.
- Native devices and live multi-device sync remain unverified. Deferred habit lifecycle policy and legacy review title limits remain documented.


## Session 70: Ship compact desktop focus island
<!-- trellis-session: v=2 fp=7ee0a2bbdee7f3a7 -->

**Date**: 2026-11-10
**Task**: Ship compact desktop focus island
**Branch**: `fix/ime-enter`

### Summary

Accepted focus island with one main-window session owner, isolated desktop controls, and macOS 240x32 compact presentation at 0pt. Removed task verification files and local build output at user request; installers will be built with GitHub Actions.

### Main Changes

- Shared focus runtime and typed IPC keep main and island synchronized without duplicate database/effect owners.
- Compact desktop island uses zero macOS top gap and 240x32 collapsed bounds; expanded controls retain accessible sizes.
- Removed local Rust/Swift caches, web exports, temporary screenshots/harnesses, and isolated browser profiles; unrelated server changes remain untouched.

### Git Commits

| Hash | Message |
|------|---------|
| `ad5ae8c` | feat(focus): add compact desktop focus island |

### Testing

- [OK] Full pnpm verify:web --no-serve passed: 100 suites / 1551 tests.
- [OK] Rust check and 8 tests passed; final full-scope review found no blocking defect.
- [OK] Browser and macOS native checks passed for compact geometry, accessibility, expansion, pause/resume, hide/show, and main restoration.

### Status

[OK] **Completed**

### Next Steps

- Build distribution packages with GitHub Actions. Long-background, sleep/wake, tray/Dock, native keyboard, and Windows/Linux runtime checks remain unverified.


## Session 71: Action workflow and runtime optimizations
<!-- trellis-session: v=2 fp=30989643bba53bea -->

**Date**: 2026-11-10
**Task**: Action workflow and runtime optimizations
**Branch**: `feat/workflow-optimizations`

### Summary

Add project focus and completed-action search; preserve failed snoozes for retry; load action metadata by ID; bound manual sync to eight seconds; prepare v0.1.9-beta.22.

### Main Changes

- Added focus entry and refresh-on-return to project actions, searchable completed actions, and reminder retry that preserves the selected time.
- Replaced whole-table header reads with ID queries and bounded all manual-sync stages with cancellable waits.

### Git Commits

| Hash | Message |
|------|---------|
| `ba5f8ec` | perf(actions): load action details by ID and bound manual sync waits |
| `e61f37c` | feat(actions): add project focus, completed search and snooze retry |
| `225c67c` | chore(release): bump version to 0.1.9-beta.22 |

### Testing

- [OK] pnpm verify:web passed lint, workspace typechecks, 103 suites / 1584 tests and Web build. The local gate includes six pre-existing server changes that are excluded from these commits; PR CI will verify the committed tree.
- [OK] Browser checks passed: eight runtime groups and six workflow groups against synthetic local PowerSync data. Evidence: .verify/runtime-optimization/ and .verify/functional-workflows/. Native devices and real cloud roundtrips were not exercised.
- [OK] node scripts/check-release-version.mjs --tag v0.1.9-beta.22 passed across all six version sources; Cargo.lock was updated too.

### Status

[OK] **Completed**

### Next Steps

- Push the PR, require green CI, merge, and publish beta.22 through GitHub Actions.


## Session 72: Owner token homepage security release
<!-- trellis-session: v=2 fp=253ca2b055e03420 -->

**Date**: 2026-11-10
**Task**: Owner token homepage security release
**Branch**: `fix/owner-token-homepage`

### Summary

Prepare beta.23 with the six previously uncommitted server security files; user requests release trigger only, without waiting for artifacts.

### Main Changes

- Public homepages do not serialize existing owner tokens. First claim displays its connection once; responses disable caching. Copy denial and claim errors have visible guidance.
- Updated regression tests, deployable Worker bundle, operator documentation and security contract; bumped app versions to 0.1.9-beta.23.

### Git Commits

| Hash | Message |
|------|---------|
| `9b556d0` | fix(server): keep owner tokens out of public homepages |
| `229ee2f` | chore(release): bump version to 0.1.9-beta.23 |

### Testing

- [OK] pnpm verify:web passed lint, all workspace typechecks, 103 suites / 1584 tests and Web build.
- [OK] node .verify/release-beta23/check.mjs passed five browser groups, nine screenshots and no uncaught exceptions: token confidentiality, claim, reload, network/403/409 errors, copy denial and settings.
- [OK] pnpm --filter @nextdo/server bundle:worker dry-run passed; cmp confirmed the generated Worker exactly matches server/deploy/worker.js. Version consistency and git diff --check passed.

### Status

[OK] **Completed**

### Next Steps

- Merge after PR CI passes and trigger release for beta.23; do not wait for installer builds. Operators update private deployments and rotate previously exposed tokens separately.


## Session 73: Now 与专注视图交互及按键优化
<!-- trellis-session: v=2 fp=d514970c74d3b973 -->

**Date**: 2026-11-12
**Task**: Now 与专注视图交互及按键优化
**Branch**: `feature/now-focus-ux`

### Summary

重构 Now 列表卡片为整卡进入专注、右侧轻量打勾与右上角更多操作菜单，移除底部 4 占位按钮；重构 Focus 页面为 Idle 一键直启、Running 暂停主控与结算完成流转；全量门禁与浏览器实测通过。

### Git Commits

| Hash | Message |
|------|---------|
| `0de228e` | feat(now,focus): optimize action card interactions and focus control hierarchy |

### Status

[OK] **Completed**


## Session 74: 现在页修复与换一个规则
<!-- trellis-session: v=3 fp=77a5e1ed6922c14b -->

**Date**: 2026-11-18
**Task**: 现在页修复与换一个规则
**Branch**: `main`

### Summary

完成 now 页 10 项缺陷修复：换一个仅在有备选且 skip 写入成功时切换（每行动每会话最多写一次）、备选列表排除当前推荐且空时隐藏、习惯块改为摘要、编辑保留 status/ingest 字段、设置写入串行化。pnpm verify:web 全绿，浏览器六状态截图验证。
Topics: [.trellis/research/now-screen-presentation.md](../../research/now-screen-presentation.md)

### Git Commits

(No associated commits)


## Session 75: Now 页审查修复与 beta.28 发布
<!-- trellis-session: v=3 fp=fe12f25f31cf913e -->

**Date**: 2026-11-18
**Task**: Now 页审查修复与 beta.28 发布
**Branch**: `main`

### Summary

按 reviewer 两轮审阅修复：hero 溢出菜单固定行动 ID 并从最新 eligible 取行动（编辑器读最新备注，目标离开则关闭）；updateNextAction 在写事务内读取当前行、只覆盖编辑字段并保留推迟/跳过状态，done 行动不再重新武装提醒；推荐卡补两行备注预览；engine-context 读取不覆盖加载期间的新选择，Web 存储写入失败上抛且满额可读时仍走真实存储；挂载读取在用户更新后不再改界面值或错误状态；习惯块说明统一为最多 3 个。pnpm verify:web 全绿（1608 tests），浏览器四状态实测（含写入失败态）。PR #86 已合并，0.1.9-beta.28 发布 10 个资产。
Topics: [.trellis/research/now-screen-presentation.md](../../research/now-screen-presentation.md)

### Git Commits

| Hash | Message |
|------|---------|
| `36d9805` | fix(now): keep edits and engine settings consistent across refreshes |
| `742d7bc` | Merge pull request #86 from nextdo-app/fix/now-review-findings |
| `fd275e4` | chore(release): bump version to 0.1.9-beta.28 |

### Testing

- pnpm verify:web：lint、typecheck、core 275 / server 133 / db 361 / mobile 839 tests、web build 全部通过
- headless Chrome 实测 /projects 与 /now：菜单打开、备注预览、15 分钟过滤后菜单关闭、设置写入失败提示；截图在 .verify/now-review-findings/

### Next Steps

- 可选未做：240 分钟专注时长提示、now.tsx 轮换查找优化


## Session 76: 资料库可选启用规则与 Focus bug 优先级
<!-- trellis-session: v=3 fp=ea6eec5660a43170 -->

**Date**: 2026-11-19
**Task**: 资料库可选启用规则与 Focus bug 优先级
**Branch**: `main`

### Summary

用户确认资料库（ReferenceItems）为可选启用功能，用户可以关闭或不启用；当前先修 Focus 估时超过 180 分钟时的静默回退 bug，资料库 MVP 后做。
Topics: [.trellis/research/reference-library.md](../../research/reference-library.md)

### Git Commits

(No associated commits)

### Next Steps

- 修 Focus 240 分钟静默回退；资料库 MVP 待启动。


## Session 77: 取消交付前验证的截图要求
<!-- trellis-session: v=3 fp=a4d56af11e66bede -->

**Date**: 2026-11-19
**Task**: 取消交付前验证的截图要求
**Branch**: `main`

### Summary

用户确认：交付前验证保留浏览器实测，但取消截图存档要求，不再使用 .verify/ 目录。已删除 scripts/capture-verify-screenshots.mjs 和 .verify/（36M），并同步更新 AGENTS.md、.cursor/commands/verify-web.md、.trellis/spec/project/quality-guidelines.md（删除交互态截图一节）、.gitignore。
Topics: [.trellis/spec/project/quality-guidelines.md](../../spec/project/quality-guidelines.md)

### Git Commits

(No associated commits)


## Session 78: Issue #97 设置项跨设备同步
<!-- trellis-session: v=3 fp=5b8108dd626dd3d4 -->

**Date**: 2026-11-20
**Task**: Issue #97 设置项跨设备同步
**Branch**: `feat/settings-sync`

### Summary

交付 issue #97：新增同步 settings 表（确定性 id setting:<key>），主题、专注时长与 Now 可用时间跨设备同步，通知、日历、更新与习惯提醒保留本机；客户端桥以 DB 行为同步事实来源、本地缓存只负责首帧。门禁 pnpm verify:web 通过（1652 测试），浏览器实测覆盖播种、删本地缓存后由 DB 恢复、专注时长写入与双标签页实时同步。
Topics: [.trellis/research/settings-sync.md](../../research/settings-sync.md)
## Session 78: 外部日历：系统日历只读忙碌导入（issue #100）
<!-- trellis-session: v=3 fp=77342bdc4a96b9af -->

**Date**: 2026-11-21
**Task**: 外部日历：系统日历只读忙碌导入（issue #100）
**Branch**: `feat/external-calendar-import`

### Summary

交付 issue #100 的只读部分：系统日历定时忙碌事件作为引擎硬日程约束。新增纯过滤器 import.ts、设备读取 listEventsForImport、useExternalCalendarBlocks（挂载/5 分钟/回前台刷新，失败保留旧快照并提示）、设置开关 calendarImportEnabled（设备本地，默认关闭）与 Now 接入。跳过全天、free、canceled 与 Nextdo 自身镜像事件。CalDAV 与双向同步未实现，已记入 backlog。门禁 r2 全绿（1662 tests），浏览器冒烟通过（Web 不渲染开关，显示平台不支持）。
Topics: [.trellis/research/external-calendar-import.md](../../research/external-calendar-import.md)

### Main Changes

- 新增 apps/mobile/lib/calendar-sync/import.ts 纯函数忙碌过滤与窗口常量
- device/index 增加 listEventsForImport；reconcile 导出 NEXTDO_EVENT_NOTE
- 新增 hooks/use-external-calendar-blocks.ts 并接入 use-now/now 屏；设置页新增导入开关
- notification-settings 增加 calendarImportEnabled 解析与合并保存
## Session 78: NextAction 时间窗口与依赖输入入口（issue #98）
<!-- trellis-session: v=3 fp=68943cf90a5e4817 -->

**Date**: 2026-11-20
**Task**: NextAction 时间窗口与依赖输入入口（issue #98）
**Branch**: `feat/next-action-window-deps`

### Summary

在行动编辑弹窗加入适用日、可选时间段与前置行动（单选），保存走完整行语义，清空即写 undefined/NULL；updateNextAction 合并行补上 dependsOnId/windowStart/windowEnd/windowDays，此前这些字段保存会被静默丢弃。新增 useActionDependencyOptions：排除自身与直接/间接依赖自身的行动以防成环，候选读取失败时保留原依赖。Now 屏被过滤区块在存在可执行行动时也显示，window-mismatch 与 dependency 行可直接打开编辑。测试：db 读写与清空、now-screen 三条（保存/过滤中可编辑/清空）。门禁 pnpm verify:web --no-serve 全绿 1645；浏览器实测窗口外过滤、依赖未完成过滤、清除恢复、完成依赖恢复、写入失败保留、候选读取失败保留原依赖。
Topics: [.trellis/research/next-action-window-deps.md](../../research/next-action-window-deps.md)
## Session 78: 通知内联操作：完成 / 推迟 / 跳过
<!-- trellis-session: v=3 fp=9392147e9ad55fdf -->

**Date**: 2026-11-21
**Task**: 通知内联操作：完成 / 推迟 / 跳过
**Branch**: `feat/notification-inline-actions`

### Summary

实现 issue #99：原生提醒注册「完成 / 推迟 10 分钟 / 跳过」动作目录，响应经适配器分发到 delivery hook，分别执行 completeAction / snoozeAction / skipAction；失败以根布局中文横幅提示；web 直接通知点击聚焦窗口，桌面/未知动作降级为打开应用。新增纯解析、适配器、hook 与横幅测试；门禁 1664 项与 Web 冒烟通过。详见 research 主题。
Topics: [.trellis/research/notification-inline-actions.md](../../research/notification-inline-actions.md)
## Session 78: 自然语言捕获解析（#101 日期/时间增量）
<!-- trellis-session: v=3 fp=df9f3c89cbe1e7e7 -->

**Date**: 2026-11-22
**Task**: 自然语言捕获解析（#101 日期/时间增量）
**Branch**: `feat/natural-language-capture`

### Summary

实现 packages/core 本地解析器（日期/时间/截止或日程判定）、捕获预览（类型切换/修改/撤销，原文不改）、Clarify 路由参数预填（仅填空字段，23:59 折叠为仅日期）。不改 inbox_items schema。门禁 verify:web --no-serve 全绿 1688 项；浏览器实测速记预览、撤销、记录并澄清预填与内联卡片截止解析均符合预期。重复规则、项目/标签识别未做，已记 backlog。
Topics: [.trellis/research/natural-language-capture.md](../../research/natural-language-capture.md)
## Session 78: 回顾详情支持跳转项目/等待/Someday（#67）
<!-- trellis-session: v=3 fp=346e5de0ee77850e -->

**Date**: 2026-11-22
**Task**: 回顾详情支持跳转项目/等待/Someday（#67）
**Branch**: `feat/review-links-67`

### Summary

review-detail section 改为带 href 的条目；项目→/projects/<id>，等待→/waiting，Someday→/someday；行动与日程无详情路由保持纯文本。新增 lib 与详情页测试。门禁 1648 项通过；浏览器实测按用户 2026-11-22 明确要求跳过，不声称浏览器已验证。
Topics: [.trellis/research/review-page.md](../../research/review-page.md)

### Git Commits

(No associated commits)


## Session 79: issue #98 审查修复：窗口字段所有权与 Hooks 顺序
<!-- trellis-session: v=3 fp=aa7f52470784d032 -->

**Date**: 2026-11-20
**Task**: issue #98 审查修复：窗口字段所有权与 Hooks 顺序
**Branch**: `feat/next-action-window-deps`

### Summary

处理首轮审查 R1/R2：updateNextAction 新增 windowFields 参数，只覆盖调用方显式拥有的键；未提供的键保留事务内当前值，显式 undefined 仍清空。修复项目页旧快照 title-only 保存会撤销另一处刚设置的窗口/依赖；use-update-next-action 按 patch 中实际存在的键生成 windowFields。把 edit-action-modal 的 useAppInsets 移到条件 return 之前，消除隐藏→显示时的 React Hooks 顺序警告。补 db 回归（旧快照只改标题保留窗口/依赖）、项目页断言（第4参为空对象）。门禁 pnpm verify:web --no-serve 全绿 1646（core275/server133/db372/mobile866），gate 日志无 Hooks 警告。浏览器补测时间段：起止倒置与空适用日被拦截、07:30–08:30 窗口外过滤、重开回填、刷新持久化、关闭后恢复；hooksWarnings=0。
Topics: [.trellis/research/next-action-window-deps.md](../../research/next-action-window-deps.md)
## Session 79: 修复 #101 复审 R1–R6
<!-- trellis-session: v=3 fp=593049ba6ae6e206 -->

**Date**: 2026-11-22
**Task**: 修复 #101 复审 R1–R6
**Branch**: `feat/natural-language-capture`

### Summary

按复审修正：自然周前缀（下/下下/本周）、显式24小时值与中文分钟、今晚9:30简写合并、ISO/斜线日期与非法锚点返回 null、截止词优先于日历词、向导按字段记录预填状态、捕获成功后重置撤销覆盖值。core 27 项解析测试与 mobile 预填/撤销回归测试通过。门禁 verify:web --no-serve 全绿 1699 项；浏览器复验 03:00/21:30/15:20、本周三11/18、非法日期/时钟无预览、撤销不泄漏与 Clarify 预填。日志与证据在 job tmp。
Topics: [.trellis/research/natural-language-capture.md](../../research/natural-language-capture.md)

### Git Commits

(No associated commits)


## Session 80: issue #98 第二轮审查修复：字段所有权与成环校验
<!-- trellis-session: v=3 fp=f8eb79503ab9b301 -->

**Date**: 2026-11-21
**Task**: issue #98 第二轮审查修复：字段所有权与成环校验
**Branch**: `feat/next-action-window-deps`

### Summary

处理第二轮 4 项 P2：1) 弹窗改为只有用户实际改过的窗口/依赖字段才进 patch，候选读取失败或仍在加载时省略 dependsOnId，改标题不再覆盖另一处刚保存的依赖；2) 候选列表外的日历/习惯前置在未改动时保留，只有「无依赖」显式清除；3) 单边时间窗口未改动时不校验完整性，可只改标题，修改时间段后恢复完整起止校验；4) updateNextAction 在同一写事务内沿依赖链回溯，自身或重复 id 抛 action.dependency-cycle，覆盖两个已打开编辑器互选对方的场景，并映射中文错误。测试新增：db 成环（两节点/自身/三节点链）与旧快照回归；now 屏读取失败省略键、日历依赖保留与显式清除、单边窗口。门禁 pnpm verify:web --no-serve 全绿 1650（core275/server133/db373/mobile869）。浏览器 r3 全部通过：适用日/时间段过滤、回填、刷新、清除、依赖、两类故障注入、hooksWarnings=0。reviewer 曾被人类重启，已重发完整材料。
Topics: [.trellis/research/next-action-window-deps.md](../../research/next-action-window-deps.md)
## Session 79: 修复 #99 审查问题：旧通知状态校验与完成范围
<!-- trellis-session: v=3 fp=30ca0409957b86bc -->

**Date**: 2026-11-21
**Task**: 修复 #99 审查问题：旧通知状态校验与完成范围
**Branch**: `feat/notification-inline-actions`

### Summary

按 reviewer 要求，推迟/跳过在规范事务内检查行动仍为 open；旧通知不能给已完成行动写 snooze/skip 或新建 scheduled reminder，失败以 action.not-open 走中文横幅。新增 db 与 hook 回归，恢复事务测试改为直接写入状态。确认 #99 为部分完成：当前交付前台路径（opensAppToForeground），后台事务保留在 backlog。门禁 1669 项与 Web 冒烟通过。
Topics: [.trellis/research/notification-inline-actions.md](../../research/notification-inline-actions.md)
## Session 80: 修复 #101 复审 R7–R8
<!-- trellis-session: v=3 fp=a214edc8276b2c41 -->

**Date**: 2026-11-22
**Task**: 修复 #101 复审 R7–R8
**Branch**: `feat/natural-language-capture`

### Summary

R7：单字前不再全段匹配，只有紧跟在时间后的前才作为截止表达，并排除前往/前端/前台/前面/前方；之前/以前/截止/截至仍任意位置生效。R8：MINUTE_WORD 与 chineseNumber 支持零前缀（零五=5），普通点式与今晚简写路径保留分钟。core 解析 28 项通过，reviewer 的 15 项验收/回归测试全过。最终门禁 verify:web --no-serve 1700 项全绿；浏览器复验前端会议/前往医院为日程、3点前提交为截止、三点零五→15:05。research 清理了纠偏过程表述。
Topics: [.trellis/research/natural-language-capture.md](../../research/natural-language-capture.md)

### Git Commits

(No associated commits)

### Testing

- pnpm verify:web；浏览器脚本 verify-97/capture.mjs，结果 ok=true（含 crossTab=true）

### Next Steps

- reviewer 复核；通过后按授权处理下一个 issue。工作区 .worktrees/settings-sync 未提交。


## Session 79: Issue #97 首轮审查修复
<!-- trellis-session: v=3 fp=bb10a12600805a27 -->

**Date**: 2026-11-20
**Task**: Issue #97 首轮审查修复
**Branch**: `feat/settings-sync`

### Summary

处理 #97 首轮审查的 R1/R2/R3：R1 播种只读设备存储，避免首读默认值（theme system / engine 60）覆盖账本偏好；R2 两份云部署文档补 settings Sync Rule，并按当前源码重建仓库直贴版 server/deploy/worker.js，新增产物一致性测试；R3 settings 写失败保留 pending 意图、bridge 跳过旧行、全局重试横幅，补单测与浏览器注入写失败/恢复场景。门禁 pnpm verify:web --no-serve 通过（1662 测试），浏览器全部场景 ok。
Topics: [.trellis/research/settings-sync.md](../../research/settings-sync.md)
- pnpm verify:web --no-serve：1662 tests 全过（core 275 / server 133 / db 370 / mobile 884），web 构建成功
- headless Chrome 冒烟：Now/Settings 正常，Web 正确隐藏导入开关，控制台无相关错误

### Next Steps

- CalDAV / 双向同步按 backlog 推进；真机验证日历读取与权限弹窗


## Session 79: 外部日历导入：review R1/R2 修正
<!-- trellis-session: v=3 fp=200a7173e75bcb52 -->

**Date**: 2026-11-21
**Task**: 外部日历导入：review R1/R2 修正
**Branch**: `feat/external-calendar-import`

### Summary

按 reviewer 首轮意见修正 issue #100 只读导入。R1：读取能力与写入能力分开判断，新增 isCalendarImportSupported()（仅 native 为 true），useCalendarPermission 暴露 importSupported；macOS 桌面壳可写不可读，设置页不渲染导入开关并显示说明。R2：每次写日历事件都在用户备注后追加来源标记（nextdoEventNotes），导入改按 notes.includes 识别，跨设备无本地映射也能排除镜像；签名包含标记，旧事件在下一次同步时更新一次补标记。新增桌面能力、设置页入口、跨设备镜像、旧签名迁移测试。门禁 r3 全绿（1668 tests），浏览器冒烟覆盖 Web 与模拟 macOS 壳。
Topics: [.trellis/research/external-calendar-import.md](../../research/external-calendar-import.md)

### Main Changes

- reconcile: nextdoEventNotes 追加标记，签名纳入标记；device/desktop 写入带标记备注
- index: isCalendarImportSupported；use-calendar-permission: importSupported；settings 按读取能力控制入口
- import: 按 notes.includes(NEXTDO_EVENT_NOTE) 排除镜像

## Session 81: issue #98 第三轮审查修复：错误码映射与合并行校验
<!-- trellis-session: v=3 fp=52dcc914f2eb0dc4 -->

**Date**: 2026-11-21
**Task**: issue #98 第三轮审查修复：错误码映射与合并行校验
**Branch**: `feat/next-action-window-deps`

### Summary

处理第三轮 2 项 P2：1) use-update-next-action 在 catch 中调用 errorMessage(err)，保留 action.dependency-cycle 等错误码的中文映射；now 屏新增经真实 hook 的断言：成环失败显示中文、弹窗保留、换前置后重试成功。2) updateNextAction 对最终 merged 行执行 assertValidNextAction，第 4 参 windowFields 的非法 HH:mm（如 9am）被拒绝且原行不变；db 回归覆盖。同步修正 hook 注释与 research 中 07:30–08:30 的过时叙述。门禁 pnpm verify:web --no-serve 全绿 1652（core275/server133/db374/mobile870），无 Hooks 警告；浏览器 run-98-r4.log 全通过，hooksWarnings=0。
Topics: [.trellis/research/next-action-window-deps.md](../../research/next-action-window-deps.md)

## Session 81: 修复 #101 复审 R9
<!-- trellis-session: v=3 fp=1f853546ba2dac84 -->

**Date**: 2026-11-22
**Task**: 修复 #101 复审 R9
**Branch**: `feat/natural-language-capture`

### Summary

R9：收窄前+面排除规则为 面(?!试)，使「3点前面试结束」判为 deadline，同时保留前往/前端普通词反例。core 解析 29 项通过，reviewer 独立测试 16 项全过。最终门禁 1701 项全绿；浏览器复验面试→截止、前往医院/前端会议→日程。research 同步规则、测试数与证据。
Topics: [.trellis/research/natural-language-capture.md](../../research/natural-language-capture.md)

### Git Commits

(No associated commits)

### Testing

- pnpm verify:web --no-serve；verify-97/capture.mjs，结果含 writeFailure 全部 true

### Next Steps

- 交回 reviewer 复审；通过后按授权处理下一个 issue。工作区未提交。


## Session 80: Issue #97 写失败意图持久化
<!-- trellis-session: v=3 fp=31a09df008b99933 -->

**Date**: 2026-11-20
**Task**: Issue #97 写失败意图持久化
**Branch**: `feat/settings-sync`

### Summary

R3 补持久化：settings 写失败的最新意图写入设备存储 nextdo.settings.pending，bridge 启动时先恢复再应用下载行，pending 期间跳过旧行；刷新/重启后横幅与值仍保留，重试提交后才清除。补 bus 重启恢复与 bridge 刷新前后回归；门禁 1664 测试通过，浏览器覆盖写失败→刷新→重试→再刷新。移除代码/测试中的审查过程措辞。
Topics: [.trellis/research/settings-sync.md](../../research/settings-sync.md)

### Git Commits

(No associated commits)

### Testing

- pnpm verify:web --no-serve；verify-97/capture.mjs，writeFailure 全部 true（含 survivedReload / persistedAfterReload）

### Next Steps

- 交回 reviewer 复审；通过后按授权处理下一个 issue。工作区未提交。


## Session 81: Issue #97 多标签页 pending 持久化
<!-- trellis-session: v=3 fp=1996cd022f7f7f35 -->

**Date**: 2026-11-20
**Task**: Issue #97 多标签页 pending 持久化
**Branch**: `feat/settings-sync`

### Summary

R3 再加固：pending 持久化从单个 JSON 快照改为每 key 一个设备存储项（nextdo.settings.pending.<key>），持久化队列内读取本 key 当前值，成功时只删本 key；另一标签页提交不同设置不再清除本标签页的未提交意图。补两个独立 bus 共享存储的回归；浏览器覆盖 A 写失败→B 成功改主题→刷新 A→横幅与 30 仍在→重试成功→再刷新。门禁 1665 测试通过。
Topics: [.trellis/research/settings-sync.md](../../research/settings-sync.md)

### Git Commits

(No associated commits)

### Testing

- pnpm verify:web --no-serve（core 275 / server 134 / db 376 / mobile 880，共 1665）；verify-97/capture.mjs 结果 ok=true，writeFailure 含 otherTabWrite / survivedReload / recovered / persistedAfterReload

### Next Steps

- 交回 reviewer 复审；通过后按授权处理下一个 issue。工作区未提交。
- 新增 mirror-import/reconcile 迁移/device 备注/desktop 能力/settings 入口测试；pnpm verify:web --no-serve 1668 tests 全过
- headless Chrome：Web 隐藏开关；模拟 macOS 壳显示写入、隐藏导入并给出说明

### Next Steps

- 等待 reviewer 复审；通过后清理 dist 与端口并进入下一个 issue
