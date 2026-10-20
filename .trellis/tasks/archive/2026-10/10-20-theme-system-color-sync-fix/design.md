# 外观主题色彩同步一致性技术设计

## 1. 根因分析与架构缺陷

### 1.1 `useSyncExternalStore` 快照粒度缺陷
此前 `apps/mobile/lib/theme.ts` 中，`useSyncExternalStore` 的快照仅返回 `cachedPreference`（`'system' | 'light' | 'dark'`）。
当用户设定为「跟随系统」（`preference === 'system'`）且系统外观发生变化（或初次挂载完成系统探测）时：
- `Appearance.addChangeListener` 触发并更新了 `authenticSystemScheme`，调用了 `emitPreferenceChange()`；
- 但由于 `cachedPreference` 始终为 `'system'`，React 的 `useSyncExternalStore` 判定 `previousSnapshot === nextSnapshot`，跳过了该 Hook 的更新调度！
- 导致某些依赖局部 `useSystemColorScheme()` 的组件（如 `TabsLayout`）重渲染切成了浅色，而上层容器和页面组件由于没有收到有效的快照更新而停留在深色状态。

### 1.2 多组件 Effect 竞态写入 `<html class="dark">`
此前每个调用 `useAppTheme()` 的组件都在各自的 `useEffect` 中执行：
```ts
setColorScheme(colorScheme);
applyWebDarkClass(isDark);
```
在实测日志中证实：当深色切换浅色时，某个组件在 1792477673804ms 移除了 `.dark`，仅仅 5ms 后的 1792477673809ms 另一个未完成状态同步的组件的 Effect 立即又把 `.dark` 加了回来！
导致 DOM 上永久残留 `<html class="dark">`，使页面 Tailwind 类全部按深色渲染，而 TabBar 按浅色渲染。

## 2. 重构设计方案

### 2.1 全局主题快照模型
```ts
export interface ThemeSnapshot {
  preference: ThemePreference;
  colorScheme: ResolvedColorScheme;
  isDark: boolean;
  loaded: boolean;
}
```
模块级维护唯一的不可变快照 `currentSnapshot: ThemeSnapshot`。每次 `preference` 或系统深浅外观变动时，生成全新的快照对象并触发 `listeners`。
所有调用 `useAppTheme()` 的组件通过 `useSyncExternalStore` 观察 `currentSnapshot`，保证在同一个 React 渲染批次中获得 100% 相同的数据。

### 2.2 统一的 Web / Native 同步器
- **Web / Desktop (Tauri)**：
  - 监听 `window.matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件；
  - 在快照变更时同步调度一次 `applyWebDarkClass` 与 NativeWind `setColorScheme`。
- **Native (iOS / Android)**：
  - 监听 `Appearance.addChangeListener`；
  - 保持 Android uiMode 约束，不调用 `Appearance.setColorScheme('unspecified')`。
