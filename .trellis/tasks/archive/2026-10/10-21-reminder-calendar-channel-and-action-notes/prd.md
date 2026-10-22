# 提醒接入系统日历通知通道 + 行动备注与点击编辑

## Goal

让系统日历接管提醒通知（提醒写入日历并带闹钟），并给行动增加备注字段与列表点击编辑

## Requirements

### R1 提醒投递通道可选

设置页「提醒」区块三选一：

- `app`（默认）：只走应用自己的通知，行为与现在完全一致；
- `calendar`：只写系统日历，不再发应用通知（避免同一条提醒响两次）；
- `both`：两条腿都走。

切换后下一次对账即生效；`calendar` / `both` 下日历事件随开关增删。

### R2 系统日历事件的内容

每条待触发提醒 → 一个日历事件：

- 标题 = 行动标题；
- 开始 = `reminders.fires_at`，持续 = 行动估时（缺省 15 分钟，最少 1 分钟）；
- 描述 = 行动备注（有则写）；
- 闹钟 = 开始时提醒（0 分钟前）——事件开始时刻就是提醒时刻。

### R3 生命周期

- 提醒消失（已触发／被 snooze 改写／被清除／行动完成或删除）→ 删除对应事件；
- 标题／时间／备注变化 → 更新事件；
- 已过去的提醒不再补建（否则会补发一次通知）；
- 日历事项同步开关与提醒通道互相独立：关掉日历事项同步不得撤掉提醒通道创建的事件，反之亦然；
- 映射以 `reminders.id` 为键持久化，重启后不会重复创建。

### R4 行动备注

- `next_actions` 与 `calendar_actions` 新增可空 `note` 列（客户端 schema、服务端目录／DDL、同步配置、上传允许列同步）；
- 备注可为空、可清空；空串按「无备注」处理，不写占位字符；
- 备注不参与引擎排序／评分，仅作展示与日历事件描述。

### R5 点击事项即可编辑

- Now 页待办卡片整行可点，打开既有编辑弹窗（不必先点「编辑」小按钮）；
- 编辑弹窗内可编辑标题、估时、截止与**备注**；
- 卡片上有备注时显示（单行截断），让上下文一眼可见。

## Acceptance Criteria

- [ ] 设置页可选择 `app` / `calendar` / `both`，选择持久化，重启后保留；
- [ ] 选中 `calendar` 或 `both` 时，待触发提醒在系统日历中出现，开始时刻等于提醒时刻且带 0 分钟闹钟，描述为备注；
- [ ] 选中 `calendar` 时不再发应用通知；切回 `app` 时日历事件被清除；
- [ ] 修改提醒时间／标题／备注后事件被更新而非重复创建；
- [ ] 提醒触发或被取消后事件消失；
- [ ] 关掉「日历事项同步」不影响提醒通道创建的事件；
- [ ] 事项可写入、修改、清空备注，云端往返后仍在；备注显示在卡片上；
- [ ] 空备注不会被写成空格串，也不会在日历事件里留下空描述；
- [ ] `pnpm lint`、`pnpm typecheck` 通过；`packages/db` 与 `server/app` 测试通过；
- [ ] 浏览器实测截图存于 `.verify/10-21-reminder-calendar-channel-and-action-notes/` 并附 `evidence.md`。

## Out of Scope

- 不做日历事件的双向导入（用户在内置日历里改事件不回写 Nextdo）；
- 不做重复规则的提醒（复用现有单次 `reminders` 行）；
- 不做备注富文本／附件；
- 不改桌面端（Tauri）的日历写入策略（本次以 iOS/Android 原生日历为准）。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
