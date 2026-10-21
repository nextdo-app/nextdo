# 实施计划：移动端开屏图标、更新自动安装与通知权限请求

## 分步实施

### Step 1: 规范配置与 spec 关联
- 在 `app.json` 中添加 `splash` 配置。
- 通过 `task.py add-context` 关联相关 spec，并通过 `task.py validate` 与 `task.py start`。

### Step 2: 修复应用内自动安装逻辑（app-update & UI）
- 修改 `apps/mobile/lib/app-update.ts`：实现 `resolveAndroidContentUri`，通过 `expo-file-system/legacy` 的 `getContentUriAsync` 获取合法 `content://` URI。
- 修改 `apps/mobile/components/auto-update-dialog.tsx`：下载完成后自动调用 `installAndroidUpdate` 唤起安装器。
- 修改 `apps/mobile/app/(tabs)/settings.tsx`：支持 Android 走应用内下载及立即安装操作。
- 更新测试：`__tests__/auto-update-dialog.test.tsx` 与 `lib/app-update.test.ts`。

### Step 3: 修复 Android 通知权限申请
- 修改 `apps/mobile/lib/reminders/adapters/native.ts`：在 `requestPermission` 中调用 `await ensureChannels()`。
- 修改 `apps/mobile/lib/reminders/permission.ts`：`maybeRequestNotificationPermission` 允许 `state.status === 'denied' && state.canAskAgain` 时发起请求。
- 修改 `apps/mobile/app/(tabs)/settings.tsx`：更新 `notificationActionFor` 与 `describeNotificationState`，对 `canAskAgain: true` 的 native 状态显示「开启通知」而非「去系统设置」。
- 更新测试：`__tests__/settings-screen.test.tsx` 补充针对 `status: 'denied', canAskAgain: true` 的用例。

### Step 4: 质量门禁与验证
- 运行 `apps/mobile` 单元测试与 `pnpm verify:web`。
- 确认全部通过后提交提交计划。
