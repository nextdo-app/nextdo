# Android 应用内安装无响应（缺失 REQUEST_INSTALL_PACKAGES）

## Goal

修复 Android 端「应用内下载更新 → 点『立即安装』无任何反应」，让应用内更新真正调起系统安装器；同时补齐被同一个配置错误吞掉的精确闹钟权限，并为这次静默失效加上回归保护。完成后发布一个 beta 包。

## Background

v0.1.8-beta.1 的发布 APK 里，`REQUEST_INSTALL_PACKAGES`、`SCHEDULE_EXACT_ALARM`、`USE_EXACT_ALARM` 三条权限全部缺失（已用二进制 AndroidManifest 扫描验证）。它们原本写在 `expo-build-properties` 的 `android.manifestPermissions` 下，而 SDK 57 的该插件没有这个选项，构建时被静默丢弃。没有 `REQUEST_INSTALL_PACKAGES` 时，Android 会丢弃安装 Intent，用户看到的就是「点了没反应」。

## Requirements

1. **清单权限**
   - 在 `apps/mobile/app.json` 的 `expo.android.permissions` 中声明 `REQUEST_INSTALL_PACKAGES`、`SCHEDULE_EXACT_ALARM`、`USE_EXACT_ALARM`；
   - 删除 `expo-build-properties` 下无效的 `android.manifestPermissions` 键。

2. **应用内安装引导（对齐 Obtainium 等开源实现）**
   - 新增打开「安装未知应用」授权页的能力：`ACTION_MANAGE_UNKNOWN_APP_SOURCES` + `package:<applicationId>`，失败回退应用详情页；
   - 更新弹窗在「安装包已下载」状态常驻自救入口；安装启动失败时同样给出入口；
   - 保持安装三要素不变：`content://` URI、`FLAG_GRANT_READ_URI_PERMISSION`、MIME `application/vnd.android.package-archive`。

3. **通知权限（同轮相关修复）**
   - 被拒绝后 Android 设置页也给出「去系统设置」，深链 `ACTION_APP_NOTIFICATION_SETTINGS` 带包名；iOS 维持 `app-settings:`。

4. **回归保护**
   - 新增测试读取 `app.json` 断言三条权限存在——这次故障正是因为没有东西校验配置键。

## Acceptance Criteria

- [ ] `npx expo config --type public --json` 解析出的 `android.permissions` 含三条权限，且不再有 `manifestPermissions`。
- [ ] `__tests__/android-manifest-permissions.test.ts` 通过。
- [ ] 相关 jest 套件与 `tsc --noEmit` 通过。
- [ ] 版本号六处同步 bump 并发布 beta 包，release 产出的 APK 能扫到 `REQUEST_INSTALL_PACKAGES`。
- [ ] 发布说明写明：旧版本自身缺权限，需手动安装一次。

## Out of Scope

- 静默安装（仅 Device Owner / 系统应用 / Shizuku 可行）；
- iOS 侧应用内安装（系统不允许）。
