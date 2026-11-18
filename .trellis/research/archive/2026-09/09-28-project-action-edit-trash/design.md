# Design — 项目与行动的编辑/归档操作

> 对应 prd.md（R1–R6，D1–D3）。层边界：db 一处过滤 + mobile 两个新 hook + 项目详情屏改造；core / server / schema 零改动。

## 1. 架构与边界

| 层 | 改动 | 说明 |
|----|------|------|
| `packages/db` | `queryEnginePool`（`src/queries/pool.ts`）+ 测试 | R5：池子加项目状态过滤；**无新 db 函数**（`updateProject`/`updateNextAction` 已存在） |
| `packages/core` | 无 | 引擎纯函数不动；过滤属池子契约，由 db 层执行 |
| `apps/mobile` | 2 个新 hook + `projects/[id].tsx` + 测试 | R1–R4、R6 |
| `server` / schema | 无 | 无新表/列，无迁移，同步链路零改动 |
| spec（Phase 3.3） | `domain/next-action-engine.md` 池子契约 + app 层项目状态入口说明 | 见 §5 |

## 2. R5 — 池子过滤（唯一的语义变化）

**契约**（将写入 `next-action-engine.md` "Pool contract"）：

> `next_actions` 行若 `project_id` 指向**非 active**（或已删除/不存在）的项目，不是候选。无项目行动不受影响；`calendar_actions`（v1 无 `projectId`）与今日 `habit_days` 不受影响。

**实现**（`queryEnginePool`，`pool.ts`）：

- 函数尾部本就加载 `projectRows`（非删除项目，select id/value/status）供引擎 `projects` 输出 —— 复用同一批行构建 `activeProjectIds: Set<string>`（`status === 'active'` 的行）。
- 第 1 段（Open NextActions）循环里加一条：`row.project_id !== null && !activeProjectIds.has(row.project_id)` → 跳过。
- `projects` 输出保持现状（全部非删除项目，含非 active）—— rank 层 `project-importance` 只对 active 加成的既有行为与测试不受影响。

**边界情况**：

- 项目已软删除 → 不在 `projectRows` → 该项目的行动被排除（当前 UI 不可达，防御性一致）。
- 项目 done/dropped（周回顾设置）→ 同样排除（prd "Design Defaults"，用户已知悉）。
- 恢复项目（on-hold → active）→ 行动自动回池，**零数据搬移**（纯派生）。
- `poolWatchQuery` 的 union 已含 projects 表 → 项目状态变化自动触发 Now 屏重算，订阅不改。

**测试**（`packages/db/src/test/queries.pool.test.ts` 新增用例）：

1. active 项目的 open 行动进池（既有行为回归）
2. on-hold 项目的 open 行动不进池
3. done / dropped 项目的 open 行动不进池
4. 无项目（project_id = null）的行动不受任何项目状态影响
5. CalendarAction 与 HabitDay 不受项目状态影响（回归）

## 3. mobile UI（`apps/mobile/app/projects/[id].tsx`）

### 3.1 头部卡（项目元信息）

- active：状态 Tag「进行中」+ 按钮 [编辑] [归档]
- on-hold：状态 Tag「搁置」+ 按钮 [编辑] [恢复]
- done / dropped（终态）：状态 Tag，**无** 编辑/状态按钮（审计态）
- 归档/恢复 = `status` 单字段更新，无确认弹窗（可逆）

### 3.2 新 hooks（hook-guidelines：hook 拥有 mutation，查询在 packages/db）

- `hooks/use-update-project.ts`：`update({ project, patch: { title?, outcome?, value?, status? } })` → 整行 `{ ...project, ...patch, updatedAt: toIso(now) }` 交给 `updateProject`（状态机 assert 在 db 层）。now 取自 `useAppClock`（单一时钟）。
- `hooks/use-update-next-action.ts`：`update({ action, patch: { title?, estMinutes?, value?, deadline? } })` → `updateNextAction`（title/est 变化重置 `consecutiveSkips` 是 db 层既有行为）。
- 周回顾的 `use-project-status.ts` **不动**（避免波及 review 测试）。

### 3.3 编辑表单（内联 Card，沿用 `AddActionForm` 模式）

- `EditProjectForm`：标题（TextInput）/ 结果（TextInput）/ 价值（1–5 chips，预填）；空标题或空结果不可提交；保存 → `useUpdateProject`；成功后关闭并刷新（watch 查询自刷新，`reload` 兜底）。
- `EditActionForm`：标题 / 预估时长（chips + 自定义，预填）/ 价值 chips / 截止（YYYY-MM-DD，`endOfLocalDayIso` 组 23:59:59，与 `AddActionForm` 同一约定）；同一屏同一时刻只开一个（`editingActionId: string | null`）。
- 行动行按钮排布：[完成] [稍后] [编辑] [删除]（编辑为 ghost 变体）。
- on-hold 项目详情内行动操作不变（R6：完成/稍后/删除/编辑照常）。

### 3.4 屏幕头部注释

更新 `projects/[id].tsx` 顶部 docblock 与 `projects.tsx`（如有必要）：原 "Project STATUS is not editable here" 注释作废，改为"active↔on-hold 在详情可切换；done/dropped 仍由周回顾决策"（修订 app-ui design §4.4 的声明）。

## 4. 数据流

```
编辑项目/行动:  表单 → useUpdateProject/NextAction → updateProject/NextAction(db, 整行)
                → PowerSync 本地 SQLite → 后台 upload（既有同步，不改）
归档/恢复:      按钮 → useUpdateProject({status}) → assertTransition(PROJECT_TRANSITIONS) → 写行
Now 屏联动:     project 行变化 → poolWatchQuery 失效 → useActionPool 重算 → 行动进/出池（R5）
```

## 5. Spec 更新（Phase 3.3 清单）

1. `domain/next-action-engine.md` "Pool contract"：加 R5 条款（§2 契约原文）。
2. `domain/domain-model.md` Project 节：补一句"详情屏支持 active↔on-hold 快捷切换（本项目 09-28 任务引入）；done/dropped 终态仍只经周回顾"。
3. `app/`（index 或 component/hook guidelines 就近处）：记录"项目状态 UI 入口"修订 + `useUpdateProject`/`useUpdateNextAction` 钩子先例。

## 6. 兼容 / 回滚

- 无 schema 迁移、无新表、无 server 改动 → 多设备同步零风险（旧版本客户端读到新状态值：`on-hold` 早已被"已归档"筛选支持）。
- 回滚 =  revert 本任务提交；池子过滤去掉后行为退回现状（on-hold 项目行动重新进 Now）。
- 已知副作用（prd Risks）：done/dropped 项目的遗留 open 行动不再进 Now；归档项目的 snooze Reminder 仍会触发。
