# Design — App UI 四 tab 功能化

技术设计（任务 09-22-app-ui-screens）。约定一律以 `.trellis/spec/` 为准；本文件只写本任务的结构决策。PRD 见同目录 `prd.md`（含用户已拍板的 3 项决策）。

---

## 1. 边界

**改动的包**

| 包 | 改动 |
|----|------|
| `apps/mobile` | 主战场：4 个 tab 屏重写 + 5 条新路由（clarify / reclarify / focus / project 详情 / review daily / weekly）+ hooks + lib 纯逻辑 |
| `packages/db` | **只增不改**：① 新增 `listCompletionRecords` 只读查询（`queries/reviews.ts`）；② 新增 `buildDailyReviewSnapshot` / `buildWeeklyReviewSnapshot`（`queries/reviews.ts`，组合既有 list 查询）；③ 按 Rule 3 在 `src/index.ts` 扩展导出面（index 文件注释明确"feature tasks extend this list as their screens land"） |
| `packages/core` | 不动（决策表、引擎、invariants 全部现成） |
| `packages/ui` | 按需新增小组件（见 §6） |
| `server/*` | **零改动**（不新增后端端点 — PRD 硬约束） |
| PowerSync schema / sync-config | **零改动**（无新表、无新列 → 无迁移、无同步面变化） |

**新增依赖**：无。通知不装（见 Out of Scope）。

---

## 2. 路由图（expo-router）

```
app/
├── (tabs)/
│   ├── _layout.tsx        改：tab 标题中文化（现在/收件箱/项目/回顾）
│   ├── now.tsx            重写（§4.1）
│   ├── inbox.tsx          重写（§4.2）
│   ├── projects.tsx       重写（§4.3）
│   └── review.tsx         重写（§4.4）
├── clarify/[inboxId].tsx          新增：Clarify 向导（完整 Q1–Q5）
├── reclarify/[id].tsx             新增：再明晰向导（Q2 起，?kind=next|calendar）
├── focus/[id].tsx                 新增：专注计时屏（?kind=next|habit|calendar）
├── projects/[id].tsx              新增：项目详情
└── review/
    ├── daily.tsx                  新增：日常回顾
    └── weekly.tsx                 新增：周回顾
```

向导与专注屏是模态式全屏（`headerShown: false` + 屏内自绘返回），不占 tab。

---

## 3. packages/db 增量（全部 additive）

```ts
// queries/reviews.ts 追加
export async function listCompletionRecords(
  db: NextdoDb,
  options?: { actionIds?: string[]; since?: Date },
): Promise<CompletionRecord[]>;

/** daily 回顾 snapshot（core DailyReviewSnapshot 形状）。 */
export async function buildDailyReviewSnapshot(db: NextdoDb, now: Date): Promise<DailyReviewSnapshot>;
/** weekly 回顾 snapshot（core WeeklyReviewSnapshot 形状）。 */
export async function buildWeeklyReviewSnapshot(db: NextdoDb, now: Date): Promise<WeeklyReviewSnapshot>;
```

**snapshot 字段定义**（全部由既有数据派生，不新增存储）：

- daily：`inboxCount` = 未删 InboxItem 数；`completedToday` = 本地日 = 今天的 completion_records 的 actionId；`stillOpen` = 所有 open NextAction id（按 created 升序）；`projectsMissingActions` = `projectActionCoverage` 中 `hasOpenAction === false` 的 id；`waitingFollowUps` = open WaitingFor 且 `expectedBy` 已过期（≤ 今天）；`calendarToday` / `calendarTomorrow` = `startsAt` 落在本地今天/明天的 CalendarAction；`repeatedSkips` = `consecutiveSkips ≥ RECLARIFY_THRESHOLD`（复用 core 常量，与 Now 屏 needsReclarify 同集）
- weekly：`inboxCount` 同上；`projects` = `projectActionCoverage` + 每个项目的 `lastProgressAt`（其名下 action 的最新 completion，无则 null）；`waitingFollowUps` 同上；`somedayCount` = 未删 SomedayMaybe 数；`stalledProjects` = 项目 action 近 14 天无任何 completion 的 active 项目（类型注释定义的口径）；`calendarNext7` = `startsAt` 在未来 7 天内的 CalendarAction

**index.ts 导出增量**（Rule 3：app 只能经 index 触达内部查询模块）：
`addInboxItem, trashInboxItem, applyClarify, reclarifyAction, completeAction, snoozeAction, trashAction, listNextActions, addNextAction, updateNextAction, listProjects, addProject, updateProject, trashProject, listWaitingForItems, listSomedayMaybeItems, listCalendarActions, trashSomedayMaybeItem, listContexts, addContext, listHabits, listHabitDays, startFocusSession, recordPause, completeFocusSession, abandonFocusSession, addReviewRecord, listCompletionRecords, buildDailyReviewSnapshot, buildWeeklyReviewSnapshot` + 对应类型（`ClarifyTarget, ClarifyResult, ReclarifyAnswers` 等）。

