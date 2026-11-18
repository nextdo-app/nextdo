# 设计：习惯归属项目

## 1. 边界与数据流

```text
写：项目详情页 HabitForm
      → useStartHabit（新增可选 projectId）
      → packages/db startHabit 事务（插入 Habit + 播种今日 HabitDay）
      → 本地 SQLite → 后台同步

读：项目详情页
      → useProjectHabits（新增，client-side projectId 过滤，对齐 useProjectActions）
      → listHabits + listHabitDays → 挑战进度 + 当前周期打卡格

引擎：queryEnginePool
      → HabitDay 的父习惯带 project_id
      → candidate.projectId = 父习惯的 project_id
      → 复用已有的 activeProjectIds 做 R5 过滤
```

新增依赖：零。`project_id` 走既有 habits 表，不引新表、不引新包。

## 2. 为什么是「加 project_id」而不是「合表」

「习惯是特殊的项目」这个洞察成立在用户层：两者都有 `title` / `value` / 生命周期状态 / 都会生成行动。但落到数据层，两者当前承担的是**两套不同的状态机**：

| | Project | Habit |
|---|---|---|
| 终态判定 | 每周回顾驱动（`done` / `dropped` 是终态） | 周期自动推进（`active → completed → broken → active`） |
| 装的行动 | 用户手打的 `NextAction` | 机器生成的 `HabitDay`（确定性 id，离线多端幂等） |
| 覆盖度 | `projectActionCoverage()` 数 `next_actions` | 不参与覆盖度计算 |

合表意味着每周回顾要多出一套它现在没有的 done 语义，习惯周期逻辑要背上它不需要的项目语义。收益是一张更宽的表，代价是两套语义互相污染。所以本次只借「项目归属」这一个维度——它是 `NextAction` 早就有的字段（`next_actions.project_id`），照抄即可，不引入新的概念。

## 3. schema 变更单元（四处必须同步）

`database-guidelines.md` 明确：A schema change = one change unit，涉及 `schema.ts` + `server/powersync/` stream + （有 DDL 时）Postgres。本任务具体是：

| 位置 | 改动 |
|---|---|
| `packages/db/src/schema.ts` | `habits` 表加 `project_id: column.text`；`habitFromRow` / `habitToRow` 映射 `project_id` ↔ `projectId` |
| `packages/core/src/domain/types.ts` | `Habit` 加 `projectId?: string` |
| `server/app/src/db.ts` | `MUTABLE_TABLES.habits` 数组加入 `'project_id'` |
| `server/app/test/upload.test.ts` | `EXPECTED_CLIENT_SCHEMA.habits` 同步（不一致会红） |
| `server/powersync/init/02-nextdo-schema.sql` | `CREATE TABLE habits` 加 `project_id TEXT` |
| `server/powersync/sync-config.yaml` | habits 的 SELECT 列表加 `project_id` |

**向后兼容性**：新列可空，旧客户端（不声明该列）读写 habits 行不受影响；旧客户端**上传**的 habits 行在新客户端读出来是 `projectId === undefined`，与今天行为一致。同步流 SELECT 列表变化需要按官方 Postgres schema-change 流程重新部署 stream（database-guidelines.md 已记录该约束）。

## 4. 引擎：R5 规则对习惯生效

`queryEnginePool` 已经在第 1 步加载了 `projects` 并算出 `activeProjectIds`，第 2 步处理 HabitDay 时也已把父习惯整行读进 `habitById`。因此改动是两行：

1. `baseFromRow({ ...day, ... , project_id: habit.project_id ?? null })` —— 让 candidate 带上 `projectId`，`scoreCandidate` 的 `project-importance` 信号随之生效；
2. 在跳过条件里追加 `habit.project_id !== null && !activeProjectIds.has(habit.project_id)` → `continue`。

第 2 条与 NextAction 的 R5 判断逐字同构，复用同一个 `activeProjectIds` 集合，不引入第二套项目有效性判定。

**行为后果（需在 PRD 与测试中钉住）**：项目归档（on-hold）后，它名下习惯的每日行动不再出现在 Now 屏候选池。理由与 NextAction 一致——项目暂停意味着这件事整体暂停。

## 5. 查询层

- `listHabits(db, options?)` 的 `options` 增加 `projectId?: string`：给了就 `.where('project_id', '=', projectId)`，不给则不加条件（现状不变）。
- `startHabit` / `addHabit` 不需要签名变化：`projectId` 由调用方构造的 `Habit` 实体携带，`habitToRow` 负责落列。与 `addNextAction` 携带 `projectId` 是同一档处理，**不在 db 层校验项目存在性**——项目详情页只在项目存在时渲染表单，跨项目引用是同步竞态而非用户可犯的错误。

## 6. UI

新增 hook `useProjectHabits(projectId, now)`，形状对齐 `useProjectActions`（`data` / `error` / `reload`，query-style，创建与打卡后调 `reload`）：读 `listHabits` + `listHabitDays`，client-side 按 `projectId` 过滤，把 day 按 `localDate` 归到各习惯，派生：

- `cycleDay`：`habitCycleDay(habit.startedAt, habit.cycleDays, todayKey)`（从 `packages/db` 复用的同一函数，**不重写周期规则**）；
- 当前周期的 21 个格子：day 落在周期内 → 已完成 / 今日 / 未完成；不在周期内的日期留空。

项目详情页的区块结构：

```text
项目习惯                        ＋ 添加习惯
[习惯名]  第 N/21 天  [21 格打卡条]
今天开放的那一格可点 → completeAction({ actionKind: 'habit', actionId })
（无习惯时）这个项目还没有习惯 —— 点「＋ 添加习惯」建立 21 天挑战。
```

创建表单 `HabitForm` 内嵌在项目详情页，字段为精简版（习惯名 / 每日行动 / 预计分钟 / 价值），`projectId` 隐式携带，`cycleDays=21`、`status='active'` —— 与 `/habits` 页 `useStartHabit` 的固定决策一致，不新增第二套默认值来源。**不复用** `/habits` 页的 `HabitForm` 组件（它住在路由文件里、且带时间窗口开关），而是项目页内一个精简子集：项目语境下的习惯由项目定义节奏，时间窗口属于后续能力。

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 忘记同步服务端目录 / 流 SELECT → 同步静默丢列 | `upload.test.ts` 的目录一致性测试会红；AC-1 显式列出四处 |
| 旧设备上的 Postgres 表无 `project_id` → 上传报错卡住队列 | DDL 为可空 `ALTER`/`CREATE` 语义，部署顺序：先 Postgres DDL，再发新客户端 |
| 项目归档导致习惯打卡行消失，用户以为数据丢了 | 习惯行本身仍在（只是不进池），`/habits` 页仍可见并可打卡；测试钉住这一点 |
| 引擎行为变化未被发现 | `queries.pool.test.ts` 增三条用例：active 项目继承信号、on-hold 不进池、projectless 不变 |

回滚形状：新增列可空，客户端回退到旧版本即可，旧版本忽略未知列。