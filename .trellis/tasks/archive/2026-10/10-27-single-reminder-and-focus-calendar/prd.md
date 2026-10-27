# 提醒只发一次 + 专注结束自动写入日历

## Goal

同一条提醒在多个通道同时触发导致一次收到多条；收敛为单次投递。专注会话结束后，自动把 起止时间+正在完成【】任务 写入系统日历。

## Requirements

- R1 同一条提醒只投递一次。一次触发时用户最多收到一条通知，无论客户端开关、外部通道与系统日历通道如何组合。
- R2 客户端「提醒方式」收敛为二选一：应用内通知 / 系统日历；不再提供「两者都发」。旧设备上已存的 `both` 迁移为 `calendar`（日历独占、可 App 关闭时仍到达）。
- R3 外部通道（飞书 / PushPlus / Server酱）互斥：按配置顺序择一投递成功，失败才回退下一个；已成功投递过的提醒不再向其它通道重发。
- R4 日历类行动已由行动同步在 `startsAt` 写入带 0 分钟闹铃的事件；其提醒若落在同一分钟，不再生成第二个提醒事件。
- R5 专注会话正常结束时（用户点「结束专注」），自动在系统日历写一条历史事件：起止时间 = 会话 `startedAt → endedAt`，标题 = `正在完成【<行动标题>】任务`。
- R6 这条专注事件不设闹钟、不改变专注页既有行为；未授权日历 / 平台不支持 / 标题缺失时静默跳过，不打扰用户。
- R7 写入目标沿用设置里选定的日历（`preferredCalendarId`），与提醒、日历行动同一条通道。

## Acceptance Criteria

- [ ] AC-1 设置页「提醒方式」只剩两项，选择系统日历且已授权时，客户端不再调度应用内通知。
- [ ] AC-2 服务端一条提醒只发送一条外部消息；某个通道失败时下一通道接手，成功后不再重发。
- [ ] AC-3 同一天历时间的行动 + 同一分钟提醒，日历里只出现一个事件。
- [ ] AC-4 专注结束后系统日历出现一条覆盖专注时段的事件，标题为「正在完成【…】任务」，无闹铃。
- [ ] AC-5 `pnpm lint` / `pnpm typecheck` / 各工作区测试全绿；`pnpm verify:web` 通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