**测试**：`packages/db/src/test/` 现有 powersync-node harness + fixtures 直接可用；为三个新函数写 co-located 测试（snapshot 各字段的空/非空/边界：过期 waiting、14 天 stall 边界、本地日切换）。

---

## 4. 各屏数据流（屏 = 展示 + 事件；数据走 hooks；变更走 packages/db 事务 — component-guidelines / hook-guidelines）

### 4.1 Now 屏（重写）

```
useAppClock (60s tick)
  → useEngineContextSettings（新增 hook：secure-store 读写 { contextIds, availableMinutes }）
  → useActionPool(now)（既有）
  → recommend({ ...pool, context: { contextIds, availableMinutes }, now })（useNow 扩展：
       除推荐外再返回 eligible 列表、needsReclarify、被过滤摘要）
```

界面（自上而下）：

1. **引擎上下文条**：两行 chip —
   - 场景：`[任意, …listContexts()]` + 「＋」inline 输入建 context（`addContext`）；选中集写入 secure-store；
   - 时间：`[15, 30, 60, 120 分钟]` + 自定义数字输入；默认 60（沿用 scaffold 值）。
2. **推荐卡**：kind tag、标题、est tag、`项目 · 截止` 副题（有则显示）、Why this?（top-3 score reasons + eligibility 摘要，复用 `reason-labels.ts` 中文化）。
3. **needsReclarify 横幅**（推荐项 `consecutiveSkips ≥ 3` 时）：「这个任务已连续跳过 N 次 — 重新明确下一步？」→ 进 reclarify 路由。
4. **主按钮**：
   - `[开始]` → `router.push(/focus/{id}?kind=)`（决策 1）；
   - `[换一个]` → `skipAction`（既有 useSkipAction）→ pool 刷新后自动出新推荐；
   - `[稍后]` → snooze 选择 sheet（§4.6）→ `snoozeAction`（自动落 reminder 行、重置 skips — 事务内已完成）。
5. **底部摘要行**：「稍后 N 个可执行事项」（= `eligible.length`，点开为可展开列表：标题 + est，每行可 稍后/删除）·「今天习惯 done/total」。
6. **今日习惯条**：`listHabitDays({ localDate: 今天YYYYMMDD })`（新 hook）；total = 当天全部 habit days，done = status done；每个未完成习惯 chip 可一键完成（`completeAction({ actionKind: 'habit' })`）。习惯日会自然进入引擎池（pool 既有逻辑），被推荐时走同一推荐卡。
7. 空态：池空 / 全被过滤 → 区分提示（"去收件箱捕获" / "没有任何适合当前场景与时间的行动" + 被过滤项折叠列表）。

**持久化**：引擎上下文存 `expo-secure-store`（已装；与 owner-token 同平台矩阵模式），key `engine-context`，JSON blob。不建 settings 表（schema 无此表，且加表会动同步面 — 明确不做）。

### 4.2 Inbox 屏（重写）

- 顶部捕获输入：单行 TextInput + `[记录]`（Enter 亦可）→ `addInboxItem`；**无分类、无必填**（Proposal §5.1 低摩擦原则）；保存后清空输入。
- 列表（oldest first，沿用现有 order）：卡片 = 标题 + 捕获日期；点击 → `router.push(/clarify/{id})`；卡片右侧小垃圾桶 → `trashInboxItem`（内联确认，不弹长文案）。
- 澄清完成后向导路由 `back()` 回 Inbox，watch query 自动刷新（项消失）。

### 4.3 Clarify / Reclarify 向导（新）

**共享纯状态机** `apps/mobile/lib/clarify-flow.ts`（reducer，纯函数，单测覆盖）：

```ts
type WizardState =
  | { step: 'q1' }                                  // 可以行动吗？
  | { step: 'q1b' }                                 // 否 → 资料/有空再说/删除（3 选 1）
  | { step: 'q2' }                                  // 需要多个步骤？
  | { step: 'q3' }                                  // 约 2 分钟能完成？
  | { step: 'q3b' }                                 // 是 → 现在就做掉？
  | { step: 'q4' }                                  // 应该由我完成？
  | { step: 'q5' }                                  // 必须固定日期/时间？
  | { step: 'form'; form: FormKind }                // 落到对应 outcome 的补全表单
  | { step: 'done'; result: ClarifyResult };
type FormKind = 'reference' | 'someday' | 'trash' | 'project' | 'waiting' | 'calendar' | 'action';
```

