# 调研：手机端习惯页面时间列表/选择器高度坍缩（Issue #50）

## 1. 现象复盘与复现

### 现象
在移动端（iOS / Android 真机环境）打开习惯页面（`/habits`），点击「限定时间窗口」开启后，点击「时间窗口开始」或「时间窗口结束」打开 `DateTimePicker` 模态弹窗：
- 弹窗顶部栏正常显示（标题「选择开始时间」、副标题、关闭按钮 ×）；
- 弹窗底部栏正常显示（「取消」和「确定」按钮）；
- **弹窗中间区域完全为空白**：时钟数字、24h/12h 切换栏、小时转盘、分钟转盘、常用时段快捷选择区全部消失，高度坍缩为 0。
- 用户无法看到任何时间数字，无法滚动选择，更无法保存时间。

### 对应 Issue 与证据
- GitHub Issue #50: 修复手机端习惯页面时间列表无法打开的问题
- 附件截图：`issue50-shot-real.png`，精准展示了上述只有顶栏与底栏、中间转盘消失的状态。

## 2. 根因分析（Root Cause）

定位至 `apps/mobile/components/datetime-picker.tsx`：
1. 容器定义：
   ```tsx
   <View
     className={cn(
       'relative z-10 w-full max-w-md flex-col rounded-3xl border border-border/80 bg-surface shadow-2xl dark:border-border-dark dark:bg-surface-dark',
       isCompact ? 'p-3.5 max-h-[92vh]' : 'p-5 max-h-[88vh]',
     )}
   >
   ```
   弹窗容器 View 没有显式 `height`，也没有 `flex: 1`，只有 `max-height` 约束（`max-h-[88vh]`）。

2. 内容主体 ScrollView 定义：
   ```tsx
   <ScrollView
     className="flex-1"
     showsVerticalScrollIndicator={false}
     nestedScrollEnabled
     contentContainerStyle={{ paddingBottom: 6 }}
   >
   ```
   ScrollView 被赋予了 `className="flex-1"`。

3. React Native Yoga 布局引擎特性：
   - `flex-1` 编译为 `{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }`。
   - 当父容器的高度为 `height: auto`（未设置确定 height 或 flex: 1，仅设置了 `maxHeight`）时，Yoga 按照子组件的固有内容高度计算父容器尺寸。
   - 由于 ScrollView 声明了 `flexBasis: 0`，其在未确定尺寸父容器中的固有尺寸为 0。
   - 此时没有剩余空间分配给 `flexGrow: 1`，Yoga 算得 ScrollView 高度为 0。
   - 父容器高度 = Header 固有高 (~50px) + 0 + Footer 固有高 (~45px) = 95px <= maxHeight。
   - 最终呈现出来的就是整个中间滚动区域高度完全坍塌为 0！

4. 为什么 Web 端在某些桌面浏览器看起来正常？
   - Web 浏览器在解析原生 CSS 时，带有内容的 flex 子项在特定 flex 容器规则下可能根据内容撑开；但在移动端 WebView、iOS/Android React Native 原生容器或标准弹性约束下，`flexBasis: 0` 必然导致高度收缩为 0。

## 3. 修复方案

1. 移除 ScrollView 上的 `flex-1`（消灭 `flexBasis: 0` 对固有高度的抹平）。
2. 将 ScrollView 样式改为自适应包裹内容且支持溢出收缩：
   - `className="shrink"` 或 `style={{ flexGrow: 0, flexShrink: 1 }}`。
   - 或者显式设置合理的视口最大高度约束（如 `max-h-[60vh]`）并配合 `contentContainerStyle`。
3. 保证外层弹窗容器在小屏和普通手机屏幕尺寸下既有固定底栏，主体内容又能根据内容自适应高度；当内容超过屏高时，ScrollView 正常内部滚动，不会被裁切。
