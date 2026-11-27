# Android 时间选择器闪退与转盘手势（issue #109）

## 状态

已修复并验证。修复版本 `v0.2.5`（2026-11-27），用户在 Android 真机确认
「滑动与确定均正常」。相关 PR：#113、#114、#115。

## 问题

Android 上给任务选择截止时间，选好时间点「确定」后 App 立即闪退，无
JS 错误、App 内诊断日志无记录。`v0.2.4` 后轮盘可以滑动，但一滑动就闪退。

## 排查结论（A/B 结果）

- 只点快捷日期、不碰时间 → 确定：不闪退。
- 打开选择器 → 取消：不闪退。
- `mode="time"` 不碰转盘直接确定（仍会写入「常用时段」计数）：不闪退。
- 碰过时间控件后确定：闪退；**碰过之后等待 5 秒再确定：不闪退**。
- `v0.2.3` 把时间预设计数从 `expo-secure-store` 改为文件后仍闪退 →
  SecureStore 写入不是本 issue 的根因（该改动保留为非机密计数存储）。

结论：触发条件是转盘手势本身。两项机制叠加：

1. 转盘 `ScrollView` 在滚动过程中被 React 重渲染（`onScroll` 的
   `setState`、以及 scroll 生命周期状态），Android 上会导致进程崩溃。
2. 关闭 Modal 时转盘的 fling/吸附还没有结束；`ReactScrollView` 的
   `onDetachedFromWindow` 不会 `abortAnimation()`。
3. 轮盘「不滑动」是外层 body `ScrollView` 仍可滚动（内容溢出约 2px），
   抢走了内层转盘的垂直手势。

## 修复（`v0.2.5`，PR #115）

- 滚动期间**零 React 更新**：
  - `wheelsSettled` / `pendingConfirm` 用 ref，不用 state；
  - `onScroll` 只记录 `contentOffset.y`；
  - 值在 `scrollEndDrag` / `momentumScrollEnd` 时提交一次。
- 点确定时若转盘仍在 fling，挂起关闭，等待 `onMomentumScrollEnd`；
  300ms fallback 覆盖无惯性拖动。
- 外层 body `ScrollView` 在内容一屏时 `scrollEnabled=false`（容差 8px），
  让转盘手势归内层；删除「常用时段」标题行以满足高度预算。
- iOS / web 保留滚动中实时提交（`commitLive`）；web 没有 momentum 事件。

## 限制

- 未获取 Android native 崩溃堆栈（App 内日志无法捕获 native crash），
  根因由 A/B 与代码审查推断。
- 三项改动一起验证有效，未单独分离每一项的贡献。
- `v0.2.3` 的 SecureStore → 文件存储改动保留，但不是本 issue 的修复项。

## 当前实现

- 小时与分钟转盘分别记录滚动状态和无惯性拖动的 300ms 定时器。
- Android 转盘全部停止后提交界面状态；惯性开始时取消对应定时器。
- 确认直接读取最终转盘位置，不依赖下一次 React 渲染。
- 确定、取消、顶栏关闭、遮罩和系统返回统一等待转盘停止。
- 等待期间取消会撤销待执行的确认，不保存选择值。
- 诊断页保留本地日志、复制报告和清空功能；文件存储直接使用 Expo API，
  日志与报告共用字节计数，复制和清空分别使用单一状态。
- 剪贴板写入返回 `false` 或抛出异常时，页面显示复制失败。

验证：`pnpm verify:web` 的 lint、typecheck、1,981 项测试和 Web 构建通过。
Chrome 验证时间保存与恢复、四种关闭入口、截止日期与时间、本地日志持久化、
报告复制、复制失败提示、清空后的持久化。Android 手势使用组件事件测试覆盖。
上文的 Android 真机结论仍仅适用于 `v0.2.5`；当前实现需要发布后复测真机。

## 可复用的规则

- Android 上由手势驱动的 `ScrollView`，滚动期间不要 `setState` 重渲染它。
- 关闭包含滚动内容的 Modal 前，等待 fling/吸附结束。
- 嵌套垂直 `ScrollView`：外层在内容一屏时禁用滚动，避免抢内层手势。
