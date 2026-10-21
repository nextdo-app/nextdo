# 修复跟随系统主题被桌面端窗口外观锁死

## Goal

桌面端选择「跟随系统」后，Tauri `set_window_theme` 被传入已解析的具体主题，导致 macOS 应用外观被强制固定、WKWebView 的 `prefers-color-scheme` 不再响应系统切换。实测（任务收尾阶段）还发现：解除锁定后 WKWebView 的媒体查询并不总会补发变更事件，`useColorScheme()` 会停在旧值，界面变成半浅半深。

## Requirements

- R1 桌面端（Tauri/macOS）在偏好为「跟随系统」时，必须把 `system` 原样传给窗口外观，而不是解析后的 `light`/`dark`，避免应用级外观被钉死。
- R2 从显式「浅色模式」/「深色模式」切回「跟随系统」时，状态更新会先解除窗口外观锁定；解除后 WebView 的 `prefers-color-scheme` 重新评估并触发变更事件，界面随之恢复为真实系统外观。
- R3 不改变现有 Web 与原生移动端行为：`<html class="dark">`、NativeWind 仅接收具体 `light`/`dark`、原生 `Appearance` 同步策略、偏好持久化与首次渲染逻辑保持原样。
- R4 桌面端跟随系统时，主题判定以实时媒体查询（`matchMedia('(prefers-color-scheme: dark)')`）为准，不依赖 `useColorScheme()` 是否收到了变更事件。

## Acceptance Criteria

- [x] 偏好为「跟随系统」时，`set_window_theme` 收到 `system`（浏览器实测 IPC 记录确认）。
- [x] 保持「跟随系统」，系统外观由浅切深后界面变为深色（模拟媒体查询翻转 + 截图确认）。
- [x] 先选「深色模式」再切回「跟随系统」，界面恢复为当前系统外观（截图 02），且 `<html class="dark">` 不再被清空。
- [x] 显式选择「浅色模式」/「深色模式」时，窗口外观与界面仍被固定为该模式（截图 01）。
- [x] `apps/mobile/__tests__/theme.test.tsx` 新增的回归用例通过，既有用例不回归（11/11）。
- [ ] 真机（打包后的 macOS 应用）切换系统外观的最终确认仍待人工执行。

## Notes

- 现有存储值 `nextdo.settings.theme-preference` = `system`；macOS 当前 `AppleInterfaceStyle` 键缺失（浅色）。
- 桌面端由 `apps/desktop/src-tauri/src/lib.rs` 的 `set_window_theme` / `get_system_theme` 驱动；Tauri 官方文档说明 macOS 主题是应用级而非窗口级。
- 浏览器实测：`.verify/10-21-fix-theme-follow-system-lock/`（截图 + `ipc-trace.json`）。
