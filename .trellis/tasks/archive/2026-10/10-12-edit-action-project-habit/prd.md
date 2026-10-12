# 支持编辑行动、项目与习惯 (Issue #19)

## Goal

为行动（NextAction）、项目（Project）和习惯（Habit）提供完整、清晰可见的编辑入口，支持修改核心属性（名称、描述/目标、场景、预计时长、频率、起始日期等）并即时保存与多端同步，彻底消除创建后只能删除重建的高操作成本。

## Background & Analysis

1. **项目（Project）**：
   - 详情路由 `/projects/[id]` 已具备 `EditProjectForm`（修改标题 `title`、目标/结果 `outcome`、价值 `value`、截止 `deadline`）。
   - 需确保项目详情的编辑入口位置直观，表单校验和保存逻辑稳健，与新建规范一致。
2. **行动（NextAction）**：
   - 在项目详情页 `/projects/[id]` 已有 `EditActionForm`，但缺少场景（`contextIds`）的选择和编辑能力；`useUpdateNextAction` 的 `UpdateNextActionPatch` 也缺少 `contextIds`。
   - 在核心工作台 Now 屏（`apps/mobile/app/(tabs)/now.tsx`），列表行 `ActionRow` 和推荐卡片 Hero 均只有「完成/稍后/删除」，独立行动与日常推进中的行动缺乏就地编辑入口。
   - 需要：补全场景（`contextIds`）编辑支持，并在 Now 屏与项目详情页提供一致的行动编辑入口与表单。
3. **习惯（Habit）**：
   - 目前在 `/habits` 和 `/projects/[id]` 的习惯卡片中只有「删除」，完全没有编辑入口，且移动端缺少 `useUpdateHabit` hook。
   - 需要：在 `@nextdo/db` 的 `updateHabit` 中支持周期/起始日/频率变更时的自动补种（`seedHabitDays`）；在 `apps/mobile` 提供 `useUpdateHabit` hook；在习惯管理页 `/habits` 与项目详情页 `/projects/[id]` 增加清晰可见的「编辑」入口和 `EditHabitForm`，支持编辑习惯名、每日行动、预计时长、价值、起始日期、时间窗口以及频率执行日。

## Requirements

- **R1 项目编辑能力保持与完善**：
  - 项目详情页 `/projects/[id]` 顶部清晰可见「编辑」按钮。
  - 支持编辑项目标题、完成目标（outcome）、价值（value）、截止日期（deadline）。
  - 保存后即时更新并同步。
- **R2 行动编辑与场景选择**：
  - `UpdateNextActionPatch` 增加 `contextIds?: string[]` 支持。
  - 编辑行动表单支持修改：标题、预估时长（快捷芯片+自定义输入）、价值、场景（Context 多选芯片）、截止日期。
  - 在项目详情页的行动卡片上提供「编辑」入口。
  - 在 Now 屏的行动行（`ActionRow`）及 Hero 推荐卡片上提供清晰可见的「编辑」入口，支持唤起编辑模态框/表单并即时保存刷新。
- **R3 习惯编辑与周期重算**：
  - `@nextdo/db` 的 `updateHabit` 在 `startedAt` 或 `windowDays` 发生变更时执行 `seedHabitDays`，补充新范围的 `HabitDay`。
  - 新增 `useUpdateHabit` hook，封装全行更新与错误处理。
  - 习惯卡片（`/habits` 及 `/projects/[id]`）增加「编辑」按钮。
  - `EditHabitForm` 支持编辑：习惯名（`title`）、每日行动（`actionTitle`）、预计时长（`estMinutes`）、价值（`value`）、起始日期（`startDate`）、时间窗口（`windowStart`/`windowEnd` 开关及时间选择）、频率执行日（`windowDays` 星期几多选）。
  - 保存后即时写入数据库，本地进度及打卡格即时刷新。

## Acceptance Criteria

- [ ] (AC-1) 项目编辑：在 `/projects/[id]` 点击编辑，能修改标题、目标、价值与截止，保存后界面即时展示新数据。
- [ ] (AC-2) 行动编辑：在项目详情页及 Now 屏均可点击「编辑」，表单预填当前值，可修改名称、预估时长、价值、场景（可多选/反选情境）与截止日期；保存后即时生效。
- [ ] (AC-3) 习惯编辑：在 `/habits` 页面和项目详情页点击习惯的「编辑」，可修改习惯名、每日行动、时长、价值、起始日期、时间窗口与频率；保存后即时生效且无崩溃。
- [ ] (AC-4) 自动化测试覆盖：新增/更新 db 层和 mobile 层的单元测试，验证行动场景更新、习惯更新（含起始日与时间窗口/频率）及 UI 交互行为。
- [ ] (AC-5) 门禁与验证：`pnpm verify:web` 全绿，并在浏览器中实际验证项目编辑、行动编辑和习惯编辑并保存截图。
