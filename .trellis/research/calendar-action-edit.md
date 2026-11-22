# 日历行动编辑（issue #95）

状态：已实现，2026-11-20。浏览器实测结果见下文「验证」；系统日历同步只能在原生端验证。

## 背景与范围

- 缺口：日历行动只能创建、推迟、跳过、删除，改标题或时间只能删除重建（issue #95）。
- 入口：Now 行动菜单「编辑行动」。行动行、推荐卡溢出菜单都走同一个 `handleEdit`。
- 可编辑字段：标题、开始时间、预估时长、截止时间、备注。
- 不做：新建日历行动的独立编辑页；项目详情页（日历行动没有 `projectId`）；
  状态 / 价值 / 分类（表单不拥有，编辑时保持原值）。

## 实现

- DB：`packages/db/src/queries/calendar.ts` 的 `updateCalendarAction`（已存在但未导出）
  现在从 `packages/db/src/index.ts` 导出。它是「编辑表单」更新：在写事务内重读
  当前行，只取表单拥有的字段（title / startsAt / estMinutes / deadline / note /
  updatedAt），其余字段（status、value、category、contextIds、snooze 状态、
  跳过期、来源 id）取当前行。这样另一台设备在表单打开期间完成或删除该行动时，
  旧表单不会把它写回 open；已删除行报 `calendarAction.not-found`。
  同一事务内，`startsAt` 变化时重建自动提醒：
  - 取消该行动的 `scheduled` + `important` 提醒；
  - 新开始时间仍在 60 分钟内 → 插入新的 `startsAt − 15 min` 提醒；
  - 新开始时间更远 → 只取消，不插入；
  - 未来 `snoozedUntil` 存在且标题未变 → 不动提醒（snooze 拥有该提醒）；
  - 行动不是 `open` → 不重建提醒（完成时已取消）；
  - 开始时间变化且标题未变时，`normal` 提醒（snooze 目标）不取消。
  - `title` 变化时，同一事务内把该行动的每个未来 `scheduled` 提醒换成新 id
    （`fires_at` 与 intensity 不变）。原生通知按 reminder id 去重：保留 id 时
    pending 通知不会重排，正文会一直是旧标题。过去的提醒行不动，避免把即将
    触发的通知换成一条不会被重排的过去行。
- 客户端 hook：`apps/mobile/hooks/use-update-calendar-action.ts`。
  先 `listCalendarActions` 找到 live 行，再 `{ ...live, ...patch, updatedAt }`。
  不直接用 pool 候选重建行，避免丢掉 value / category / status / sourceInboxId。
- 弹窗：`apps/mobile/components/calendar-edit-modal.tsx`。字段与 dirty 跟踪：
  - `startsAt` / `deadline` 未改动时不出现在 patch 中，保留原 ISO（含秒和时区）；
  - 清空截止时间是显式改动，写 `undefined`（NULL）；
  - 纯日期截止（本地 23:59:59 哨兵）回填为 `YYYY-MM-DD`，字段显示「12月1日」；
    只改日期时写回新日期的 23:59:59；
  - 开始时间与截止时间用真实 `DateTimePicker`（datetime 模式）。datetime 模式
    接受纯日期值作为初始值（`dateOnlyDatetimeMatch`），纯日期截止不会跳到今天。
  - 所有 hook 调用都在 `if (!visible || action === null) return null` 之前，
    首次打开弹窗不改变 hook 顺序。
- Now 屏：`apps/mobile/app/(tabs)/now.tsx` 的 `editingCalendar` 状态与
  `<CalendarEditModal>`；习惯行 `canEdit=false`，下一步行动仍走 `EditActionModal`。

## 提醒与系统日历

- 应用内提醒由 `reminders` 行驱动：编辑开始时间即改提醒时间；编辑标题会把
  未来提醒行换成新 id，交付层据此取消旧通知并按新标题重排。编辑成功后
  PowerSync watch 让 Now 卡片和提醒计划一起重读。
- 系统日历事件由 `lib/calendar-sync/reconcile.ts` 按签名（title / startsAt /
  endsAt / notes）从 `calendar_actions` 行派生，编辑落库后自动更新或删除事件。
  该同步只在原生端（Expo / Tauri）运行，Web 浏览器无法验证。

## 测试

- `packages/db/src/test/queries.collections.test.ts`（28/28）：
  - 开始时间 10:30 → 10:45，提醒跟随且旧行 `cancelled`；
  - 移到 60 分钟外，提醒被取消且不重插；
  - 只改标题：未来提醒换新 id，`fires_at` / `important` 不变；旧行 `cancelled`；
    `listScheduledReminders` 读到新标题；
  - 只改标题且存在 snooze：normal 提醒换新 id，snooze 时刻不变，读到新标题；
  - 只改标题且提醒时刻已过：提醒行 id 不变，不重排过去提醒；
  - 未来 snooze 存在时编辑开始时间，不插入 important 提醒，snooze 行 id 不变；
  - 表单打开期间另一设备完成行动：旧表单保存后 `status` 仍为 `done`，且不重建提醒；
  - 表单打开期间行动被删除：保存报 `calendarAction.not-found`，行仍是删除态。
- `apps/mobile/__tests__/now-screen.test.tsx`（50/50）：
  - 标题编辑保留 `startsAt` 秒与 category / sourceInboxId / status；
  - 纯日期截止回填为「12月1日」，只改标题时保留 23:59:59 哨兵；
  - 通过真实 picker 改纯日期截止的日期，写回新日期的 23:59:59 哨兵；
  - 通过真实 picker 改开始日期；
  - 写入失败时弹窗与输入保留，重试成功。
- `apps/mobile/lib/reminders/reminder-scheduler.test.ts`（20/20）：
  - 标题编辑后：旧 pending id 进入 `toCancel`，新行带新标题进入 `toSchedule`，
    `firesAt` 不变。
- 合起来覆盖「DB 换行 → 交付计划取消旧通知并重排新标题」整条链路。

## 验证

- 门禁：`pnpm verify:web --no-serve` 通过（退出码 0）。测试合计 1655：
  core 275、server 133、db 378、mobile 869；lint、typecheck、web 构建均通过。
  now-screen 套件中 `CalendarEditModal` 不产生 hook 顺序警告。
- 浏览器实测（headless Chrome，2026-11-20）：从收件箱记录并澄清一条
  「产品周会」，设为当天开始时间 18:37、预估 30 分钟，Now 页显示卡片。
  打开「更多操作 → 编辑行动 → 编辑日历行动」：
  - 改标题为「产品周会（改）」、开始时间 18:47、预估 20 分钟、截止 18:57、
    备注「会议室 B，带上数据看板」；保存后卡片显示新标题、`开始 18:47` 与
    「20 分钟」标签。重新打开弹窗，截止时间字段与备注输入仍是保存值。
  - 纯日期截止：清除截止后打开空选择器，选「明天」并直接确定（不碰时间轮），
    保存并重开；字段显示「截止时间，当前 11月21日」，没有时刻。
  - 注入一次 `update calendar_actions` 的 APPLY 失败（Comlink 层拦截）：
    弹窗保持打开，错误「injected calendar write failure」可见，标题输入保留
    「产品周会（失败）」，背后卡片仍是旧标题；故障只触发一次，重试保存成功，
    卡片更新为新标题。
- 未验证：原生系统日历事件的更新与通知正文的实际重排（需要 macOS / iOS 构建）；
  提醒实际送达。提醒行内容（新标题、原 firesAt / intensity、snooze 时刻）由
  `packages/db/src/test/queries.collections.test.ts` 覆盖。
