# 实施计划：提醒接入系统日历通知通道 + 行动备注与点击编辑

## 执行顺序

1. **数据层：`note` 列**
   - `packages/core/src/domain/types.ts`：`NextAction.note`、`CalendarAction.note`；
   - `packages/core/src/engine/types.ts`：`CandidateBase.note`；
   - `packages/db/src/schema.ts`：两张表 `note` 列，`nextActionFromRow / nextActionToRow / calendarActionFromRow / calendarActionToRow` 双向映射；新行默认 `note: null`；
   - `packages/db/src/queries/actions.ts`：`addNextAction` / `updateNextAction` 处理 `note`（空串→`null`）；
   - `packages/db/src/queries/calendar.ts`：同上（`addCalendarAction` / `updateCalendarAction`）；
   - `packages/db/src/queries/pool.ts`：候选查询带出 `note`；
   - 服务端：`server/app/src/db.ts` 白名单、`schema-init.ts` DDL、`powersync/sync-config.yaml`、`powersync/init/02-nextdo-schema.sql`；
   - 验证：`packages/db` 测试（含 schema/mapper/查询）。

2. **提醒通道设置**
   - `apps/mobile/lib/notification-settings.ts`：`ReminderDeliveryChannel` + `reminderChannel`（默认 `app`，未知值回落 `app`）；
   - `apps/mobile/hooks/use-reminder-delivery.ts`：`calendar` + native 时停止 App 投递（并取消已排队通知）；
   - 验证：`notification-settings` 相关测试 + 类型检查。

3. **提醒 → 日历纯逻辑**
   - `packages/db/src/queries/reminders.ts`：行增加 `note` 与 `estMinutes`；
   - `apps/mobile/lib/calendar-sync/reminder-plan.ts`：`reminderEventSpec` / `buildReminderCalendarPlan`；
   - `apps/mobile/lib/calendar-sync/reconcile.ts`：签名纳入 `notes`，`CalendarSyncEventSpec` 增加 `notes?`；
   - `apps/mobile/lib/calendar-sync/store.ts`：`reminderMappings` 持久化（旧存档缺省 `{}`）；
   - `apps/mobile/lib/calendar-sync/device.ts`：事件描述用备注、闹钟保持 0 分钟；
   - `apps/mobile/hooks/use-calendar-sync.ts`：按 `reminderChannel !== 'app'` 跑提醒通道，与日历事项开关独立；
   - 测试：`lib/calendar-sync/reminder-plan.test.ts`（9 例）。

4. **UI：编辑与展示**
   - `apps/mobile/components/edit-action-modal.tsx`：备注输入（多行，最后一栏），保存时空串写 `null` 语义（提交 `note.trim()`）；
   - `apps/mobile/hooks/use-update-next-action.ts`：`note` 透传；
   - `apps/mobile/app/(tabs)/now.tsx`：候选带 `note`、整行点击打开编辑器、卡片展示备注；
   - `apps/mobile/app/(tabs)/settings.tsx`：提醒方式三选一（日历需权限；`denied` 显示退回提示）。

5. **验证**
   - `pnpm lint`、`pnpm typecheck`；
   - `pnpm -r test`：`packages/db` 331 例、`server/app` 104 例、`apps/mobile` 674 例（1 例为既有的日期相关失败，见下）；
   - 浏览器实测：设置页通道选择与持久化、事项备注写入并回显、点击卡片打开编辑 → 截图存 `.verify/10-21-reminder-calendar-channel-and-action-notes/` 并写 `evidence.md`。

## 已知限制与既有问题

- `apps/mobile/__tests__/habits-screen.test.tsx` 的「no backfill window」用例在 2026-10-22 当天失败：它按 `dayKey(-21)` 计算格子，而月历网格在月末会同时出现两个「日 1」标签（10-01 与 11-01），属于**日期相关、与本次改动无关**的既有测试；不在本任务内修。
- 原生日历的端到端行为（iOS 真实弹闹钟）需要真机/模拟器 + `npx expo prebuild`，本地只能做到纯逻辑与 web 侧验证；真机验收项保留在 PRD AC 中。
