# 桌面端 macOS 日历通道：提醒写入系统日历

## Goal

让 Tauri 桌面端在 macOS 上通过 EventKit 把待触发提醒写入系统日历，补上「应用关闭时不投递」的缺口；含权限申请、事件生命周期与写入通道设置项

## Background

桌面端目前的投递只有应用内 30s tick：应用关闭即静默（`domain-model.md` 平台能力矩阵）。`tauri-plugin-notification 2.4.0` 确实没有未来定时能力，但那只是**通知插件**的限制，不等于桌面端无法投递——macOS 自 Sonoma(14) 起允许第三方应用通过 EventKit 写入系统日历，这是桌面端唯一能让提醒在应用关闭后仍然到点的路径。

## Requirements

### R1 macOS 日历通道

- 设置页「提醒」区块在 macOS 桌面端提供 `calendar` / `both`（与移动端同一套 `app` / `calendar` / `both` 语义），选择持久化；
- 非 macOS 桌面端（Windows / Linux）不显示该选项，保持 app 通道，行为不变。

### R2 权限

- 仅在用户主动开启日历通道时请求 EventKit 权限，不在启动时静默弹窗；
- 被拒绝或受限时不静默失败：降级为 app 通道继续投递，设置页显示当前状态与「打开系统设置」入口；
- 用户可在「系统设置 → 隐私与安全性 → 日历」随时撤销；撤销后停止写入，且不得因为写不进去而让提醒彻底不响。

### R3 事件内容与生命周期

- 每条待触发提醒对应一个日历事件：标题 = 行动标题；开始 = `reminders.fires_at`；时长 = 行动估时（缺省 15 分钟，最少 1 分钟）；描述 = 备注（先经 `markdownToPlainText`，空备注不写空描述）；闹钟 = 开始时提醒（0 分钟前）；
- 提醒消失（已触发／被 snooze 改写／被清除／行动完成或删除）→ 删除对应事件；
- 标题／时间／备注变化 → 更新事件，而非重复创建；
- 已过去的提醒不补建；
- 映射以 `reminders.id` 为键持久化，重启后不重复创建。

### R4 与既有实现一致的不变量

- 日历通道与「日历事项同步」开关互相独立，互不增删对方的事件；
- 写入／删除幂等、可重入，失败在下次对账重试；
- 通道的所有权判定与移动端同构：日历通道真正接管时才不再发应用通知。

### R5 规范修正

- `domain-model.md` 的平台能力矩阵把两件事分开写：`tauri-plugin-notification` 无未来定时（通知插件限制），与桌面端整体投递能力（macOS 由日历通道补足）。

## Acceptance Criteria

- [ ] macOS 桌面端设置页可选 `calendar` / `both`，选择持久化，重启后保留；
- [ ] 授权后待触发提醒出现在系统日历，开始时刻等于提醒时刻且带 0 分钟闹钟，描述为纯文本备注；
- [ ] 选中 `calendar` 时不再发应用内通知；切回 `app` 时已建事件被清除；
- [ ] 修改时间／标题／备注后事件被更新而非重复创建；提醒取消或触发后事件消失；
- [ ] 权限被拒时降级为 app 投递，设置页可见状态与设置入口；
- [ ] 非 macOS 桌面端与移动端行为不变；
- [ ] 事件映射的纯逻辑单测通过；`pnpm lint`、`pnpm typecheck` 通过；
- [ ] 实测证据存于 `.verify/10-23-macos-calendar-channel/`（macOS 真机 + `evidence.md`）。

## Out of scope

- Windows / Linux 的日历通道；
- 写入「提醒事项」App（EventKit 无仅写入档位，需完全访问，另议）；
- 移动端行为改动。

## Notes

- 权限档位与写入语义见 `research/findings.md`：仅写入权限读不回自己建的事件，因此生命周期管理需要完全访问。
- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
