# 实施记录

## Checklist

- [x] **Phase 1: 准备与问题分析**
  - [x] 查明跟随系统在黑暗模式下 NativeWind 被 `Appearance.setColorScheme('unspecified')` 污染导致上方浅色的根因
  - [x] 查明桌面端（Tauri）窗口事件默认销毁退出的逻辑
  - [x] 梳理移动端当前通知权限策略（此前仅在特定场景延迟触发，无主动提示）

- [x] **Phase 2: 代码实现**
  - [x] 修复 `apps/mobile/lib/theme.ts`：移除 50ms 定时器，保证具体 scheme 稳定推送到 NativeWind 与 Appearance
  - [x] 加固 `apps/mobile/app/(tabs)/_layout.tsx` 与 `app/_layout.tsx`：为 `Tabs` 与 `Stack` 注入 `sceneStyle` / `contentStyle` 背景色，设置 `StatusBar` 背景
  - [x] 改造 `apps/desktop/src-tauri`：开启 `tray-icon` 特性，添加托盘菜单、拦截 `CloseRequested` 隐藏窗口、监听 `RunEvent::Reopen`
  - [x] 改造移动端通知权限：`_layout.tsx` 启动主动请求，`settings.tsx` 新增 `'native-request'` 动作按键及开关联动
  - [x] 更新 `apps/mobile/__tests__/notification-state.test.ts` 与 `settings-screen.test.tsx` 单元测试

- [x] **Phase 3: 验证与验收**
  - [x] 运行静态类型检查：`pnpm -r typecheck` 全部 5 个包通过
  - [x] 运行单元测试套件：`pnpm --filter @nextdo/mobile test` 全部 42 套件、631 项测试全部通过
  - [x] 运行桌面端 Rust 编译检查：`cargo check` 零错误通过
