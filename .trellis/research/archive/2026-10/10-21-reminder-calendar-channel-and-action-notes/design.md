# 设计：提醒接入系统日历通知通道 + 行动备注与点击编辑

## 背景与约束

现有提醒是由 App 自己在 `useReminderDelivery` 里把 `reminders` 行对账成 OS 本地通知（`expo-notifications` / Tauri 适配器）。该通道的弱点是**依赖 App 的调度存活**：进程被强制划掉、激进 ROM 回收 pending 请求、系统重置通知权限，都会让提醒静默丢失。

系统日历事件带 `alarms`，由日历 App / 系统持有，即使 Nextdo 从不运行也会响。因此本任务新增「第二通道」，而不是替换实现：通道由用户设置（`app` / `calendar` / `both`）决定。

另一条需求（备注 + 点击编辑）属于数据层：行动没有地方记录上下文，用户只能翻回原始消息/文件。备注字段写入 `note` 列，并在提醒通道里作为日历事件的描述。

## 关键决策

### D1 通道由本地设置决定，不是数据库开关

`NotificationSettings` 增加 `reminderChannel: 'app' | 'calendar' | 'both'`，默认 `app`（保持既有行为）。理由：提醒通道是设备级偏好（同一账号在手机与桌面可以有不同选择），与 `calendarEnabled` 同一层级，不该进同步表。读取用 `loadNotificationSettings()`，变更用 `subscribeToNotificationSettings()`，与既有 `masterEnabled` 完全同构。

### D2 「calendar」= 日历独占投递

`useReminderDelivery` 在 `calendar` 且平台为 native 时把 `enabled` 置为 false，从而**取消所有已排队的 App 通知**——否则一次提醒会响两遍。`both` 不抑制。非 native 平台没有日历通道（`useCalendarSync` 只在 iOS/Android 挂载），因此该平台仍按原逻辑投递，设置值保留、不生效。

### D3 提醒映射与日历事项映射分开存

`CalendarSyncState` 由 `mappings`（`calendar_actions` → 事件）升级为 `mappings` + `reminderMappings`（`reminders.id` → 事件），键互不干扰：关掉「日历事项同步」时 `applyPlan` 只清 `mappings`，不会误删提醒通道创建的事件；反之亦然。旧存档没有 `reminderMappings` 时按空对象读入（`store.ts` 解析时补默认值），无需迁移脚本。

### D4 事件内容

- 标题：行动标题（空标题的行直接跳过，与 App 侧对账 `title === null` 跳过同理）；
- 开始：`reminders.fires_at`；结束：开始 + 行动估时（缺省 15 分钟，最少 1 分钟）；
- 描述：`note`，空串/纯空白视为无备注，退回 `EVENT_NOTE` 固定文案，避免日历里出现空描述；
- 闹钟：`relativeOffset: 0`——事件开始时刻即提醒时刻；
- 已过去的提醒不补建（`startsAt < now` 丢弃），否则会补发一次通知。

### D5 变更检测复用既有签名

`calendarEventSignature` 已经是 `title / startsAt / endsAt / notes` 的拼接；把 `notes` 纳入签名后，备注变化自然触发 update。纯逻辑放在 `lib/calendar-sync/reminder-plan.ts`（`reminderEventSpec` + `buildReminderCalendarPlan`），与 `reconcile.ts` 的日历事项逻辑并列、独立开关，可单测而不碰 OS。

### D6 备注字段是同步数据

新增可空列 `note`（`next_actions` / `calendar_actions`）：

- 客户端 schema：`packages/db/src/schema.ts` 两张表 + `Column.text('note')`，`fromRow / toRow` 双向映射；
- 服务端目录：`server/app/src/db.ts` 的表/列白名单（否则 upload 409）；
- 服务端 DDL：`server/app/src/schema-init.ts`（启动建表）+ `server/powersync/init/02-nextdo-schema.sql`（PowerSync 侧）；
- 同步配置：`server/powersync/sync-config.yaml` 的 data query 增加 `note`；
- 规则：空串归一为 `null`（`''` 不写库），读取侧统一 `note ?? null`；备注不参与引擎评分。

### D7 点击事项编辑

Now 页 `ActionRow` 整行可点：未揭开 swipe 时点击打开 `EditActionModal`（仅 `kind === 'next'`；`calendar` 行的编辑器另有入口）。揭开状态下第一次点击仍只关按钮，避免误触编辑。卡片在有备注时显示备注（两行截断），让上下文一眼可见。

## 数据流

```
reminders 表 ──► listScheduledReminders() ──► buildReminderCalendarPlan()
                                                    │
settings.reminderChannel ───────────────────────────┤
                                                    ├─ toCreate / toUpdate / toDelete
store.reminderMappings ◄────────────────────────────┘
        │
        └─ device.ts (expo-calendar) createEvent / updateEvent / deleteEvent

note 列 ──► NextCandidate.note / CalendarAction.note ──► ActionRow 展示 / EditActionModal 编辑
                                                  └─► reminder-plan.ts → 事件 notes
```

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| `calendar` 但用户在系统设置里撤了日历权限 → 完全收不到提醒 | 设置页在 `denied` 时显示红色提示「提醒会退回应用内通知」；`useCalendarSync` 拿不到日历就跳过，App 侧的投递不会因此被恢复（设置即契约），提示引导用户修复 |
| 用户把日历事件手动删掉 | 下一轮对账按签名比对，映射仍在但不追踪存在性——与既有日历事项同步一致；事件被删后不会再补建（除非签名变化触发 update 失败回退 create） |
| 事件被改到过去 | `startsAt < now` 丢弃并从映射清理，避免无限 update 循环 |
| 旧存档映射格式 | `store.ts` 解析时 `reminderMappings: {}` 兜底 |

## 变更文件

- `packages/core/src/domain/types.ts`、`packages/core/src/engine/types.ts`：`note` 字段；
- `packages/db/src/schema.ts`、`queries/{actions,calendar,pool,reminders}.ts`：列、映射、查询；
- `server/app/src/{db,schema-init}.ts`、`server/powersync/{sync-config.yaml,init/02-nextdo-schema.sql}`：服务端白名单、DDL、同步列；
- `apps/mobile/lib/notification-settings.ts`：`reminderChannel`；
- `apps/mobile/lib/calendar-sync/{device,reconcile,reminder-plan(新增),store}.ts`：事件写入/签名/纯计划/映射；
- `apps/mobile/hooks/{use-reminder-delivery,use-calendar-sync,use-update-next-action}.ts`：通道、对账、备注写回；
- `apps/mobile/components/edit-action-modal.tsx`、`app/(tabs)/now.tsx`、`app/(tabs)/settings.tsx`：备注输入、点击编辑、通道选择。
