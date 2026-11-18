# Design — Habit start date picker (issue #13)

## 1. 边界

```
apps/mobile/app/habits.tsx          起始日期 + 时间窗口 两个选择器入口（纯展示）
        │  startDate: "YYYY-MM-DD"
        ▼
apps/mobile/hooks/use-start-habit.ts startDate → startedAt（本地零点），其余字段不变
        ▼
packages/db/src/queries/habits.ts   seedHabitDays()：起始日 → 今天 的幂等补播种
        ▲
packages/core/src/domain/habit-start.ts  纯校验：起始日期是否落在可用范围
```

依赖方向不变（app → core/db，db → core）。`packages/core` 不引入任何新依赖。

## 2. 起始日期的取值规则（纯函数，core）

新文件 `packages/core/src/domain/habit-start.ts`：

```ts
export type HabitStartDateProblem = 'invalid' | 'past';

export type HabitStartDateCheck =
  | { ok: true }
  | { ok: false; problem: HabitStartDateProblem };

export function habitStartFloor(now: Date): string;   // 'YYYY-MM-DD' of today

export function checkHabitStartDate(dateKey: string, now: Date): HabitStartDateCheck;

export function habitStartDateAt(dateKey: string, now: Date): Date | null;
```

- 输入是 `'YYYY-MM-DD'` 设备本地日历日，与 `DateTimePicker` 的 `date` 模式契约一致（**不是** core 那个返回 `YYYYMMDD` 的 `localDateKey`——两套格式两个函数，不要混用）。
- `invalid`：正则不匹配，或日历上不存在的日期（`2026-02-30`）。
- `past`：早于 `habitStartFloor(now)`。**没有上界**——挑战可以预约到任意远的将来，所以 `cycleDays` 不再参与规则，函数签名里也没有它。
- 日历加减走 `new Date(y, m, d, 12)` 的正午锚定写法，与 `habitCycleDay` 同源，避免夏令时/时区跨日漂移。
- 纯函数，无 `Date.now()`，`now` 注入。

## 3. `startedAt` 的写入

`use-start-habit.ts` 新增可选参数 `startDate?: string`（`"YYYY-MM-DD"`）。
写入时取该日本地零点：

```ts
const [y, m, d] = startDate.split('-').map(Number);
const startedAt = new Date(y, m - 1, d, 0, 0, 0, 0);
```

- 缺省（未传）时保持现状：`startedAt = nowIso`。
- 字段类型仍是 `string`（ISO），schema / sync 配置 / 服务端表结构一律不动。

## 4. 铺满整个周期 `seedHabitDays`

`packages/db/src/queries/habits.ts`：把 `seedTodayHabitDay` 换成 `seedHabitDays`。

```
seedHabitDays(tx, habit, now): HabitDay | null   // 返回今天那一行，或 null
```

1. 从 `habit.startedAt` 的本地日历日起逐天推进 **`cycleDays` 天**（起始日 → 起始日 + `cycleDays − 1`），**不是**推进到今天。
2. 每天都过原有的两道闸：`windowDays` 掩码、`habitCycleDay(...) !== null`。
3. 逐天按确定性 id `habitDayId(habitId, localDateKey)` 先查后插 —— 已存在就跳过，保持幂等（离线多设备重复生成不会产生重复行）。
4. 返回今天那一行；今天还没到（或被掩码挡掉）时返回 `null`。
5. 整个周期都已过去时直接返回 `null`，一行不写 —— 那些行永远只会读成 `missed`。起始日规则保证应用不会创建这种习惯，但别的客户端同步过来的行可能是这个状态。

`startHabit` / `updateHabit`（`broken → active` 重启）两处调用点都换成它。重启时 `startedAt` 已更新为当下，循环自然只跑一天，行为与改动前一致。

`startHabit` 的返回类型 `{ habit, today }` **不变**，但 `today === null` 的含义变了：**从「播种失败」变成「挑战还没开始」**。`use-start-habit.ts` 里原来把它当成错误并弹「习惯已创建，但今天的挑战日没有生成」，那段必须删掉。

## 5. 为什么允许未来、但不允许过去起始日期

