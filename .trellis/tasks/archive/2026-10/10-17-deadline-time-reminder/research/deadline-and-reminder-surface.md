# 现状调研：截止时间与提醒的接触面（2026-10-17）

本次所有结论都来自代码，路径后面的行号是核对过的位置。

## 1. 截止（deadline）

- **领域形状已经是精确时刻**：`packages/core/src/domain/types.ts:59` —— `deadline?: string`，注释 “ISO datetime (exact moment; drives deadline-urgency in exact hours)”；项目的 `deadline`（同文件 :40-44）与之同形，一个 `deadlineStatus` 同时读两者。
- **引擎按小时分级**：`.trellis/spec/domain/next-action-engine.md:153` 记着 `deadline-urgency` 的档位（≤0 → 1.0、≤24h → 0.9、≤72h → 0.7、≤168h → 0.4，否则 0），`packages/core/src/engine/recommend.test.ts` 有对应断言 —— 阈值不变，入口粒度变细只会更准。
- **UI 把它压成当天 23:59**：`apps/mobile/lib/clarify-flow.ts:490` 的 `endOfLocalDayIso`，调用点 14 处：
  `clarify-wizard.tsx:1227`、`projects/[id].tsx:106/202/295`、`(tabs)/projects.tsx:62`、`edit-action-modal.tsx:131`、`clarify-flow.ts:676/699/723`、`use-add-project.ts:19`（注释）、`clarify-flow.test.ts:582-593`。
- **展示**：`packages/core/src/domain/deadline.ts` —— `DEADLINE_SOON_HOURS = 48`（:34）、`deadlineStatus`（:49）、`formatDeadline`（:70 起，已逾期 / 今天截止 / 还剩 N 天）；`apps/mobile/components/deadline-chip.tsx` 是所有列表/详情里唯一的截止渲染口（Tag 的 tone 由状态决定）。

## 2. 提醒（reminders）

- **表**：`packages/db/src/schema.ts:231`（`reminders`：`action_kind` / `action_id` / `fires_at` / `intensity` / `state`），mapper 在 :648 `reminderFromRow` / :659 `reminderToRow`。
- **kind 白名单 = next | calendar | habit**：`packages/db/src/queries/reminders.ts:44` 的 `listScheduledReminders` 三个 LEFT JOIN 只覆盖这三张表，`ScheduledReminderRow.kind: ActionKind`，标题按 kind 解析（habit → 父习惯标题）；`title === null` 语义是「孤儿提醒」，投递层会撤下它在本机待发的通知。**没有 project**。
- **一次性提醒工厂在 core**：`packages/core/src/domain/invariants.ts:407` `snoozeReminderSpec(target)`、`:415` `calendarActionReminderSpec(startsAt, now)`（过去返回 null）、`:430` `habitWindowReminderSpec(...)`；`assertValidReminder`（:209）与 `REMINDER_TRANSITIONS`（`state.test.ts:46`「reminder lifecycle」）约束状态机 —— `cancelled` 是终态。
- **写入模式（要照抄的样板）**：`packages/db/src/queries/actions.ts:484-500`（snooze 事务：先按 `action_id` 把 scheduled 置 cancelled，再 insert 新行）；**取消已有的两处**：`:336`（complete 事务）、`:533`（soft delete / trash 事务）—— 所以行动被完成或删除时，新加的 deadline 提醒会自然被取消。
- **批量重建的另一种样板**：`packages/db/src/queries/habit-reminders.ts` 的 `syncHabitCheckInReminders`（「按期望集合重建、多出来的取消」），本次不需要它（行动提醒是单行、随表单写）。
- **投递**：`apps/mobile/hooks/use-reminder-delivery.ts` —— 挂在根布局，mount / `powersync.onChange`（watchlist 已含 `reminders`、`next_actions`…）/ 前台 / tauri 30s tick 触发；纯决策在 `apps/mobile/lib/reminders/reminder-scheduler.ts`（`computeReconcile`：future+有标题+未 pending → schedule；孤儿+pending → cancel；**总开关关闭时全量撤下**）；适配器 `lib/reminders/adapters/{native,tauri,web,noop}.ts`；权限与总开关在 `hooks/use-reminder-permission.ts` / `lib/notification-settings.ts`。
- **同步链路已有 reminders**：`server/powersync/sync-config.yaml:33`（SELECT ... FROM reminders WHERE deleted_at IS NULL）、`server/powersync/init/02-nextdo-schema.sql:161`（建表）、`server/app/src/db.ts` 上传白名单、`server/deploy/worker.js:8639/9436`（bundle 内的同一份定义）—— **新增行不需要任何服务端改动**。
- **前向兼容风险（项目提醒延后的原因）**：`action_kind` 是同步数据的一部分；旧客户端拿到未知 kind 时 `listScheduledReminders` 的 join 全部落空 → `title === null` → 被当成孤儿，旧设备的投递层会**取消**它本机待发的通知。所以在旧版本仍在线期间不扩枚举。

## 3. 选择器能力

`apps/mobile/components/datetime-picker.tsx:62` 的 props 已经是 `mode: 'date' | 'time' | 'datetime'`，`:29` 有 `DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/`，且有 12/24h、快捷时刻预设、±5/±1 分钟微调（issue #31 已做）—— 所以本次**不需要改 picker**，只要把调用点的 `mode` 与值形状换掉。

## 4. 规范约束

- `app/component-guidelines.md` §Forms：日期/时间一律由 `DateTimePicker` 拥有，禁止手输；字段值保持 `'YYYY-MM-DD'` / `'HH:mm'` 字符串形状（`datetime` 模式是本次新增的第三种形状，需同步补进规范）。
- `project/quality-guidelines.md`「Web 验证门禁」+ 新增的「交互态截图（headless Chrome + CDP）」四条：本次截图脚本按它写。
- 每日回顾的「排期到 YYYY-MM-DD（08:00）」是 snooze（`app/review/daily.tsx:312`，写入 `snoozedUntil`），不是 deadline；它的手输日期违反 §Forms，但**不在本次范围**（已在 PRD Non-goals 里点名）。
