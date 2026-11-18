# 手动走查记录 — Web 浏览器（AC1–AC8）

验证面：`pnpm --filter @nextdo/mobile web`（Metro `http://localhost:8081`），浏览器逐条走查。
离线模式（无 owner token）：同步流报 `Not signed in` 属预期噪音（同步链由 `09-22-e2e-sync-roundtrip` 覆盖），本地 DB 读写不受影响。
日期：2026-09-23。

## 走查中发现并修复的 bug

**B1 — watch `error: null` 导致整树崩溃白屏（严重）**
- 现象：Inbox/Projects/Review 首次进入正常，`@powersync/react` 的 watched-query 状态更新为 `error: null` 后，数据 hook 用 `error === undefined ? null : String(error.message)` 判空，走进 else 读 `null.message` 抛 `TypeError`，无 error boundary → 整树卸载白屏。
- 根因：`@powersync/react` 类型标 `error: Error | undefined`，运行时实为 `null`。所有单测 mock 固定返回 `error: undefined`，未覆盖 `null` 路径。
- 修复：4 个数据 hook 改 truthy 判空（`error ? String(error.message) : null`）：`use-inbox-items.ts` / `use-review-records.ts` / `use-projects.ts` / `use-action-pool.ts`。
- 回归：新增 `__tests__/watch-error-null.test.tsx`（mock `useQuery` 返回 `error: null`，渲染四个 tab，旧代码渲染即抛错）。

**观察项（非阻断）**：Now 屏内容在较矮视口下会溢出，底部 snooze sheet 需滚动/不可达。真机/更高视口正常，记录留待后续 UI 打磨。

## AC 逐条结果

