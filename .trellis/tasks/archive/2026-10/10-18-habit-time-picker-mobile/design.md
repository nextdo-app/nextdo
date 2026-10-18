# Technical Design: 手机端时间选择器自适应布局修复（Issue #50）

## 1. 架构与布局模型分析

### 当前结构缺陷
```tsx
<Modal visible transparent>
  <View className="flex-1 items-center justify-center bg-black/60 ...">
    <View className="relative z-10 w-full max-w-md flex-col rounded-3xl ... max-h-[88vh]">
      <View className="flex-shrink-0 ...">Header</View>
      <ScrollView className="flex-1" ...>Body</ScrollView>
      <View className="flex-shrink-0 ...">Footer</View>
    </View>
  </View>
</Modal>
```
在 React Native Yoga 中：
- 外层 Modal 内容包装层使用 `items-center justify-center` 居中；
- 弹窗卡片 View 的 `height` 未显式指定（默认 `auto`），仅受 `maxHeight`（88vh / 92vh）约束；
- `ScrollView` 设置 `className="flex-1"` 产生 `flexBasis: 0`。在 `height: auto` 的父容器内，主轴空间并未确定，`flexGrow: 1` 无法获得伸展尺寸，导致 ScrollView 计算高度为 0。

### 目标布局结构
为了同时满足：
1. **内容自适应**：在内容高度小于 `maxHeight` 时，弹窗高度贴合内容，不出现多余无意义空白；
2. **小屏自适应与内部滚动**：在内容高度超出屏高时，弹窗不超过 `maxHeight`，顶部 Header 与底部 Footer 保持吸顶/吸底，中间 Body 内部滚动；
3. **消除 Yoga 零基尺寸坍缩**：避免在未定义固定高度的父容器中给子 ScrollView 使用 `flexBasis: 0`。

设计方案：
- 将 ScrollView 的样式从 `flex-1` 改为 `flex-shrink: 1; flex-grow: 0`（即 NativeWind `shrink`，配合必要的主轴约束），或者在容器卡片中赋予确定性弹性主轴：
  - 弹窗卡片容器 View：保持 `max-h-[88vh] flex-col`；在小屏时赋予其 `flex-1 justify-between max-h-[88vh]` 或给 ScrollView 设置最小/自适应高度；
  - 更干净、符合 React Native 实践的做法：
    给弹窗外层卡片使用 `max-h-[88vh]`，ScrollView 移除 `flex-1`，设置 `className="shrink"` 并指定 `contentContainerStyle={{ flexGrow: 1, paddingBottom: 6 }}`；
    或者对 ScrollView 显式给出 `max-h-[65vh]` 与 `shrink`。在移动设备上，这样 Yoga 可以从内容向上计算尺寸，当总高超过 88vh 时由 `max-height` 截断并通过 `shrink` 触发 ScrollView 滚动。

## 2. 跨端与多视口兼容性
- **桌面宽屏（> 1024px）**：卡片宽度受 `max-w-md`（448px）限制，高度由内容自然撑开，呈现精致悬浮对话框。
- **主流手机（390×844 / 405×837）**：卡片居中，时钟、转盘、常用时段、底部按钮一览无余，无需滚动即可直接点选。
- **紧凑小屏（360×640 / 360×800）**：`max-h-[92vh]` 约束生效，顶部标题栏与底部操作栏固定在可视区域，中间转盘区域可轻松顺畅滑动。

## 3. 测试与验证策略
- 单元测试：`apps/mobile/__tests__/datetime-picker.test.tsx` 补充结构与 props 断言。
- 交互态与浏览器实测：在真实 Chrome / 移动端模拟器（360×800、390×844）下截取习惯时间窗口开始时间弹窗的真实渲染图，确保证据清晰可靠。