- 每一步 = 一屏一个问题（2 个大按钮）+ 可选补全字段；回退走系统返回（reducer 只前进，返回即上一态）。
- **表单字段**（`ClarifyTarget` 的必填/可选口径，`requireEstMinutes` 等校验在 db 层已有，向导层先拦一道给出中文提示）：
  - reference：url（必填）+ note（可选）
  - someday：note（可选）
  - trash：确认
  - project：projectTitle（默认 inbox 标题）、projectOutcome（必填）、projectValue（1–5，默认 3）、actionTitle（默认 inbox 标题）、estMinutes（必填，quick chips 5/10/20/30/60/120 + 自定义）
  - waiting：waitingOn（必填「在等谁/什么」）、expectedBy（可选日期）
  - calendar：startsAt（必填，日期+时间两个选择器）、estMinutes（必填）、value（默认 3）、deadline（可选）
  - action（clarified 与 two-minute 共用）：estMinutes（必填；two-minute 路径默认 2）、value（默认 3）、deadline（可选）
- **v1 不问**：contextIds（空 = 处处可执行）、window*（时间窗口留给后续任务）、category、dueDate、dependsOnId。引擎对空 context 的匹配语义已定义（actions 空 contextIds 匹配任何场景）。
- 提交：`applyClarify(db, { inboxId, answers, target, now })` / `reclarifyAction(db, { actionKind, actionId, answers, target, now })` — 单事务，成功 → `done` 步（显示"已整理为 X"摘要）→ 自动返回。
- reclarify 路由从 `q2` 起步（`ReclarifyAnswers` 无 Q1 字段）；do-now 分支沿用 core 语义（当场做完 → 完成事务）。

### 4.4 Projects 屏 + 详情（重写 + 新）

- 列表：既有数据（title/outcome/value/coverage tag，tag 文案中文化）；顶部 `[＋ 新项目]` → 屏内表单（title + outcome + value 1–5）→ `addProject`。
- 详情 `projects/[id].tsx`：
  - 头部：title、outcome、value tag、status tag；
  - 名下 open actions：`listNextActions()` **客户端过滤 `projectId`**（个人规模数据量；db 不加 projectId 过滤参数 — 保持 db 增量最小）；每行：标题 + est + `[完成]`（completeAction）`[稍后]`（snooze sheet）`[删除]`（trashAction）；
  - `[＋ 添加行动]` 内联表单：title + estMinutes（chips）+ value + deadline（可选）→ `addNextAction`（携带 projectId）；
  - 项目状态不在此屏编辑（状态决策集中在周回顾 — 与决策 2 一致）。

### 4.5 Review 屏 + daily/weekly（重写 + 新）

- Review tab：两张入口卡（`[今日回顾]` `[本周回顾]`）+ 历史记录列表（既有 `listReviewRecords`，kind tag + 日期）。
- **daily.tsx** 流程：
  1. 进屏拉 `buildDailyReviewSnapshot(db, now)`；
  2. 快照展示区（只读数字/列表）；
  3. 交互区：
     - 未完成行动列表（`stillOpen`）：每行复选框 + 日期选择 → 重新排期；`[已完成]` 快捷勾选；
     - 「明日必做」：从未完成中勾选 → 明天 08:00；
     - 反复跳过（`repeatedSkips`）：只读列表（点进 reclarify 可选）；
     - inboxCount / 待跟进 / 今日明日日程：只读摘要；
  4. 提交：先按顺序落地事务（rescheduled → `snoozeAction(snoozedUntil = toDate 08:00 本地)`；completed → `completeAction`；tomorrowMustDo → `snoozeAction(明天 08:00)`），最后 `addReviewRecord`（snapshot + answers 全量，append-only）。任一步失败 → 停在该步并提示，不写记录（避免"记录了但没执行"）。
- **weekly.tsx** 流程：
  1. `buildWeeklyReviewSnapshot`；
  2. 展示：inboxCount、项目表（title + hasOpenAction + lastProgressAt）、waitingFollowUps、somedayCount、stalledProjects、calendarNext7；
  3. 决策区：
     - inboxCleared / calendarReasonable：确认开关（初值由 snapshot 推导：inboxCount === 0 / 无过期项）；
     - followUpsRaised：waitingFollowUps 复选（勾选 = 已跟进，仅记录）；
     - projectDecisions：每项目一个状态选择（active/on-hold/done/dropped，默认当前）；
     - somedayDecisions：进屏拉 `listSomedayMaybeItems` 列出条目，每条 保留/删除（**v1 不做 →项目/→行动** — 决策 2）；
  4. 提交：落地（projectDecisions 变更项 → `updateProject(status)`；someday trash 项 → `trashSomedayMaybeItem`），最后 `addReviewRecord`。顺序同 daily：变更先、记录后。

### 4.6 专注计时屏（新，决策 1）