| AC | 验证 | 结果 |
|----|------|------|
| AC1 捕获 | Inbox 输入「整理季度汇报材料」回车保存 → 列表出现（含「捕获于 2026/9/23」+ 删除）；两步确认删除 → 条目消失 | ✅ |
| AC2 明晰 | **全 7 分支走通**（两轮合计）。第一轮：project outcome（「研究竞品定价模型」项目+首个行动原子创建入 Projects/Now 池）、next-action（入 Now 池）、必填拦截（项目无 outcome → 中文提示「请填写项目结果（"完成"是什么样）」不落行）。第二轮（2026-09-23 下午，条目名 AC2-A…G）：reference（Q1 否→Q1b 资料；无 URL 点保存 → 拦截「请填写链接（URL）」；补 URL 提交 → 自动返回、收件箱清空；reference 行无展示屏，行创建与收件箱软删同属 `applyClarify` 单事务）；do-now（Q3 是→Q3b「是，现在就做完」直接提交，无表单；今日完成 4→5 证实 completion 落行，同时回归验证 Q3b 直提路径 reducer 修复）；someday（周回顾 Someday(1) 可见「AC2-D：学 Rust」）；waiting（Q4 否→waiting 表单填「法务」+expectedBy=今日 → 日常/周回顾「待跟进（已过期）」显示「AC2-E：等法务回合同评审 — 等法务」）；calendar（周回顾「未来 7 天日程」显示「AC2-F：年度规划会（2026/9/25 15:00）」；远期日程不入 Now 推荐池为 spec 预期：`EngineInput.actions` 只含当日/临近 CalendarAction）；project+首个行动（「AC2-G：筹备年度报告」入 Projects(3) + Now 推荐卡，Why this? 含「支撑一个重要项目」） | ✅ |
| AC3 Now | 引擎推荐「研究竞品定价模型（10分钟）」，Why this? top-3 中文化；「稍后 2 个可执行事项」= eligible 数。「换一个」连跳 3 次 → 触发再明晰横幅（consecutiveSkips≥3），推荐项变化后横幅消失。「稍后」→ 选 10 分钟后 → 该行动退出池（稍后数 2→1），推荐切到「给团队同步本周进展」，reminders 落行 | ✅ |
| AC4 专注 | 「开始」→ 25 分钟倒计时（24:55 递减）；「暂停」→ 冻结（多次读取恒 24:55，按钮变「继续」）；「完成」→ 行动完成出池，返回 Now，该行动消失。第二轮补「放弃」：计时中（24:39）点「放弃」→ 自动返回 Now，行动仍在推荐池（未完成）；再次「开始」→ 显示全新选时长（abandoned 会话不恢复，重入恢复仅对 active 会话） | ✅ |
| AC5 项目 | 项目详情显示名下 open action（每行 完成/稍后/删除）；完成该行动 → 覆盖率 tag「有进行中的行动」→「缺少行动」（红灯）+ 空态文案；「＋ 添加行动」填标题/est → 新行动出现，tag 翻回「有进行中的行动」 | ✅ |
| AC6 日常回顾 | 第一轮：snapshot 真实数据（收件箱 0 / 今日完成 1 / 未完成 1）；「明日必做」→ 提交 → 行动 snooze 到明天 08:00（Now 屏当日不可用，显示「已稍后，未到提醒时间」），daily 记录「完成 0 · 排期 0 · 明日必做 1」历史可见。第二轮补两分支：行1「整理调研数据」勾「已完成」+ 行2「AC2-B」排期输入 2026-09-24 → 提交（提交中… disabled）→ 今日完成 5→6（勾选落 completion）、未完成列表 3→2（整理调研数据消失，AC2-B 留 stillOpen 但 snoozedUntil=9/24 08:00 出池）、新 daily 记录「完成 1 · 排期 1 · 明日必做 0」入库；附带验证：整理调研数据是「研究竞品定价模型」项目最后 open action，勾选完成后该项目覆盖率 tag 实时翻「缺少行动」。变更中途失败不写记录 = 组件测试覆盖（mock 变更失败 → 无 review record） | ✅ |
| AC7 周回顾 | 第一轮：snapshot（收件箱 0 / 项目 1 含覆盖率+最近进展 / inboxCleared+calendarReasonable 确认）；项目置「已完成」→ 提交 → status 更新，weekly 记录「项目 1 · 待跟进 0 · Someday 0」入库。第二轮补删 someday：Someday(1)「AC2-D：学 Rust」点「删除」→ 提交（toast 拦截时用 CDP 派发 DOM click）→ 自动返回历史，新 weekly 记录「项目 3 · 待跟进 1 · Someday 1」（snapshot 为进屏时口径）；重开周回顾 → Someday 0 条「没有"有空再说"的条目」（删除已执行），且 AC2-E 已过期等待出现在周回顾「待跟进（已过期）」+「跟进勾选」区 | ✅ |
| AC8 门 | 根门全绿（2026-09-23 收尾复跑）：`pnpm lint` ✓（无输出）、`pnpm typecheck` ✓（ui/core/db/server/mobile 全 Done）、`pnpm test` EXIT=0（server 51 + core 153 + db 141 + mobile 121 = 466 passed，0 failed；最终检查 pass 又补 4 条边界用例——不可能日期拦截/无效排期拒绝/reclarify 不可解析 kind 不死循环等，mobile 125，合计 470 passed）；web 可启动（Metro 8081），AC1–AC7 走查通过 | ✅ |

## 验证命令输出（收尾，2026-09-23 复跑）

```sh
$ pnpm lint            # eslint . — 无输出（0 error / 0 warning）
$ pnpm typecheck       # packages/ui、packages/core、packages/db、server/app、apps/mobile 全部 Done
$ pnpm test            # EXIT=0
server/app test:  Test Suites: 3 passed  / Tests: 51 passed
packages/core test: Test Suites: 9 passed / Tests: 153 passed
packages/db test:   Test Suites: 11 passed / Tests: 141 passed
apps/mobile test:   Test Suites: 15 passed / Tests: 121 passed
# 合计 466 passed, 0 failed（此块为收尾时点输出；其后最终检查 pass 补 4 条边界用例——
# 不可能日期拦截/无效排期拒绝/reclarify 不可解析 kind 等，复跑 = mobile 125，合计 470 passed, 0 failed）
```

## 第二轮走查说明（2026-09-23 下午）

第一轮（上午）记录于本文件初稿；当时 AC2 仅覆盖 project / next-action 两分支，AC4 缺「放弃」、AC6 缺「已完成」勾选与显式「排期到 <日期>」、AC7 因 Someday 为 0 无法验证删除。下午补走上述分支（测试数据命名 AC2-A…G），并复跑根门。另做文案中文化扫描：`apps/mobile/app/**.tsx` 无英文 JSX 文本 / placeholder / label，`lib/error-messages.ts` 全量中文映射。
