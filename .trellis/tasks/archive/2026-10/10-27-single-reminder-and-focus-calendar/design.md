# 技术设计 — 单次投递 + 专注写入日历

## 现状与重复来源

一次到点提醒在客户端最多可走三条路径，叠加即「同时收到多条」：

| 路径 | 代码 | 触发条件 |
| --- | --- | --- |
| 应用内通知 | `apps/mobile/lib/reminders/adapters/{native,tauri}.ts` | `reminderChannel ∈ {app, both}` |
| 系统日历事件 | `apps/mobile/lib/calendar-sync/reminder-plan.ts` | `reminderChannel ∈ {calendar, both}` 且已授权 |
| 外部推送 | `server/app/src/reminder-dispatcher.ts` | 每个已配置通道各发一次（飞书 / PushPlus / Server酱） |

另有第四种「看似重复」：`calendar_actions` 同步在 `startsAt` 写入带 0 分钟闹铃的事件，若该行动还有同一分钟的提醒，日历会响两次。

## 设计决策

### D1 「提醒方式」只允许一个通道

`ReminderDeliveryChannel` 收敛为 `'app' | 'calendar'`。理由：两个都在时用户永远拿到两条，而「两者都发」的唯一价值（日历没授权时仍有通知）已由 `calendarOwnsReminderDelivery` 的权限判定覆盖——未授权时自动回退到应用内通知。

**兼容**：`parseNotificationSettings` 把历史值 `'both'` 映射为 `'calendar'`（日历独占，保住「App 关闭也能提醒」的承诺），不新增迁移脚本。

### D2 外部通道互斥，按配置顺序择一

`dispatchDueReminders` 改为：

1. 先查该提醒是否已有 `status='sent'` 的投递行，有则整体跳过（跨 tick 去重，防止今天先成功、下一 tick 又从另一个通道发出）。
2. 按 `deps.channels` 顺序尝试：某个通道发送成功即记录并 `break`；失败则记录 `failed` 并继续下一个。
3. `reminder_deliveries` 的唯一键 `(reminder_id, channel)` 仍是抢占原语，无需改表。

### D3 日历行动与提醒的同一分钟合并

`buildReminderCalendarPlan` 新增 `coveredReminderIds`。调用方（`use-calendar-sync`）只在行动同步开启时计算：凡是 `kind === 'calendar'`、且 `firesAt ∈ [startsAt, startsAt + 60s)` 的提醒，交给行动事件负责。规则刻意只覆盖同一分钟——行动事件的闹铃固定在 `startsAt`，比它晚的提醒是独立信息，不应被吞掉。

### D4 专注事件进入日历

新增纯函数 `lib/calendar-sync/focus-event.ts`：

- `buildFocusCalendarEvent({ session, actionTitle })` → `CalendarSyncEventSpec`
  - `actionId = session.id`（仅用于签名/日志，不进入映射表）
  - `title = 正在完成【<actionTitle>】任务`
  - `startsAt = session.startedAt`，`endsAt = session.endedAt`（墙钟时长，含暂停）
  - `alarm: false`
- `writeFocusSessionToCalendar`：`isCalendarSupported()` → `getCalendarPermission() === 'granted'` → `loadCalendarSyncState()` → `ensureCalendar(preferredCalendarId)` → `createCalendarEvent`。任一步不满足即静默返回。**不申请权限**：专注结束不是该弹系统对话框的时机。
- 写入不进入 `mappings`：事件是一次性历史记录，下次同步不会更新或删除它，用户也可以自行编辑。

### D5 `alarm` 成为事件规格的一部分

`CalendarSyncEventSpec` 增加可选 `alarm?: boolean`（缺省 = true，保持提醒/行动行为不变），并计入 `calendarEventSignature`。

- `device.ts`：`alarm === false` 时 `alarms: []`。
- `desktop.ts`：`alarm === false` 时省略 `alarmOffsetMinutes`。
- `apps/desktop/src-tauri/src/calendar.rs`：`alarmOffsetMinutes` 缺省改为「不添加闹铃」（原先缺省按 0 处理）。JS 与 Rust 同仓发布，桥接契约一并更新。

### D6 入口

`useFocusSession.complete(sessionId, actionTitle?)` 在 `completeFocusSession` 成功后调用 `writeFocusSessionToCalendar`（best-effort，异常只记日志）。专注页把已加载的 `title` 传入。

## 变更边界

- 不动 `reminders` / `focus_sessions` 表结构与同步规则。
- 不动专注计时、暂停、放弃流程；仅「正常结束」写日历。
- 外部通道的秘钥配置与文档措辞同步更新，不改部署流程。
