# 实施计划

## Step 1 — 客户端通道收敛（D1）

- `apps/mobile/lib/notification-settings.ts`：`ReminderDeliveryChannel` 去掉 `both`，`REMINDER_DELIVERY_CHANNELS` 两项；`parseNotificationSettings` 把 `both` 归一为 `calendar`。
- `apps/mobile/app/(tabs)/settings.tsx`：删除 `both` 的 label / hint / icon 条目；补充「专注结束会写入所选日历」的说明。

## Step 2 — 服务端单次投递（D2）

- `server/app/src/reminder-dispatcher.ts`：`dispatchDueReminders` 先查已 `sent` 行；通道循环首个成功即 `break`，失败继续下一通道。
- `server/app/test/reminder-channels.test.ts`：覆盖「多渠道只发一次」「失败回退」「已 sent 不再发」。
- `server/deploy/FREE_CLOUD_DEPLOY.md`、`server/deploy/FEISHU_SYNC_TUTORIAL.md`：把「两个都配会发两次」更新为「按顺序择一，只发一次」。

## Step 3 — 行动事件与提醒去重（D3）

- `apps/mobile/lib/calendar-sync/reminder-plan.ts`：`ReminderCalendarPlanInput` 增加 `coveredReminderIds?: ReadonlySet<string>`，构建 `desired` 时跳过。
- 新增 `reminderIdsCoveredByActionEvents(rows, actions)`（同文件，纯函数）。
- `apps/mobile/hooks/use-calendar-sync.ts`：行动同步开启时计算并传入。
- `apps/mobile/lib/calendar-sync/reminder-plan.test.ts`：补用例。

## Step 4 — 专注事件（D4/D5）

- `apps/mobile/lib/calendar-sync/reconcile.ts`：`CalendarSyncEventSpec.alarm?: boolean`，写入签名。
- `apps/mobile/lib/calendar-sync/device.ts`、`desktop.ts`：按 `alarm` 决定闹铃。
- `apps/desktop/src-tauri/src/calendar.rs`：`alarmOffsetMinutes` 缺省 = 不添加闹铃。
- 新增 `apps/mobile/lib/calendar-sync/focus-event.ts` + `focus-event.test.ts`。
- `apps/mobile/lib/calendar-sync/store.ts`：state v4，新增 `focusMappings` / `focusRecordSince`。
- `apps/mobile/hooks/use-calendar-sync.ts`：第三条通道，与行动事件同一个 `calendarEnabled` 开关；watch 表加 `focus_sessions`。

> 实现取舍：专注记录挂在日历同步引擎里，而不是在 `use-focus-session.complete()` 里直接调
> 写入。引擎本来就在监听表变更，`completeFocusSession` 写入 `ended_at` 后它自己会把会话
> 变成事件；这样专注页不必知道日历的存在，也不会出现「页面已卸载就漏写」的分支。

## Step 5 — 验证

```bash
pnpm lint && pnpm typecheck && pnpm -r test
pnpm verify:web
```

- 浏览器实测：`.verify/10-27-single-reminder-and-focus-calendar/` 下四张截图 + `evidence.md`。
- 桌面端 Rust 改动：`cargo check`（`apps/desktop/src-tauri`）；真机手测需 `npx expo prebuild` 后重建。

## 实施结果

| 项 | 结果 |
| :--- | :--- |
| `pnpm verify:web`（lint → typecheck → test → build:web） | 全绿，静态服务器在 4180 起来（HTTP 200） |
| `apps/mobile` jest：`lib/calendar-sync` | 5 suites / 48 tests 通过（含新增 focus-event） |
| `server/app` jest：reminder 通道 | 由 `pnpm test` 全量覆盖并通过 |
| `cargo check`（desktop，Rust 日历 alarm 改动） | 见下方收尾记录 |
| 浏览器实测 | 截图 01–04，控制台零报错 |
