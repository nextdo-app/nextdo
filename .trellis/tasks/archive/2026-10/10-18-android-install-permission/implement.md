# Android 应用内安装无响应 实施计划

## 清单

- [x] 1. 用发布 APK 的二进制 AndroidManifest 证明权限缺失，并定位到 `expo-build-properties.android.manifestPermissions` 被忽略。
- [x] 2. `app.json` 权限迁至 `expo.android.permissions`，删除无效键；`expo config` 复核。
- [x] 3. `lib/app-update.ts` 新增 `openAndroidInstallPermissionSettings()` 并补充前置条件注释。
- [x] 4. 更新弹窗接入授权页入口（done 态 + 失败态）。
- [x] 5. 设置页 Android 已拒绝状态渲染「去系统设置」；适配器深链带包名。
- [x] 6. 新增 `__tests__/android-manifest-permissions.test.ts`。
- [ ] 7. 六处版本号 bump 至 `0.1.9-beta.1`。
- [ ] 8. 三阶段提交（业务改动 → 任务归档 → journal）。
- [ ] 9. 打 tag 触发 release 工作流，产物发布后扫描 APK 复核权限。

## 验证命令

```bash
cd apps/mobile
npx expo config --type public --json | node -e "..."      # 权限块
npx jest __tests__/android-manifest-permissions.test.ts \
         __tests__/notification-state.test.ts \
         __tests__/auto-update-dialog.test.tsx \
         __tests__/settings-screen.test.tsx
npx tsc --noEmit
```

发布后：

```bash
python3 - <<'PY'
import zipfile
d = zipfile.ZipFile('<apk>').read('AndroidManifest.xml')
for k in ['REQUEST_INSTALL_PACKAGES','SCHEDULE_EXACT_ALARM','POST_NOTIFICATIONS']:
    print(k, k.encode('utf-16-le') in d or k.encode() in d)
PY
```

## 回滚点

- 代码：单个提交即可回滚，无迁移。
- 发布：tag 与 GitHub Release 可删除重发，已安装用户不受影响。

## 已知限制

旧版本（v0.1.8-beta.1）自身缺少权限，无法应用内升级到新版本，需手动安装一次；从新版本起自更新恢复。
