# 技术设计 — 安卓端应用内安装更新与桌面端设置页宽度统一

## 1. 架构与边界

### 1.1 模块边界
- `apps/mobile/lib/app-update.ts`：纯逻辑层，负责 ABI 判定（`pickAndroidAbi`）、更新包 URL 拼接、`downloadAndroidUpdate` 与 `installAndroidUpdate`，按需懒加载 `expo-file-system` 与 `expo-intent-launcher`。
- `apps/mobile/components/auto-update-dialog.tsx`：更新弹窗视图，通过 `canInstallUpdateInApp()` 区分 Android 应用内下载流与桌面端/浏览器流，维护下载进度与安装状态。
- `apps/mobile/hooks/use-app-update.ts`：设置页更新卡片的状态机，暴露统一的 `download`、`installUpdate` 接口。
- `apps/mobile/app/(tabs)/settings.tsx` & `apps/mobile/app/(tabs)/review.tsx`：视图层，统一容器类名。

---

## 2. 详细设计

### 2.1 安卓应用内更新机制

```
  AutoUpdateDialog / useAppUpdate
              │
              ▼
  [检测平台 Platform.OS === 'android']
              │
              ├──> detectAndroidAbi() → pickAndroidAbi(supported) → 选择指定 ABI 的 APK URL
              │
              ├──> downloadAndroidUpdate(url, onProgress)
              │       └─> expo-file-system File.downloadFileAsync(url, target, { idempotent: true })
              │
              └──> installAndroidUpdate(fileUri)
                      ├─> 取 file.contentUri (FileProvider content:// 协议)
                      └─> expo-intent-launcher startActivityAsync('android.intent.action.VIEW', {
                              data: contentUri,
                              type: 'application/vnd.android.package-archive',
                              flags: 1 // FLAG_GRANT_READ_URI_PERMISSION
                          })
```

- **安全约束**：Android 7.0+ 严禁向外部应用传递 `file://` URI（会导致 `FileUriExposedException`），必须使用 Expo 封装的 `FileProvider` 暴露出的 `content://` URI；
- **权限配置**：`app.json` 中声明 `REQUEST_INSTALL_PACKAGES`，允许应用请求系统包管理器安装 APK。

### 2.2 桌面端容器布局统一

```
Desktop Viewport (width >= 1024px)
┌─────────────────────────────────────────────────────────────┐
│ Window: 1280px ~ 2560px                                     │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Content Container: max-w-5xl (1024px) centered      │   │
│   │   ├── Inbox:    max-w-5xl                           │   │
│   │   ├── Now:      max-w-5xl                           │   │
│   │   ├── Projects: max-w-5xl                           │   │
│   │   ├── Review:   max-w-5xl (由 max-w-2xl 改为 5xl)    │   │
│   │   └── Settings: max-w-5xl (由 max-w-2xl 改为 5xl)    │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Bottom TabBar: max-w-5xl items with centered insets │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- 将 `settings.tsx` 中的 `<View className="w-full max-w-2xl mx-auto pb-12">` 调整为 `<View className="w-full max-w-5xl mx-auto pb-12">`；
- 将 `review.tsx` 中的 `<View className="flex-1 w-full max-w-2xl mx-auto">` 调整为 `<View className="flex-1 w-full max-w-5xl mx-auto">`。
