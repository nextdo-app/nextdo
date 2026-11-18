# 技术设计 — 习惯创建表单与 21 天挑战启动

## 1. 变更面

| 层 | 文件 | 变更 |
|---|---|---|
| db | `packages/db/src/index.ts` | 补导出 `habitCycleDay`（`queries/pool.ts` 里已是 `export function`，只是没从包入口 re-export） |
| hook | `apps/mobile/hooks/use-habits.ts` | 新增，读 `listHabits` + `listHabitDays`，返回习惯 + 每个习惯的「本期已完成天数」 |
| hook | `apps/mobile/hooks/use-start-habit.ts` | 新增 mutation，构造 `Habit` 行并调 `startHabit` |
| hook | `apps/mobile/hooks/use-trash-habit.ts` | 新增 mutation，薄封装 `trashHabit` |
| hook | `apps/mobile/hooks/use-habit-days.ts` | 暴露 `reload()`，不改现有语义 |
| 屏 | `apps/mobile/app/habits.tsx` | 新增路由 |
| 屏 | `apps/mobile/app/(tabs)/now.tsx` | 习惯条空态引导 + 「管理」入口 + 聚焦刷新 |
| 屏 | `apps/mobile/app/(tabs)/settings.tsx` | 新增「习惯」卡片 |
| 测试 | `apps/mobile/__tests__/habits-screen.test.tsx` | 新增 |

`packages/core` 不动。`packages/db` 只加导出，不改行为。

## 2. 决策：周期日计算不复制

`habitCycleDay(startedAt, cycleDays, localDate)` 目前只被 `packages/db` 内部用（`queries/habits.ts` 播种 + `queries/pool.ts` 取候选），`pool.ts` 的注释明确写着「生成逻辑只有一处」。习惯列表要显示 `N/21`，若在 app 层复刻一份就会有两个真相源，且跨本地日期的边界逻辑很容易写错。

选择：从 `packages/db` 补导出该纯函数，app 层调用。理由：

- 它已经是 `export function`，改动面只有一行 re-export；
- 它是纯函数、无 db 依赖，导出不会扩大 db 层的可变状态面；
- 替代方案（在 app 层重写）在规则上被 `queries/pool.ts` 的注释直接否定。

## 3. 决策：习惯条刷新用 `useFocusEffect`

**问题**：`useHabitDays` 只在 mount 与 `localDate` 变化时重读。Now 是 tab 屏，`router.push('/habits')` 压栈后 tab 不会卸载，返回时 Now 仍是挂载态 → 习惯条停留在创建前的数据，0/0 不变。

**方案**：`use-habit-days.ts` 增加一个 `reload()`（复用已有的 `reloadKey` 状态），`NowScreen` 里用 expo-router 的 `useFocusEffect` 在每次获得焦点时调一次。

**为什么不用别的**：

| 备选 | 否决理由 |
|---|---|
| 创建后 `router.back()` + 全局事件总线 | 引入跨屏通信机制，为一个刷新点付出的复杂度不成比例 |
| 习惯条改用 PowerSync watch query | 需要在 `packages/db` 新增 watch 查询（`use-habit-days.ts` 的注释说明 db 查询面是「冻结」的，`useContexts` / `useHabitDays` 都是刻意的 query-style 妥协）；为「创建后立即可见」引入常驻订阅不划算 |
| 把创建表单放回 Now 屏内联 | 已与用户确认走独立路由 |
| 靠 app clock 每分钟重读 | 写入是本地事务，1 分钟延迟不可接受；且会给这个 hook 加上原本没有的周期性查询 |

**副作用**：`useFocusEffect` 在首次聚焦也会触发，等于 mount 时多读一次本地库。幂等、成本可忽略。

**这是本仓库首次使用 `useFocusEffect`**，实现完成后需要在 `.trellis/spec/app/` 里记录这条「返回本屏时刷新只读数据」的既有解法（见 Phase 3.3）。

## 4. Hook 划分

按 `spec/app/hook-guidelines.md`「Hook file = one hook」：

