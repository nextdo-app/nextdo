# 现状调研：通知设置与权限请求面（2026-10-17）

结论都来自代码，路径后的行号是核对过的位置（worktree `feat/issues-44-45-46`，基线 f398147）。

## 1. 两条独立的闸门（现行设计）

投递一条提醒要同时满足两层，任何一层不通过都不送：

| 层 | 归属 | 读/写位置 |
| :--- | :--- | :--- |
| App 内总开关 `masterEnabled` | 用户偏好（设备本地） | `apps/mobile/lib/notification-settings.ts`（`{masterEnabled, optInPromptSeen}`，平台矩阵：native→expo-secure-store / web+Tauri→localStorage / Node→内存）；`hooks/use-notification-settings.ts` 读写 + `subscribeToNotificationSettings` |
| OS 通知权限 | 平台事实 | `lib/reminders/adapters/{native,web,tauri}.ts` 的 `permission()` / `requestPermission()` / `openSystemSettings()`；`hooks/use-reminder-permission.ts` 只读状态（mount + 回前台刷新） |

关闭总开关会让 `use-reminder-delivery` 的 reconcile 撤下已排入 OS 的通知（`lib/reminders/reminder-scheduler.ts` 的 `computeReconcile` 输入带 enabled）。

## 2. 现在存在的「手动」入口（issue #45 要动的部分）

1. **首次启动引导弹窗**：`components/notification-optin-dialog.tsx`
   - `NotificationOptinNotifier` 挂根布局（`app/_layout.tsx:58,445`），延迟 1.2s，条件 = `optInPromptSeen===false && permission.status==='undetermined' && (native 或 web 且有 Notification API)`；
   - 「开启通知」= `requestPermission()`，「暂不」= 记 `optInPromptSeen`；两种结果都置位，拒绝后不再自动弹（#24 AC3）；
   - 测试：`__tests__/notification-optin-dialog.test.tsx`。
2. **设置页「提醒与通知」卡片**（`app/(tabs)/settings.tsx:573-720`）：
   - 总开关 + 「应用内通知」文案 + 说明「关掉后不再发送任何提醒，已排入系统的提醒会立即撤销。」；
   - 系统权限块（按平台分支）：web `undetermined` → 「开启通知」按钮；native `undetermined` → 「开启通知」按钮；native `denied` → 说明 + iOS「去系统设置」按钮（Android 只给文案：`expo-notifications` 57 无跳通知设置的 API，已归档任务明确 out of scope）；granted → 纯文案；
   - 习惯打卡子卡（`习惯打卡提醒` 开关 + `全天提醒时刻` picker）—— 功能设置，不属于权限面。
3. **按需申请（唯一的「应用主动」路径）**：`lib/reminders/permission.ts` 的 `maybeRequestNotificationPermission()`
   - 语义：native 且 `undetermined` 才请求；tauri/web no-op；fire-and-forget，被拒不阻塞业务；
   - 调用点只有两处：`hooks/use-snooze-action.ts:43`（稍后成功）、`components/clarify-wizard.tsx:345`（日历行动提交）。
4. **验证脚本**：`scripts/capture-verify-screenshots.mjs:73` 用 localStorage 预置 `{masterEnabled:true, optInPromptSeen:true}` 让截图稳定。

## 3. 平台机制（决定「能不能自动请求」）

- **iOS**：系统授权框一生只弹一次；`denied` 之后只能去系统设置改。`openSystemSettings()` 在 iOS 可用（现有实现）。
- **Android 13+**：`POST_NOTIFICATIONS` 同样只弹一次；`denied` 后需系统设置；会话内最多再弹一次是系统行为。
- **Web / PWA**：浏览器要求**用户手势**触发 `Notification.requestPermission()`；iOS Safari 必须「添加到主屏幕」（`isIosWebSafari()` 判断已存在）。
- **Tauri 桌面**：无请求模型（`permission()` 恒 granted 语义），`openSystemSettings` no-op；应用关闭不投递（既有交付说明已写明）。

## 4. 与 #45 验收标准的差距（映射）

| #45 要求 | 现状差距 |
| :--- | :--- |
| 移除不必要的手动选项 | 三处手动入口：启动弹窗、native 设置页「开启通知」按钮、web 按钮 |
| 移动端由应用主动请求 | 只有 snooze / 日历行动两条按需路径；习惯提醒创建路径**没有**触发请求 |
| 拒绝后给说明与系统设置入口，不反复打扰 | 已有（`denied` 分支 + iOS 按钮；弹窗一次性）；保留 |
| 未授权不显示为「已开启」 | 总开关默认 ON 且与权限块分离陈述，未授权时整卡视觉上仍像「开着」——需要「有效状态」口径 |
| 平台一致体验 | web 依赖手势按钮（机制所限），native 可自动 —— 设计要显式说明并保持文案一致 |

## 5. 相关规范与历史

- `.trellis/spec/app/component-guidelines.md:207` 记录了 #24 的引导弹窗契约（本任务要同步改写）。
- 归档任务 `.trellis/tasks/archive/2026-10/10-16-notification-optin-and-master-switch/`（#24，本次改的就是它交付的两件事）与 `09-30-reminder-notification-delivery/`（投递层 + D4 按需申请）。
- `__tests__/settings-screen.test.tsx`（通知块断言）、`__tests__/reminder-delivery-tauri.test.ts:170,189`（用 `optInPromptSeen` 组 memory store）。
