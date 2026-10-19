# 深色模式跟随系统、桌面端关闭最小化与移动端主动申请通知权限 PRD

## Goal

修复外观主题选择「跟随系统」在黑暗模式下上方区域未渲染深色底的问题；优化桌面端（Tauri）窗口关闭交互，默认隐藏到托盘与 Dock 而非立即退出；移动端原生启动及设置交互中主动向手机系统请求通知权限。

## Requirements

1. **外观主题「跟随系统」深色一致性**
   - 彻底修复 `apps/mobile/lib/theme.ts` 中「跟随系统」深色模式下的颜色脱节：去除破坏 NativeWind 状态的 50ms `Appearance.setColorScheme('unspecified')` 延迟，使具体解析后的主题（`colorScheme`）稳定且一致地同步给 React Native `Appearance`、NativeWind 及 Web class；
   - 在 `(tabs)/_layout.tsx` 中为 `Tabs` 配置 `sceneStyle: { backgroundColor: isDark ? colors.canvasDark : colors.canvas }`；
   - 在 `app/_layout.tsx` 中为根 `Stack` 配置 `contentStyle` 并在 `StatusBar` 设置 `backgroundColor`，消除页面间跳转或回弹时露出的系统默认浅底色，确保顶部状态栏与整屏统一沉浸。

2. **桌面端窗口关闭行为优化（托盘 / 后台保活）**
   - 为 Tauri 桌面应用引入 `tray-icon` 特性，监听窗口 `WindowEvent::CloseRequested` 事件，执行 `window.hide()` 并 `api.prevent_close()`，关闭窗口时不杀死进程，保持后台同步与提醒调度；
   - 创建系统托盘图标与托盘菜单（「显示 Nextdo」、「退出 Nextdo」），左键点击托盘或菜单项支持恢复并聚焦主窗口；
   - 监听 `RunEvent::Reopen`，支持在 macOS 点击 Dock 图标时重新唤出主窗口；通过托盘菜单或快捷键可完全退出。

3. **移动端通知权限主动申请**
   - 原生移动端应用冷启动时（在 `_layout.tsx` 挂载期间），当系统权限处于未决定（`undetermined`）状态时，主动调用 `maybeRequestNotificationPermission()` 唤起手机系统授权对话框，免除用户手动前往系统设置开启的繁琐流程；
   - 在「设置」页面的提醒与通知卡片中，为移动原生端未授权状态新增 `'native-request'` 操作按键（「开启通知」），点击可直接调起系统授权；
   - 在「设置」页面打开「应用内提醒」开关时，若尚未授权，自动联动请求通知权限。

## Acceptance Criteria

- [x] 深色系统下选择「跟随系统」，页面整体（顶部状态栏、内容区、下方 Tab 栏）全量沉浸为深色，无半浅半黑与白底暴露；
- [x] 桌面端点击窗口关闭按钮（X），窗口隐藏且程序在后台保持运行（不显示在当前桌面上），点击托盘或 Dock 图标可唤起恢复；
- [x] 桌面端托盘菜单「退出 Nextdo」可正常退出进程；
- [x] 移动端启动或在设置中点击「开启通知」/ 开启提醒开关时，主动向系统请求通知授权；
- [x] 静态类型检查 `pnpm -r typecheck` 全部通过；
- [x] 单元测试 `pnpm --filter @nextdo/mobile test` 全部 42 套件通过；
- [x] 桌面端 Rust 代码 `cargo check` 编译通过。
