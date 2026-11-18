# 技术设计：支持编辑行动、项目与习惯 (Issue #19)

## 架构与数据流

### 1. 数据持久化与查询层 (`packages/db`)

- **Habits 更新与重新播种 (`packages/db/src/queries/habits.ts`)**：
  - `updateHabit(db, habit)` 原逻辑只在 `broken → active` 重启挑战时调用 `seedHabitDays`。
  - 增强：当 `habit.startedAt !== previous.started_at`、`habit.cycleDays !== previous.cycle_days` 或 `habit.windowDays !== previous.window_days` 时，同样在同一个事务内执行 `seedHabitDays(tx, habit, parseIso(habit.updatedAt))`。
  - `seedHabitDays` 已内置按 `id` 幂等处理（已存在的记录不覆盖，新日期范围内的合法记录自动生成 `open` 状态）。

### 2. 状态与变更 Hooks (`apps/mobile/hooks/`)

- **`useUpdateNextAction` (`apps/mobile/hooks/use-update-next-action.ts`)**：
  - 扩展 `UpdateNextActionPatch`：
    ```ts
    export interface UpdateNextActionPatch {
      title?: string;
      estMinutes?: number;
      value?: Value;
      deadline?: string;
      contextIds?: string[];
    }
    ```
  - 合并 patch 时支持 `contextIds`。

- **`useUpdateHabit` (`apps/mobile/hooks/use-update-habit.ts`)**：
  - 新增 Hook，依赖 `wrapDb(usePowerSync())` 与 `useAppClock()`。
  - 接收 `{ habit: Habit; patch: UpdateHabitPatch }`。
  - 支持更新：`title`、`actionTitle`、`estMinutes`、`value`、`startedAt`、`windowStart`、`windowEnd`、`windowDays`。

### 3. 组件与用户界面 (`apps/mobile`)

- **行动编辑表单与模态框**：
  - `EditActionForm` 补全场景多选功能：从 `useContexts` 加载所有 Context，渲染为可选芯片；点击即可多选/取消选择。
  - 在 `apps/mobile/app/projects/[id].tsx` 中使用补全场景后的 `EditActionForm`。
  - 在 `apps/mobile/app/(tabs)/now.tsx` 中：
    - 在 `ActionRow` 底部操作按钮栏增加「编辑」按钮（与「完成」、「稍后」、「删除」并列）。
    - 在 Hero 卡片操作区增加「编辑」入口。
    - 点击时呼出 `EditActionModal`，支持直接就地编辑修改，保存后驱动 Now 屏即时刷新。

- **习惯编辑表单**：
  - 创建 `EditHabitForm`：
    - 预填待编辑习惯的原值。
    - 包含：习惯名称、每日行动（选填，留空继承习惯名）、预计时长（分钟）、价值（1~5）、起始日期选择器（`DateTimePicker`）、时间窗口开关与开始/结束时间选择器、频率执行日选择（周一至周日多选芯片）。
    - 校验规则：习惯名称非空、预计时长为正整数、起始日期有效（若修改起始日期需满足不早于今天，若保持原起始日期则允许）、时间窗口开始早于结束。
    - 点击「保存」调用 `useUpdateHabit`，成功后回调 `onSaved`。
  - 在 `apps/mobile/app/habits.tsx` 的 `HabitRow` 中加入「编辑」按钮，点击在卡片内展开 `EditHabitForm`。
  - 在 `apps/mobile/app/projects/[id].tsx` 的 `ProjectHabitCard` 中加入「编辑」按钮，点击在卡片内展开 `EditHabitForm`。

- **项目编辑表单**：
  - 维持 `projects/[id].tsx` 中的 `EditProjectForm`（包含标题、目标结果、价值、截止日期），确保样式与校验一致。
