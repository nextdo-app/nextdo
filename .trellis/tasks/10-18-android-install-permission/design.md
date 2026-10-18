# Android 应用内安装无响应 技术设计

## 根因

`expo-build-properties` 在 SDK 57 的插件 schema 中没有 `android.manifestPermissions`，配置被静默忽略，发布 APK 因此缺少三条权限。`expo-file-system`、`expo-intent-launcher` 的实现本身没有问题，无需改动安装链路。

## 改动边界

| 文件 | 改动 |
| --- | --- |
| `apps/mobile/app.json` | 权限迁到 `expo.android.permissions`，删除无效键 |
| `apps/mobile/lib/app-update.ts` | 新增 `openAndroidInstallPermissionSettings()`；补充安装前置条件注释 |
| `apps/mobile/components/auto-update-dialog.tsx` | done 态与失败态接入授权页入口 |
| `apps/mobile/lib/reminders/adapters/native.ts` | Android 通知设置深链带包名，失败回退应用详情页 |
| `apps/mobile/app/(tabs)/settings.tsx` | 已拒绝状态双平台渲染「去系统设置」 |
| `apps/mobile/__tests__/android-manifest-permissions.test.ts` | 新增配置回归测试 |

## 关键契约

- **安装 Intent**：`ACTION_VIEW` + `content://` URI + `application/vnd.android.package-archive` + `FLAG_GRANT_READ_URI_PERMISSION(1)`。`expo-intent-launcher` 同时收到 data 与 type 时使用 `setDataAndType`，不会互相覆盖（已核对 Kotlin 源码）。
- **FileProvider**：`${applicationId}.FileSystemFileProvider`，paths 覆盖 `files-path` 与 `cache-path`，APK 下载到 cache 目录可被暴露。
- **授权页**：`ACTION_MANAGE_UNKNOWN_APP_SOURCES` 的 data 必须是 `package:<applicationId>`；部分 ROM 无此 Activity，需 catch 后回退 `ACTION_APPLICATION_DETAILS_SETTINGS`。
- **回归测试**：直接读文件而非 import JSON，避开 jest 对 JSON 模块的额外配置。

## Tradeoffs

- 保留 `ACTION_VIEW` 而非 `ACTION_INSTALL_PACKAGE`：前者是 Obtainium / Telegram 的通行做法，后者在新系统上已被弱化。
- 不引入第三方安装库：现有 `expo-intent-launcher` 已足够。
- 回归测试断言「包含」而非「全等」，允许后续追加权限。

## 兼容性 / 回滚

- beta 线继续 `0.1.x-beta.N`；已发布的 `0.1.8-beta.1` 不受影响。
- 回滚方式：还原 `app.json` 权限块即可，无数据迁移。