路由 `focus/[id].tsx?kind=next|habit|calendar`：

1. **选时长**：`[25] [45] [60] [自由计时]`（preset ∈ {25,45,60} 为 core 常量 `FOCUS_PRESET_MINUTES`，不可自造）→ `startFocusSession` → 计时中。
2. **计时中**：行动标题 + 剩余时间（free 为正计时）+ `[暂停]`/`[继续]` + `[完成]` + `[放弃]`。
   - 剩余时间 = f(startedAt, plannedMinutes, pausedSec, displayNow) — **纯函数** `lib/focus-timer.ts`，单测。
   - 显示用屏内 1s interval（displayNow 仅用于渲染）；**所有 db 变更的 `now` 仍取 `useAppClock`**（hook-guidelines Rule 4：分钟级 `now` 对 25 分钟会话精度足够；屏内 1s tick 是渲染例外，不传给引擎/事务）。
   - 暂停：记录 pauseStart（屏内 state）；继续：`recordPause({ sessionId, pausedSec: 绝对累计, now })`（db 函数契约：绝对值回写）。
   - 倒计时归零：横幅「时间到」+ `[完成]` `[继续]`（会话保持 active，不自动结束）。
3. **完成**：`completeFocusSession` → `completeAction({ actionKind, actionId })`（完成事务：CompletionRecord + 习惯日推进 — db 内完成）→ 返回 Now 屏（推荐自动换下一条）。
4. **放弃**：`abandonFocusSession`（不动 action — db 契约）→ 返回。
5. 屏被系统回收再进入：按 `listFocusSessions` 中该 action 的 active 会话恢复（startedAt/pausedSec 在行里）；无 active 会话 → 回到选时长步。

### 4.7 snooze 选项（Now 屏 + 项目详情共用）

`lib/snooze-options.ts`（纯函数，入参 `now`）：`[10 分钟后, 30 分钟后, 今晚 20:00, 明天 08:00]`；今晚 20:00 已过则替换为「明晚 20:00」。本地时间计算用 `@nextdo/core` 的 time 助手（device-local）。

---

## 5. 状态管理

- **无新增全局状态**（state-management 规范：Zustand 仅限已界定场景）。
- 引擎上下文：secure-store + `useEngineContextSettings`（读一次缓存内存，写时穿透）。
- 向导/表单：屏内 `useState`/reducer（向导 = 纯 reducer）。
- 所有列表：`@powersync/react` watch query hooks（既有模式，`watch-queries.ts` 已提供 inbox/projects/pool/reviews；habits/waiting/someday/calendar 列表屏内自建轻量 watch query 或按钮触发查询 — 实现时按数据量选，个人规模可接受查询式）。

## 6. packages/ui 增量

按 component-guidelines 新增（仅当现有 4 组件不够时）：`Checkbox`（回顾勾选）、`Sheet`（snooze 选择，可用 RN 内置 Modal 实现，不引依赖）、`NumberChips`（est/value 快捷选择，Button 组合亦可 — 实现时优先组合现有组件，能不加就不加）。

## 7. 文案

全界面中文（tab 标题、空态、按钮、表单标签、错误提示）。引擎 reason 文案在 `reason-labels.ts` 统一维护（中文化）。错误提示透出 typed NextdoError 的中文映射（lib 层一张 code → 中文表）。

## 8. 取舍记录

| 决策 | 理由 | 代价 |
|------|------|------|
| 项目 action 客户端过滤，db 不加 projectId 参数 | db 增量最小（PRD：复用既有查询）；个人规模数据量 | 数据量极大时低效（v1 不关心） |
| 引擎上下文存 secure-store 而非新 settings 表 | schema/同步面零改动 | 引擎偏好不参与多设备同步（v1 单机体验可接受；后续任务可加 settings 表） |
| 向导 v1 不问 context/window/category | 空 contextIds = 处处可执行（引擎已定义）；减少首版表单负担 | 依赖 context 过滤的行动只能靠后续编辑补 |
| 周回顾决策先落地、记录后写，失败不落记录 | 避免"记录了但没执行"的假账 | 多步事务无跨语句原子性（PowerSync 本地单库，实际风险低） |
| 专注屏 1s tick 只用于显示 | hook-guidelines Rule 4 的 `now` 纪律不破 | 显示秒与提交秒最多差 1s/60s，无实际影响 |
| 回顾 snapshot 放 packages/db 而非 app | 组合多表查询 + 日期口径集中在 db 层，可用既有 harness 单测 | db 包新增 3 个导出函数 |

## 9. 回滚

- 无 schema / sync-config / server 改动 → 无迁移、无数据修复面。
- 全部代码改动为新增路由 + 屏重写 + db additive 导出；回滚 = revert 对应 commit。
- db 新函数为纯只读，回滚不影响既有数据。
