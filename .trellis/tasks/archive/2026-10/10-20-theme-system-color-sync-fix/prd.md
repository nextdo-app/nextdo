# 外观主题「跟随系统」色彩同步一致性修复 PRD

## Goal

彻底修复在桌面端（macOS Tauri / Web）及各端在选择「跟随系统」或切换主题时，界面上方 Tailwind `dark:` 样式与底部 Tab 栏产生半黑半浅、色彩不一致的脱节问题，确保全应用主题状态严格同步一致。

## Requirements

1. **全局主题单一数据源（Single Source of Truth）**
   - 将 `useAppTheme` 的状态模型重构为完整的全局不可变快照 `{ preference, colorScheme, isDark, loaded }`；
   - `useSyncExternalStore` 必须订阅完整的 Theme 快照，而非仅订阅 `preference` 字符串。当系统深浅外观变动或用户切换偏好时，快照引用更新，驱动全树组件（根 Stack、TabBar、各业务 Screen）在同一帧同步重绘。

2. **跨平台系统外观监听可靠性**
   - 在 Web / Tauri 环境下，直接通过 `window.matchMedia('(prefers-color-scheme: dark)')` 建立现代 `addEventListener('change')` 监听（兼容 `addListener` 回退），消除 `react-native-web` 内部废弃监听器导致的事件漏发；
   - 在 React Native 运行时保持 `Appearance.addChangeListener`，并持续遵守移动端 Android uiMode 不得使用 `Appearance.setColorScheme('unspecified')` 的约束。

3. **消除多组件 Effect 竞争写入 `<html class="dark">`**
   - 统一由全局 Store 状态机作为 `<html class="dark">` 与 NativeWind `setColorScheme` 的唯一写入源；
   - 彻底解决组件生命周期交错时（如 TabBar 切为浅色但某个屏幕 Effect 在 5ms 后重新加回 `.dark`）导致的上下半屏撕裂异常。

## Acceptance Criteria

- [ ] 系统在深色模式下，选择「跟随系统」，整屏背景（`#171412`）、卡片（`#211d19`）与下方 TabBar（`#211d19`）通体深黑；
- [ ] 系统在浅色模式下，选择「跟随系统」，整屏背景（`#faf9f6`）、卡片（`#ffffff`）与下方 TabBar（`#ffffff`）通体浅色；
- [ ] 切换「深色模式」或「浅色模式」时，全屏与 TabBar 同步即时切换，无任何闪烁或反色残留；
- [ ] 自动化测试全部通过（`pnpm --filter @nextdo/mobile test`），包含深浅系统模式动态切换走查；
- [ ] `pnpm verify:web` 质量门禁 100% 通过。
