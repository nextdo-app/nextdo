# Design — 修复跟随系统主题被桌面端窗口外观锁死

## 问题边界

出问题的行为在主题状态机与原生外观桥之间，不在 Tailwind/NativeWind 渲染层：

- `apps/mobile/lib/theme.ts` 的 `syncTauriWindowTheme(colorScheme)` 只接受解析后的 `'light' | 'dark'`，`syncPlatformTheme` 传的是 `snapshot.colorScheme`。
- `apps/desktop/src-tauri/src/lib.rs` 的 `set_window_theme` 将具体主题映射到 `Some(Theme::Dark/Light)`。Tauri 在 macOS 上设置的是应用级外观（官方文档：app-wide），会覆盖系统外观，并让 WKWebView 的 `prefers-color-scheme` 固定在被强制值。
- 结果：偏好为「跟随系统」时，应用在启动时按当时的系统主题锁定，之后系统切换不再触发 `matchMedia` 的 `change`，状态机收不到通知。

## 契约变更

### 1. `set_window_theme(theme)` 的入参

- 入参扩展为 `'system' | 'light' | 'dark'`：`system` → `None`（跟随系统），`light`/`dark` → 显式外观（回传仍为 `Result<(), String>`）。
- macOS 的应用外观一旦被设为具体值，WKWebView 的 `prefers-color-scheme` 就会被固定；只有传 `system` 解除覆盖后，系统切换才能重新到达 `matchMedia`。

### 2. `syncTauriWindowTheme` 的入参

从 `ResolvedColorScheme` 改为 `ThemePreference`，由 `syncPlatformTheme` 传 `snapshot.preference`。这样：
- 跟随系统时不再强制应用外观；
- 显式模式下仍强制窗口外观（标题栏与界面一致）。

### 3. 切回「跟随系统」的恢复顺序

`updatePreference('system')` 仍先按 `authenticSystemScheme` 更新状态，状态更新会立即把 `'system'` 推给桌面壳解除锁定。

实测发现：解除锁定后 WKWebView 的 `matchMedia` 并不总会补发 `change`，`useColorScheme()` 会停在旧值，界面出现半浅半深。因此状态机改为「实时读」而不是「等事件」：

- 新增 `getLiveSystemScheme(fallback)`：浏览器环境直接读 `matchMedia('(prefers-color-scheme: dark)')`，失败或非 Web 时回退到 `useColorScheme()`。
- `useAppTheme` 的派生逻辑与推送 NativeWind 的效果都改用该实时值；`useColorScheme()` 的订阅仍保留，作为原生端与事件驱动的兜底。

这样无论变更事件是否到达，下一次渲染都会用真实的系统外观。

### 3.1 启动时的系统外观

`get_system_theme` 在应用启动、尚未强制过外观时读取窗口主题，即为真实系统外观；浏览器实测中它返回当前系统值，与 `matchMedia` 一致。

### 4. 原生移动端 Appearance（保持现状）

RN 0.86 的 `Appearance.setColorScheme` 只接受 `'light' | 'dark' | 'unspecified'`，而 `'unspecified'` 会触发 `react-native-css-interop` 的半浅半深回归（见归档任务 10-18）。本次不改动原生分支，继续推送解析后的具体值，仅修桌面端锁定。

## 影响文件

- `apps/mobile/lib/theme.ts` — 同步函数签名、调用点、实时系统外观读取、切换系统时的回读。
- `apps/desktop/src-tauri/src/lib.rs` — `set_window_theme` 支持 `system`（→ `None`），并修正被错放到命令上的 `mobile_entry_point` 属性。
- `apps/mobile/__tests__/theme.test.tsx` / `__tests__/mocks/theme-env.ts` — 回归用例（Tauri 收到的是 preference；Web 竞态下以实时媒体查询为准）。

## 不做的事

- 不改 `_layout.tsx`、Tailwind 配置、设计 token。
- 不重建主题状态机，不引入新的全局 store。
- 不改 `get_system_theme` 的启动读取语义（进程启动时尚未强制过外观，读取结果即真实系统外观）。

## 验证

- 单测：`pnpm --filter @nextdo/mobile test -- theme`。
- 类型/门禁：`pnpm typecheck` 或仓库现有 `pnpm verify:web`（按任务收尾要求）。
- 桌面实测：重建 Tauri 二进制后在偏好「跟随系统」下切换 macOS 外观为人工步骤；本次已用生产 Web 产物 + 模拟 `prefers-color-scheme` 走完浏览器实测，截图与 IPC 记录存入 `.verify/10-21-fix-theme-follow-system-lock/`。