HabitDay 的生成只发生在两个时刻：`startHabit` 和 `updateHabit` 的挑战重启。应用没有跨天补种任务（`queryEnginePool` 只读 `habit_days`，不写）。这条约束决定了两个方向：

- **未来可以**：既然没有补种任务，那就**在创建时把整个周期铺满**，起始日之后的每一天在那天到来时就已经在等着。推荐池按 `local_date = today` 过滤，起始日之前的挑战日不会泄漏成推荐；项目详情页的格子也已经有 `future`（未到）状态。
- **过去不行**：播种只发生在创建那一刻。补记一个已经过去的日子，等于凭空造出用户没能完成的挑战日，`missed` 会立刻堆上去，而且没有机制能把它变成 `done`。所以过去一律拒绝。

代价：起始日在未来时，习惯在列表里没有「第 N/21 天」可显示（`habitCycleDay` 对今天返回 `null`）。这是诚实的结果，界面改为显示「N 天后开始」。

## 6. UI

`HabitForm` 新增两个只读回显行 + 选择按钮，沿用 `projects/[id].tsx` 里既有的 `DateTimePicker` 接线方式（`showPicker` state + 条件渲染）：

- **起始日期**：`value = startDate`，`mode="date"`，标题「选择起始日期」。回显读作「今天 · 挑战第 1 天」，未来的日期读作「10月20日 · 9 天后开始」——挑战还没开始时没有挑战日可显示，倒计时才是用户要看的信息。
- **时间窗口两半**：`value = windowStart | windowEnd`，`mode="time"`，标题「选择开始时间」/「选择结束时间」。回显 `HH:mm` 或占位文案。

校验沿用 10-02 的「render 里纯计算驱动 `disabled`」模式：

```ts
const startCheck = checkHabitStartDate(startDate, now);
const canSubmit = ... && startCheck.ok && windowValid && !submitting;
```

`startCheck` 非 ok 时把 `problem` 映射成中文提示，显示在表单里。

表单 reset 后 `startDate` 回到 `localDateKey(now)`。

## 7. 兼容性

- schema、PowerSync sync 规则、服务端 DDL **零改动** —— 没有新列。
- 已有习惯的 `startedAt` 语义不变（本来就在其创建日），`habitCycleDay` 结果不变。它们当年创建时的播种窗口是「起始日 → 今天」，本次改动后这些行不再被重新生成（`updateHabit` 只在 `broken → active` 时才重播种），所以历史数据不受影响。
- `use-habits.ts` / `use-project-habits.ts` 的 `cycleDay` 在起始日之前是 `null`（今天不在周期内），这是既有行为；新增的 `startsInDays` 字段专门用来渲染倒计时，`cycleDay` / `doneCount` 的算法不变。
- `use-project-habits.ts` 的网格日期原本是 `start + d * 86_400_000`，跨夏令时的那一天会滑到相邻日期。改用正午锚定的日历步进，与 `habitCycleDay` 同源 —— 未来起始日让这个格子更常被看到，顺手修掉。

## 8. 测试

| 位置 | 覆盖 |
|---|---|
| `packages/core/src/domain/habit-start.test.ts` | 今天（边界）/ 昨天 / 很久以前 / 明天 / 很远将来 / 非法日历日 的正反例；`habitStartFloor` 忽略时分；同输入两次结果相同；跨午夜同一个 key 会翻面 |
| `packages/core/src/lib/time.test.ts` | `daysBetweenDateKeys`：同一天 0、正负 1、跨月跨年跨闰日 |
| `packages/db/src/test/queries.habits.test.ts` | 起始日在 3 天后 → 播种 21 行且 `today === null`；起始日=今天 → `today` 有值且仍播种 21 行；整个周期都在过去 → 一行不写；重启不重复；`windowDays` 掩码覆盖到未来的日子 |
| `apps/mobile/__tests__/habits-screen.test.tsx` | 未来起始日期回显「N 天后开始」且能提交、`startedAt` 是所选日期本地零点、习惯进列表；过去起始日期（−1 天和 −21 天）提交禁用并给出提示 |