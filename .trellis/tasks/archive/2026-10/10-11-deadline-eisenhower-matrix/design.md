# Design — Deadlines + Eisenhower ordering (issue #16)

## 0. 现状盘点（决定了范围）

动手前先核实了「已经有什么」，避免重复造：

| 能力 | 现状 |
| --- | --- |
| `next_actions.deadline` 列 | **已有**（`packages/db/src/schema.ts`，ISO datetime） |
| `next_actions.due_date` 列 | **已有**（ISO date，soft） |
| `calendar_actions.deadline` 列 | **已有** |
| `deadline-urgency` 打分信号 | **已有**（`rank.ts`，权重 1.0，最高） |
| 行动创建/编辑时设置截止 | **已有**（澄清向导 + 项目详情内联表单，都用 `DateTimePicker`） |
| `projects.deadline` 列 | **没有** ← 本任务新增 |
| 项目设置/编辑/清除截止 | **没有** ← 本任务新增 |
| 截止时间的状态分类（未到期/临近/逾期） | **没有** ← 本任务新增 |
| 四象限排序 | **没有** ← 本任务新增 |
| 列表里的逾期/临近视觉提示 | **没有** ← 本任务新增 |
| 项目详情展示截止 | **没有** ← 本任务新增 |

所以本任务**不是**「加截止时间」，而是「补上项目侧 + 把已有的截止时间变成用户看得见的状态 + 加四象限排序」。

## 1. 边界

```
packages/core/src/domain/deadline.ts     纯函数：截止时间 → 状态 + 文案
packages/core/src/engine/quadrant.ts     纯函数：候选行动 → 四象限
        ▲
packages/core/src/engine/recommend.ts    排序：象限优先，score 次之
        │
        ▼
packages/db/src/schema.ts                projects.deadline 新列
packages/db/src/queries/projects.ts      项目读写带上 deadline
        │
        ▼
apps/mobile/app/(tabs)/projects.tsx     项目列表显示截止状态
apps/mobile/app/projects/[id].tsx       项目表单 / 详情显示截止；行动表单改纯选择器
```

依赖方向不变。`packages/core` 不引入新依赖，不碰 DB。

## 2. 截止时间状态（纯函数，core）

新文件 `packages/core/src/domain/deadline.ts`：

```ts
export type DeadlineStatus = 'none' | 'overdue' | 'soon' | 'upcoming';

/** 「临近」的阈值：截止前 48 小时内算临近。 */
export const DEADLINE_SOON_HOURS = 48;

export function deadlineStatus(
  deadline: string | null | undefined,
  now: Date,
): DeadlineStatus;

export function formatDeadline(
  deadline: string | null | undefined,
  now: Date,
): string;      // 'none' → ''，其余给中文短标签
```

判定（`deadline` 缺失或解析失败一律 `none`，不抛）：

- `overdue`：`deadline < now`
- `soon`：距今 ≤ `DEADLINE_SOON_HOURS`
- `upcoming`：其余

**为什么阈值是 48 小时**：现有 `rank.ts` 的 `deadline-urgency` 分档是 24h / 72h / 168h，48 小时落在第一、二档之间，是个保守取值——早于 24h 的窗口留给「今天就到期」，48–72h 留给「这两天要安排」。这个常量是**唯一**的阈值来源，`rank.ts` 的分档和 UI 的文案都从它派生，不允许各写各的。

`formatDeadline` 的文案：

- `overdue` → `已逾期 2 天`
- `soon` → `今天截止` / `明天截止` / `还剩 1 天`
- `upcoming` → `10月20日 截止`

日历加减一律走 `new Date(y, m, d, 12)` 正午锚定，与 `habitCycleDay` 同源。

## 3. 四象限（纯函数，core）

新文件 `packages/core/src/engine/quadrant.ts`：

```ts
export type Quadrant =
  | 'important-urgent'   // 重要且紧急
  | 'urgent'             // 不重要但紧急
  | 'important'          // 重要但不紧急
  | 'neither';           // 不重要且不紧急

/** PRD 的优先顺序，索引即排序权重（小的在前）。 */
export const QUADRANT_ORDER: readonly Quadrant[] = [
  'important-urgent',
  'urgent',
  'important',
  'neither',
];

export function quadrantOf(candidate: CandidateAction, input: EngineInput): Quadrant;
```

判定：

- **重要**：`candidate.value >= 3`。
  这个阈值不是新发明的——`rank.ts` 里筛「可信理由」时已经用 `value >= 3` 当「高价值」，两处必须一致，否则会出现「象限说它不重要、理由说它价值高」的自相矛盾。
- **紧急**：`deadlineStatus(candidate.deadline ?? candidate.dueDate, now)` 是 `overdue` 或 `soon`。

**没有截止时间 = 不紧急**。这不是缺陷而是四象限的本意：没有时间压力的事就是「重要但不紧急」，该排进计划而不是抢占当下。

## 4. 排序：象限优先，score 次之

`recommend.ts` 的 `compareEntries` 改成三级：

1. `QUADRANT_ORDER.indexOf(quadrant)` 升序
2. `score` 降序（现有）
3. 现有 tie-break（deadline 升序 nulls last、estMinutes 升序、id）——一行不动

