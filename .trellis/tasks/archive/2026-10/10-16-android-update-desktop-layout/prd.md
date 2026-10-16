# PRD — 安卓端应用内安装更新与桌面端设置页宽度统一

## 1. 背景与目标

### 1.1 安卓端应用内更新
当前 Nextdo 移动端在发现新版本后，仅支持通过 `openExternalUrl` 打开浏览器跳转到 GitHub Releases 下载 APK。用户下载完成后必须手动切换到系统文件管理器或通知栏查找 APK 并点击安装，体验割裂。
**目标**：在 Android 平台上实现「应用内下载 + 自动调起系统安装器」，下载完成后直接弹出系统安装确认弹窗，实现一键升级。

### 1.2 电脑端（桌面端 / Web）设置页与回顾页宽度统一
当前电脑端在较宽视口（如 1024px ~ 2560px）下，收件箱（`inbox.tsx`）、现在（`now.tsx`）、项目（`projects.tsx`）等主页面的内容容器均统一采用 `max-w-5xl`（1024px），与 `_layout.tsx` 中底部标签栏对齐；而设置页面（`settings.tsx`）与回顾页面（`review.tsx`）的外层容器硬编码了 `max-w-2xl`（672px），导致宽屏下两侧留白过多、与其他页面不一致。
**目标**：将设置页面（`settings.tsx`）与回顾页面（`review.tsx`）的容器宽度统一步调至 `max-w-5xl`，使五个 Tab 页面在宽屏电脑端下视觉宽度与标签栏对齐完全一致。

---

## 2. 功能需求

### 2.1 安卓应用内下载与安装
1. **ABI 自适应匹配**：安卓设备按 CPU 架构（`expo-device` 探测 `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`）挑选对应的单一 `.apk` 下载，避免下错架构导致解析失败。
2. **应用内下载**：使用 `expo-file-system` 将 APK 下载至应用缓存目录（`Paths.cache/nextdo-update.apk`），支持实时进度反馈，且采用 `idempotent: true` 保证重试下载覆盖旧包。
3. **调起系统安装器**：使用 `expo-intent-launcher`，以 `android.intent.action.VIEW` 搭配 FileProvider 提供的 `content://` URI、`application/vnd.android.package-archive` MIME 类型及 `FLAG_GRANT_READ_URI_PERMISSION (1)`，安全拉起系统安装器。
4. **权限与异常兜底**：在 `app.json` 中配置 `REQUEST_INSTALL_PACKAGES` 权限；若安装器调起失败或无权限，提供「改用浏览器下载安装包」的清晰跳转兜底。
5. **多端平台隔离**：桌面端（Tauri）与非安卓端保持原有逻辑不变，原生模块采用按需加载，在 Node/Jest/Web 环境中不引入副作用。

### 2.2 电脑端容器宽度统一
1. 将 `apps/mobile/app/(tabs)/settings.tsx` 的外层容器由 `max-w-2xl` 改为 `max-w-5xl`，与 `inbox.tsx`, `now.tsx`, `projects.tsx` 完全对齐。
2. 同步将 `apps/mobile/app/(tabs)/review.tsx` 的外层容器由 `max-w-2xl` 统一为 `max-w-5xl`，消除宽屏下的局部局促感与巨大留白。
3. 保持移动端屏幕下的全宽 `px-4` 与流畅自适应体验，各断点行为平滑。

---

## 3. 验收标准

1. **安卓安装逻辑验证**：
   - 单测覆盖 `pickAndroidAbi` 的架构选择规则；
   - 弹窗单测模拟 Android 环境，确认能正确解析 ABI、调用文件下载并在完成时通过 `startActivityAsync` 调起系统安装器。
2. **桌面端容器宽度实测**：
   - 在 1280px+ 视口宽度下，设置页卡片容器达到 1024px（`max-w-5xl`），消除原先 672px 造成的过大留白；
   - 回顾页容器同样达到 1024px（`max-w-5xl`），与 `_layout.tsx` 的标签栏对齐一致。
3. **代码与工程门禁**：
   - `pnpm lint` 0 报错；
   - `pnpm typecheck` 全项目通过；
   - `pnpm test` 全量单测通过；
   - `pnpm verify:web` 浏览器构建与运行验证通过。
