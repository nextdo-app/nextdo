# 实施计划 — 安卓端应用内安装更新与桌面端设置页宽度统一

## 1. 任务检查清单

- [x] **Step 1: 安卓安装逻辑与原生依赖**
  - 安装 `expo-file-system`, `expo-intent-launcher`, `expo-device`；
  - `app.json` 配置 `REQUEST_INSTALL_PACKAGES` 权限；
  - `lib/app-update.ts` 实现 `detectAndroidAbi` / `downloadAndroidUpdate` / `installAndroidUpdate`。
- [x] **Step 2: 更新交互组件接入**
  - `components/auto-update-dialog.tsx` 接入 Android 应用内更新流程；
  - `hooks/use-app-update.ts` 接入 Android 安装状态流与 ABI 识别。
- [x] **Step 3: 单元测试覆盖**
  - `lib/app-update.test.ts` 补齐 ABI 挑选用例；
  - `__tests__/auto-update-dialog.test.tsx` 增加 Android 应用内安装测试套件。
- [x] **Step 4: 桌面端设置页与回顾页宽度修复**
  - `apps/mobile/app/(tabs)/settings.tsx` 容器宽度调整为 `max-w-5xl`；
  - `apps/mobile/app/(tabs)/review.tsx` 容器宽度调整为 `max-w-5xl`。
- [x] **Step 5: 真实浏览器验证与门禁核验**
  - 启动 `pnpm verify:web`，在浏览器中实测设置页面和回顾页面宽度，确认视觉对齐一致并留存证据；
  - 运行 `pnpm lint && pnpm typecheck && pnpm test` 确认全绿。
- [x] **Step 6: Spec 更新与任务归档**
  - 更新相关 spec（component-guidelines 固化全端 5 个 tab 统一使用 `max-w-5xl` 容器规范）；
  - 归档 Trellis 任务并记录日志。