**这是一个真实的排序语义变化**，不是加个权重：`deadline-urgency` 原本只是 1.0 权重的一条信号，一个「重要不紧急、价值 5、等待 14 天」的旧行动仍可能压过一个「不重要但今天截止」的行动。改成象限优先后，后者一定排前面。这是 issue 要的行为，但会让部分现有推荐顺序变化，所以单测要显式覆盖。

**只改 `recommend()` 的排序，不改 `scoreCandidate()` 的公式**——`score` 仍然是对「同一象限内谁更值得做」的度量，象限是「先做哪一类」的度量。两者职责不重叠，分开才可解释（「为什么是它」面板继续展示 score reasons，不用改文案）。

## 5. Schema：`projects.deadline`

`packages/db/src/schema.ts` 的 `projects` 表加一列：

```ts
/** ISO datetime (exact moment). Nullable — a project may have no deadline. */
deadline: column.text,
```

加这一列要同步改**四处**，这是项目定义的「一个变更单元」（`app/database-guidelines.md` §Schema changes）：

1. `packages/db/src/schema.ts` — 客户端表定义
2. `server/app/src/db.ts` — `MUTABLE_TABLES.projects` 列表
3. `server/powersync/sync-config.yaml` — `projects` 那条 stream SELECT 的列清单
4. `server/powersync/init/02-nextdo-schema.sql` — Postgres DDL

**兼容性**：列可空，没有既有行需要回填；客户端和服务端都是「列存在即同步」，老客户端不写该列时按 NULL 处理。无需数据迁移脚本，也不需要 `deleted_at` 之外的兼容分支。

`projects.deadline` 用 **ISO datetime**（与 `next_actions.deadline` 一致），不用 date——`rank.ts` 的 `deadline-urgency` 算的是精确小时差，两边格式混用会让同一个截止时间在两个地方读出不同的紧迫度。

## 6. UI

### 6.1 共用的截止状态标签

新建 `apps/mobile/components/deadline-chip.tsx`：`deadlineStatus` → `Tag`，tone 映射

| status | tone | 文案 |
| --- | --- | --- |
| `none` | 不渲染 | — |
| `overdue` | `danger` | 已逾期 N 天 |
| `soon` | `warning` | 今天截止 / 还剩 N 天 |
| `upcoming` | `neutral` | M月D日 截止 |

列表和详情都用它，保证同一个截止时间在任何页面读起来一样。

### 6.2 项目表单（创建 + 编辑）

`apps/mobile/app/(tabs)/projects.tsx` 与 `projects/[id].tsx` 的 `EditProjectForm` 各加一个「截止」字段，
用 `habits.tsx` 里那套 `PickerField`（只读回显 + 「选择」角标）——**不是**文本框。
这条是 10-11-habit-start-date-picker 刚写进 `app/component-guidelines.md` 的规则：
选择器已经拥有的值再给一个文本框是缺陷。

`PickerField` 目前是 `habits.tsx` 的私有组件。这次有两个新调用点，顺手上提到
`apps/mobile/components/picker-field.tsx`，`habits.tsx` 改为引用。纯搬迁，不改行为。

「清除」用一个「清除」按钮置空——`DateTimePicker` 只有确定/取消，表单层负责提供清除入口。

### 6.3 项目详情内联的行动表单

`projects/[id].tsx` 的 `AddActionForm` / `EditActionForm` 现在是「文本框 + 选择日期按钮」的混合体
（`TextInput` + `DateTimePicker` 并排）。按 §6.2 的规则改成纯 `PickerField`，行为不变。

### 6.4 展示

- `projects/[id].tsx` 项目头部：`DeadlineChip`
- `(tabs)/projects.tsx` 项目列表行：`DeadlineChip`
- 项目详情下的行动列表：每行一个 `DeadlineChip`（行动本来就能设截止，只是没显示过）

## 7. 测试

| 层 | 覆盖 |
| --- | --- |
| `core/src/domain/deadline.test.ts` | 四个状态的边界（恰好 now、恰好 48h、48h+1s）、空/非法输入 → `none`、跨月跨年文案 |
| `core/src/engine/quadrant.test.ts` | 四象限各一例；`value=2` + 逾期 → `urgent`；`value=3` 无截止 → `important` |
| `core/src/engine/recommend.test.ts` | **象限压过 score**：一个低分但今天截止的行动排在高分但无截止的行动之前；同象限内仍按 score 排 |
| `db/src/test/queries.projects.test.ts` | 项目 deadline 写入/读回/清除；老行（NULL）不受影响 |
| `apps/mobile/__tests__/` | `DeadlineChip` 四种 tone；项目表单渲染选择器而非文本框 |

## 8. 回滚点

- §5（schema）与 §2–4（core 纯函数 + 排序）、§6（UI）互相独立，可单独回退。
- 唯一有持久化后果的是 §5：加了列。回退代码不会删列，但列可空、不参与任何逻辑，留着无害。

## 9. 不要做的事

- 不改 `scoreCandidate()` 的权重公式（见 §4）。
- 不动 `calendar_actions`（它的 `deadline` 已有，不在本 issue 范围）。
- 不引入迁移框架——这个项目的 schema 演进靠「可空列 + 四处同步」。
- 不给行动列表引入新的排序入口；四象限只作用于推荐池。