- `use-habits.ts` → `useHabits(now)`：`{ data: HabitWithProgress[] | null, error, reload }`。
  `HabitWithProgress = { habit: Habit; cycleDay: number | null; doneCount: number }`。
  一次 `listHabits()` + 一次 `listHabitDays({ includeDeleted: false })`，在 hook 内按 `habitId` 分组 —— 这仍属于「one screen 的一份 joined view」，不违反「hook 内不做多查询聚合」的规则（与 `useProjectCards` 同形：db 侧一条查询，hook 侧一次读）。
- `use-start-habit.ts` → `start({ title, actionTitle, estMinutes, value, window? })`：
  构造 `Habit`（`id: ulid(now)`、`cycleDays: 21`、`status: 'active'`、`startedAt: toIso(now)`），调 `startHabit(db, habit, now)`。
- `use-trash-habit.ts` → `trash(id)`：薄封装 `trashHabit(db, { id, now })`。

时间一律取 `useAppClock()`（hook-guidelines Rule 4），组件不调 `Date.now()`。

## 5. 习惯屏组件结构

```
app/habits.tsx
├─ HabitsScreen            // 屏：标题 + 副标题 + 列表 + 表单 + 错误
├─ HabitRow                // 一条习惯：名 / 行动 / N/21 / 窗口 / 时长 / 价值 / 删除
├─ HabitForm               // 创建表单，presentational，props: onSubmit / submitting / error
└─ WindowFields            // 窗口开关 + 两个 HH:mm 输入（表单内可展开的一段）
```

`HabitForm` 与 `HabitRow` 都是一次性屏内组件，留在 `app/habits.tsx` 里（`component-guidelines`：真正复用的才进 `packages/ui`）。价值 chip 逻辑与 `projects.tsx` 的 `VALUE_CHIPS` 同形但**不复用**——那是个屏内局部常量，抽成共享组件只为一处调用不划算；实现时若判定应抽，再在 Phase 3.3 记录。

表单提交成功后：清空输入、保留在屏内（不自动 `back()`），让连续创建多个习惯不用来回跳。入口有两个，用户可能从设置页进来，自动返回会把他丢到一个没去处的页面。

## 6. 表单校验（纯 render 内计算，不放 hook）

- `title.trim() !== ''`
- `estMinutes` 是正整数（`Number.isInteger` 且 `>= 1`）
- 窗口关闭 → 合法
- 窗口开启 → 起止都必须是合法 `HH:mm`，且 `windowStart < windowEnd`（按分钟数比较，字符串比较同样可行但显式解析更清楚）

任一不满足则「开始 21 天挑战」按钮 `disabled`。`Button` 已支持 `disabled`（`projects.tsx` 在用）。

## 7. 挑战文案红线

领域模型写明 UI 文案不得声称「21 天保证养成习惯」。副标题用「21 天是一个挑战周期，不是保证」这类表述；`N/21 天` 是事实陈述，合规。

## 8. 测试策略

新增 `apps/mobile/__tests__/habits-screen.test.tsx`，按 `spec/app/testing-guidelines.md`：

- 用 `renderRouter('app', { initialUrl: '/settings' })` 挂父路由再导航到 `/habits`，保证返回有落点；
- 扩充 `@nextdo/db` mock factory，补上 `listHabits` / `listHabitDays` / `startHabit` / `trashHabit` / `habitCycleDay`；
- 用例：填全字段提交 → 断言 `startHabit` 收到 `cycleDays: 21` / `status: 'active'` / `actionTitle` 继承；窗口未开启 → 起止为 `undefined`；窗口半填 → 按钮禁用；删除 → 列表消失；列表为空 → 空态渲染。

`now-screen.test.tsx` 需补一条：零习惯时渲染引导入口（该文件已 mock 习惯相关查询）。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 改了 `now.tsx` 的习惯条，可能撞到 `now-screen.test.tsx` 现有断言 | 改前先读该文件的习惯条相关用例；改后同步更新断言 |
| `useFocusEffect` 是本仓库首用，`renderRouter` 测试环境下焦点行为未验证 | 测试里若焦点不触发，用「显式调 reload」的等价断言覆盖，并在实现时确认真机行为 |
| `expo export --platform web` 回归 | Phase 2 末尾实跑一次 |
