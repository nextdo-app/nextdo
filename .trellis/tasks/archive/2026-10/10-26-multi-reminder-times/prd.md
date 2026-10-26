# 支持一条任务设置多个提醒时间

## Goal

让「提醒时间」字段支持多选：一条 next action / calendar action 可挂多个待发提醒时刻，表单以列表形式增删，写入层放开「一条 action 最多一个待发提醒」的限制。

## Requirements

- R1 表单的「提醒时间」是一个可增删的时刻列表：点「添加提醒」打开既有的 `DateTimePicker`，每个已选时刻显示为一个可单独移除的 chip。
- R2 保存时按时刻集合对齐 `reminders` 表：仍被选中的时刻保留原行（行 id 不变），被移除的时刻置为 `cancelled`，新增的时刻插入新行。
- R3 过去的时刻不创建提醒；同一分钟重复选择只保留一条。
- R4 没有改动提醒字段的保存（改名、只改截止时间）不触碰任何提醒行——推迟（snooze）产生的提醒必须存活。
- R5 推迟仍然是单点语义：`snoozeAction` 把该行动的提醒对齐到推迟目标这一个时刻，覆盖多选集合。
- R6 数据模型不变：`reminders` 表本来就按行存储、以行 id 作为通知与日历事件的 join key，无需迁移。

## Acceptance Criteria

- [x] AC-1 一条行动挂 3 个时刻 → `reminders` 有 3 行 `state='scheduled'`，`fires_at` 按升序返回。
- [x] AC-2 编辑后保留其中 2 个、换掉 1 个 → 保留的两行 id 不变，被换掉的那行 `state='cancelled'`，新增一行。
- [x] AC-3 清空列表 → 该行动的提醒全部 `cancelled`。
- [x] AC-4 只改名不改提醒 → 已存在的提醒行状态与 id 完全不变。
- [x] AC-5 过去时刻被丢弃，不会写入。
- [x] AC-6 `pnpm lint` / `pnpm typecheck` / core、db、mobile 三包测试全绿。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
