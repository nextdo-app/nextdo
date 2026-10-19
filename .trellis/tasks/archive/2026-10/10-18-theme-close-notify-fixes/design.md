# 深色模式跟随系统、桌面端关闭最小化与移动端主动申请通知权限技术设计

## 1. 主题「跟随系统」全链路深色沉浸

### 1.1 核心状态流与 NativeWind 同步
- 根因分析：此前为解决 Android Activity `uiMode` 记忆问题引入了 `setTimeout(() => Appearance.setColorScheme('unspecified'), 50)`。但该异步重置会在 React Native 端触发 `Appearance.addChangeListener` 并发出 `unspecified`，使 `react-native-css-interop` 将 NativeWind 的 `systemColorScheme` 重置为 `light`，导致所有 Tailwind `dark:` 类（如 `dark:bg-canvas-dark`）失效，呈现出浅色内容（`bg-canvas` #faf9f6），而下方 TabBar 直接读取 React 的 `isDark` 渲染为深色。
- 修复设计：
  - 移除了 `unspecified` 的定时器逻辑。无论何种模式，均将当前计算得出的具体目标外观 `target`（`'light' | 'dark'`）推给 `Appearance.setColorScheme(target)` 和 `setColorScheme(target)`；
  - 依赖真实系统外观监听器 `Appearance.addChangeListener` 与 `useSystemColorScheme`，在系统发生明暗切换时触发 `emitPreferenceChange()` 重新计算并同步具体 scheme，保证 NativeWind 与 React 状态永不分叉。

### 1.2 导航容器底色加固
- React Navigation 的 `Tabs` 与 `Stack` 默认背景为 DefaultTheme 的浅灰底（#f2f2f2）。
- 在 `TabsLayout` 中设置 `sceneStyle: { backgroundColor: isDark ? colors.canvasDark : colors.canvas }`；
- 在 `RootLayout` 的 `Stack` 中设置 `contentStyle: { backgroundColor: isDark ? colors.canvasDark : colors.canvas }`；
- 在 `RootLayout` 的 `StatusBar` 中显式设置 `backgroundColor={isDark ? colors.canvasDark : colors.canvas}`。

## 2. 桌面端后台保活与托盘管理

### 2.1 窗口关闭拦截
- 在 Tauri `on_window_event` 中监听 `WindowEvent::CloseRequested`：
  ```rust
  if let tauri::WindowEvent::CloseRequested { api, .. } = event {
      let _ = window.hide();
      api.prevent_close();
  }
  ```
- 点击红叉仅隐藏主窗口（`hide()`），阻止默认退出生命周期（`prevent_close()`），使后台 SQLite 同步与定时提醒持续生效。

### 2.2 托盘图标与 Dock 联动
- 在 `Cargo.toml` 引入 `tauri` 的 `tray-icon` 特性；
- 在 `setup` 中使用 `TrayIconBuilder` 注册系统托盘，配置主窗口显示与退出菜单；
- 监听 `RunEvent::Reopen`，在 macOS Dock 栏图标被点击且当前无可见窗口时，调用 `window.show()`, `window.unminimize()`, `window.set_focus()` 恢复显示。

## 3. 移动端通知权限主动申请

### 3.1 启动主动请求
- 在 `apps/mobile/app/_layout.tsx` 根组件中通过 `useEffect` 探测 `isReactNativeRuntime()`：在原生移动端冷启动且权限处于 `undetermined` 时，调用 `maybeRequestNotificationPermission()`，调起系统授权弹窗。

### 3.2 设置界面主动申请按键
- 在 `notificationActionFor` 中新增 `'native-request'` 状态分支（仅在 native 且 status 为 `undetermined` 时触发）；
- 设置页卡片渲染「开启通知」按钮，点击调用 `requestPermission()`；
- 用户在设置页切换打开「应用内提醒」开关时，自动判断并调起 `requestPermission()`。
