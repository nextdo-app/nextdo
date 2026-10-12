# Habit start date picker (GitHub issue #13)

> 来源 issue：https://github.com/nextdo-app/nextdo/issues/13 「优化建立习惯时的起始日期选择」

## 背景与问题陈述

issue 标题指向「起始日期」，正文描述的现象是「『选择时间』选项实际渲染的是文本框，用户必须按规定格式手填，容易因格式错误导致失败」。代码核对后确认这两者都存在：

1. 习惯表单的**时间窗口**（`windowStart` / `windowEnd`）是两个 `HH:mm` 纯文本框，必须手打格式；这违反 `.trellis/spec/app/component-guidelines.md`「The user never hand-types an ISO string」。
2. 表单**根本没有起始日期字段**——`Habit.startedAt` 恒为创建瞬间，挑战第 1 天永远是创建当天。用户补记「我三天前就开始了」没有入口。

## 目标

- 时间窗口改用已有的 `DateTimePicker`（`mode="time"`），不再手打 `HH:mm`。
- 新增「起始日期」字段，用 `DateTimePicker`（`mode="date"`）选取，写入 `Habit.startedAt`，让挑战从选定日期起算。

## Requirements

### R1 时间窗口用选择器

- 两个 HH:mm 文本框替换为只读回显 + 「选择时间」按钮，点击打开 `DateTimePicker mode="time"`。
- 复用现有组件，不新增依赖（`component-guidelines.md` 已禁止 `@react-native-community/datetimepicker`）。
- 字段值仍是 `"HH:mm"` 字符串，写入 `windowStart` / `windowEnd` 的存储格式不变。
- 原有校验保留：开启窗口时两半都必须有效，且 `windowStart < windowEnd`，否则提交按钮禁用并给出提示。

### R2 起始日期字段

- 新增「起始日期」，默认值 = 今天（`localDateKey(now)`），用 `DateTimePicker mode="date"` 选取，值格式 `"YYYY-MM-DD"`。
- `Habit.startedAt` 写入**所选日期的本地零点**（不是创建瞬间），使 `habitCycleDay` 按日历天推进。存储类型不变（ISO 字符串），已有习惯数据不受影响。
- `startHabit` 在同一事务内**一次性铺满整个挑战周期**（起始日 → 起始日 + `cycleDays − 1`）的 HabitDay（状态 `open`），因此起始日可以是未来某天：到了那天挑战日已经在等着。没有跨天补种机制，所以过去未完成的那些天不补记，`missed` 仍按既有规则在查询时派生。
- 起始日不得早于今天：应用只在 `startHabit` / 挑战重启时播种，没有跨天补种机制，一个已经过去的日子无法补记。
- 起始日不设上限，可以预约到任意远的将来。
- 起始日在未来时，习惯列表显示「N 天后开始」而不是「第 N/21 天」——挑战还没开始，没有挑战日可显示。

### R3 校验与提示

- 起始日期非法（早于今天 / 非法日历日）时提交按钮禁用，并给出具体中文提示。
- 非法值不提交给数据层。
- 起始日在未来**不算错误**：`startHabit` 返回的「今天挑战日」为 `null` 属于正常结果，界面不报错，习惯正常入库。

## Acceptance Criteria

- [ ] 习惯表单的时间窗口不再是自由文本框，两半都由 `DateTimePicker mode="time"` 产生。
- [ ] 习惯表单新增起始日期，由 `DateTimePicker mode="date"` 产生，默认今天。
- [ ] 可以选择今天或任意一个未来日期作为起始日期，不设上限。
- [ ] 选择未来的起始日期后可以正常提交，习惯出现在列表中并显示「N 天后开始」。
- [ ] 选择未来的起始日期后，整个 21 天周期的 HabitDay 都已生成（起始日 → 起始日 + 20 天）。
- [ ] 起始日期早于今天时提交按钮禁用并显示原因提示（无论只早一天还是早很多天）。
- [ ] 时间窗口开启但未选全、或 `windowStart >= windowEnd` 时，提交按钮禁用（原有行为不回归）。
- [ ] `windowStart` / `windowEnd` / `startedAt` 的存储格式不变，已有习惯数据可正常读取。
- [ ] `pnpm verify:web` 门禁全绿，截图存放在 `.verify/habit-start-date-picker/`。

## Out of Scope

- 习惯编辑 / 暂停 / 重启挑战（沿用 10-02 的非目标）。
- `windowDays`（每周哪几天）——仍然留空即每天。
- 自定义挑战周期天数——固定 21。
- 跨天自动补种 HabitDay 的定时任务（本任务只处理创建时刻的补播种）。
- 与版本渠道相关的发布流程改动（GitHub issue #14）。