# 修复移动端开屏图标、更新自动安装无响应与通知权限请求

## Goal

彻底修复移动端三个关键体验问题：
1. `app.json` 补充 `splash` 开屏配置，避免 Android 冷启动时显示 Expo 默认占位图标。
2. 修复 Android 应用内自动更新：使用 `expo-file-system/legacy` 的 `getContentUriAsync` 获取合法 `content://` URI；下载完成后自动触发安装器，并在设置页支持 Android 应用内下载安装。
3. 修复 Android 通知权限申请：适配 Android 13+ 在 `areNotificationsEnabled()` 为 false 时 `getPermissionsAsync()` 返回 `status: 'denied'` 但 `canAskAgain: true` 的机制，优先引导弹窗授权，仅在 `!canAskAgain` 时跳转系统设置；并在申请前确保 Android 通知渠道已建立。

## Requirements

1. **开屏图标规范化**：
   - 在 `apps/mobile/app.json` 中配置 `splash`，指向应用图标 `./assets/icon.png`，背景色设置为 `#0f202b`，`resizeMode: "contain"`。
2. **应用内更新自动安装与 contentUri 修复**：
   - 修复 `installAndroidUpdate`：通过 `expo-file-system/legacy` 的 `getContentUriAsync`（底层调用 `FileProvider.getUriForFile`）获取正确的 `content://` URI。
   - 在 `AutoUpdateDialog` 中，下载完成后自动调用 `installAndroidUpdate` 唤起安装，无需等待用户二次点击。
   - 在 `settings.tsx` 中，允许 Android（`canInstallInApp` 为 true 时）同桌面端一样使用应用内下载，并同步进度条与安装按钮。
3. **Android 通知权限请求链路打通**：
   - 在 `apps/mobile/lib/reminders/adapters/native.ts` 中，`requestPermission()` 调用 `Notifications.requestPermissionsAsync` 之前确保 `ensureChannels()` 已经执行。
   - 在 `apps/mobile/app/(tabs)/settings.tsx` 中，`notificationActionFor` 对 native 平台放宽条件：当 `status === 'undetermined'` 或 `(status === 'denied' && canAskAgain)` 时均返回 `'native-request'`（显示「开启通知」按钮并触发请求），仅当 `status === 'denied' && !canAskAgain` 时返回 `'open-system-settings'`。
   - 在 `describeNotificationState` 中，当 `status === 'denied' && canAskAgain` 时，状态标题保持为「等待系统授权」，详情引导用户点下方按钮开启通知。
   - 在 `apps/mobile/lib/reminders/permission.ts` 中，`maybeRequestNotificationPermission` 在 `state.status === 'undetermined' || (state.status === 'denied' && state.canAskAgain)` 时尝试触发请求。

## Acceptance Criteria

- [ ] `app.json` 中包含合法的 `splash` 声明，指向 `./assets/icon.png` 并与主题色 `#0f202b` 一致。
- [ ] `apps/mobile/lib/app-update.ts` 成功通过 `getContentUriAsync` 获取 `content://` URI，不再访问未定义的 `new fs.File().contentUri`。
- [ ] `auto-update-dialog.tsx` 在 Android 端下载完成时自动调起 `installAndroidUpdate`。
- [ ] `settings.tsx` 中对 Android 端提供应用内下载安装入口，不再直接跳外部浏览器。
- [ ] `notificationActionFor` 在 native 端且 `canAskAgain: true` 时返回 `'native-request'`，用户可见「开启通知」按钮并可触发系统权限弹窗。
- [ ] 所有单元测试与类型检查全部通过（`pnpm verify:web` 与 mobile 单元测试）。
