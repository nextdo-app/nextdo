# 通知：首次主动申请授权 + App 内通知总开关

## Goal

issue #24：首次进入主动引导并申请通知授权，设置页提供 App 内通知总开关（即时生效、可持久化），拒绝后不反复弹窗。

## Background（现状，含代码锚点）

- `apps/mobile/lib/reminders/permission.ts` 的 `maybeRequestNotificationPermission()` 是当前唯一的主动请求路径：只在**首次创建提醒的业务动作**（snooze / clarify 提交日历行动）时触发，且仅 native + `undetermined`。用户在此之前完全不知道有通知功能（issue #24 问题 1）。
- `apps/mobile/hooks/use-reminder-permission.ts` 是设置页的只读权限状态 hook（mount 与回到前台时刷新）。
- `apps/mobile/app/(tabs)/settings.tsx` 的「提醒通知」卡片只渲染 OS 权限状态；native `undetermined` 分支**只有文案、没有申请按钮**。
- 没有 App 内总开关：投递完全由 OS 权限决定 —— `apps/mobile/hooks/use-reminder-delivery.ts` 的 reconcile 只看业务数据。
- `apps/mobile/lib/reminders/reminder-scheduler.ts` 的 `computeReconcile(input)` 是纯函数，输入 `{mode, now, rows, pendingIds, firedIds?, sessionStart?}`，输出 `{toSchedule, toCancel, toFireNow}`。
- 本地偏好持久化的既有模式：`apps/mobile/lib/habit-reminders.ts`（native → `expo-secure-store`；web/Tauri → `localStorage`；其它 → 内存；带 `__setXForTests`）。
- 一次性弹窗的既有模式：`apps/mobile/components/ios-install-prompt.tsx`、`apps/mobile/components/auto-update-dialog.tsx`（均在根布局挂载）。

## Requirements

- R1 **首次主动引导**：首次进入 App（尚未引导过且 OS 权限为 `undetermined`）时展示一次性说明弹窗，解释通知用途；点主按钮即发起授权申请，点次按钮关闭且不再自动弹。
  - 仅在用户尚未表态（`undetermined`）时出现；`granted` / `denied` 都不再出现。
  - 拒绝后**永不**自动再弹（issue #24 问题 3 / 验收标准 3）。
- R2 **App 内通知总开关**：设置页「提醒通知」卡片新增开关。关闭 = 不再投递任何提醒通知，并撤销已排入 OS 的待发通知；打开 = 恢复投递。即时生效、持久化（issue #24 验收标准 2）。
- R3 开关与 OS 权限是两个独立层：OS 未授权时开关打开也不能投递 —— 界面必须同时说清「App 内开关」与「系统权限」，不得互相伪装。
- R4 开关默认 = 开（保持既有用户行为：现在没有开关时通知是投递的）。
- R5 保留既有「首次创建提醒时按需申请」作为兜底（开关开 + 权限未定 + native 时仍然请求）。

## Acceptance Criteria

- [ ] AC1 全新设备（无本地偏好、OS 权限 `undetermined`）首次进入 App 会看到通知授权引导弹窗；点主按钮发起系统授权申请。
- [ ] AC2 弹窗被「暂不」关闭后，之后启动不再自动出现；设置页仍有入口可再次申请 / 去系统设置。
- [ ] AC3 设置页总开关切换**立即生效**：关闭后已排入 OS 的待发提醒被撤销，重新打开后按业务数据重新排程。
- [ ] AC4 开关状态持久化：关掉后重启 App 仍是关。
- [ ] AC5 开关关闭时 `computeReconcile` 不产生任何 `toSchedule` / `toFireNow`，并把全部 pending 撤回（纯函数单测）。
- [ ] AC6 OS 权限 `denied` + 开关为开时，界面明确区分两者，且不重复弹窗。
- [ ] AC7 既有 snooze / clarify 触发的按需申请不回归（原有测试仍通过）。

## Out of Scope

- Android 跳系统通知设置页（`expo-notifications` 57 无对应 API，维持文案引导）。
- 通知分组、免打扰时段、按类型细分开关。
- 修改 OS 权限本身语义（`denied` 不伪装成可再次弹窗）。

## Open Questions

（无）
