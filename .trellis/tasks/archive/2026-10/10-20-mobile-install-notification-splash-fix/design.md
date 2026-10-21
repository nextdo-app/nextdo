# 技术设计：移动端开屏图标、更新自动安装与通知权限请求

## 1. 开屏图标（Splash Screen）

在 `apps/mobile/app.json` 的 `expo` 节点下增加：
```json
"splash": {
  "image": "./assets/icon.png",
  "resizeMode": "contain",
  "backgroundColor": "#0f202b"
}
```
这样 EAS build 与 expo prebuild 生成 Android 12+ SplashScreen 和原生启动屏时，会采用 Nextdo 自身的深色背景与品牌图标，避免展示 Expo 默认空白/占位图标。

## 2. 应用内自动更新架构（Android Install & Content URI）

### 2.1 根因与修复
- 根因：Expo SDK 57 的 `expo-file-system` 新 API（`File` 类）不带 `contentUri` 属性。原实现通过 `new fs.File(fileUri).contentUri` 读取得到 `undefined`，导致 `expo-intent-launcher` 无法在 Intent 中设置 `data`，Android 安装器接收不到 APK 地址而静默忽略。
- 契约方案：
  在 `apps/mobile/lib/app-update.ts` 中引入辅助函数 `resolveAndroidContentUri(fileUri: string): Promise<string>`：
  优先尝试 `require('expo-file-system/legacy').getContentUriAsync(fileUri)`；为了保持与 Jest Mock 环境的兼容，若 Mock 提供了 `getContentUriAsync` 或直接提供了 `file.contentUri`，也能优雅回退。
- `installAndroidUpdate` 调用 `resolveAndroidContentUri`，并将合法 `content://` URI 以及 `flags: 1`（`FLAG_GRANT_READ_URI_PERMISSION`）传给 `startActivityAsync('android.intent.action.VIEW', ...)`。

### 2.2 自动完成安装（Auto Install）
- `components/auto-update-dialog.tsx`：当 `downloadAndroidUpdate` 成功解析出 `fileUri` 后，直接调用 `await installAndroidUpdate(fileUri)` 唤起安装器。若用户取消或系统关闭，界面仍呈现「立即安装」按钮以备手动点击。
- `app/(tabs)/settings.tsx`：将下载更新与安装按钮从 `update.isDesktop` 放宽为 `(update.isDesktop || update.canInstallInApp)`，保证安卓在设置页中也能走应用内下载与自动安装流程。

## 3. Android 通知权限请求逻辑

### 3.1 根因与修复
- 根因：在 Android 13+ 上，未授权前 `NotificationManagerCompat.areNotificationsEnabled()` 为 false，`expo-notifications` 的 `NotificationPermissionsModule.kt` 直接将 `status` 返回为 `'denied'`，但附带 `canAskAgain: true`。
  原代码误以为 `'denied'` 一律代表用户已在系统层拒绝，因此直接跳转系统设置，完全没有弹出请求授权弹窗。
- 修正状态机：
  - `status === 'granted'` -> 授权已满足，无需动作。
  - `status === 'undetermined' || (platform === 'native' && status === 'denied' && canAskAgain)` -> 仍可向系统申请，对应动作 `'native-request'`，界面显示「开启通知」，调用 `requestPermission()` 触发系统授权弹窗。
  - `status === 'denied' && !canAskAgain` -> 用户勾选了不再询问或系统策略阻止，只能去系统设置，对应动作 `'open-system-settings'`，界面显示「去系统设置」。
- 前置渠道保障：
  在 `apps/mobile/lib/reminders/adapters/native.ts` 的 `requestPermission` 中先执行 `await ensureChannels()`，满足 Android 13+ 弹出权限框必须存在有效通知渠道的系统要求。
