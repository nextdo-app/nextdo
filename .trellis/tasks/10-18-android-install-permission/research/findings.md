# 调研记录

## 1. 发布 APK 证据（v0.1.8-beta.1）

从 release 下载的 `nextdo.apk` 直接读 `AndroidManifest.xml`（AXML，按 UTF-16LE 匹配字符串池）：

| 权限 | 是否出现 |
| --- | --- |
| `REQUEST_INSTALL_PACKAGES` | False |
| `SCHEDULE_EXACT_ALARM` | False |
| `USE_EXACT_ALARM` | False |
| `POST_NOTIFICATIONS` | True（对照组，证明扫描有效） |

## 2. 配置被忽略的原因

```bash
grep -rn "manifestPermissions" node_modules/.pnpm/expo-build-properties@57.0.22_*/node_modules/expo-build-properties/build
# NOT FOUND
```

SDK 57 的插件 schema 里没有该字段，`app.json` 写错键名不会报错，构建静默丢弃。

## 3. 其他开源应用的做法（Obtainium / Telegram）

- APK 下载到应用私有目录；
- 通过自家 `FileProvider` 暴露为 `content://`；
- 清单声明 `REQUEST_INSTALL_PACKAGES`；
- `Intent(ACTION_VIEW)` + `application/vnd.android.package-archive` + `FLAG_GRANT_READ_URI_PERMISSION`；
- 首次安装前引导用户打开「安装未知应用」开关（`ACTION_MANAGE_UNKNOWN_APP_SOURCES`）；
- 用户在系统安装页确认。普通应用无法静默安装。

## 4. 依赖库源码核对

- `expo-intent-launcher` 57.0.1 `IntentLauncherModule.kt`：data 与 type 同时存在时调用 `setDataAndType`，否则分别赋值 —— 不存在 type 覆盖 data 的问题。
- `expo-file-system` 57.0.7：`file_system_provider_paths.xml` 同时声明 `files-path` 与 `cache-path`；provider authority 为 `${applicationId}.FileSystemFileProvider`；`contentUri` 属性在 `FileSystemModule.kt:231` 实现。

## 5. 发布流水线

`.github/workflows/release.yml` 由 `v*` tag 推送或 `workflow_dispatch` 触发；Android 走 runner 本地 `eas build --local`。因此发布 = 六处版本 bump + 提交 + 打 tag 推送。
