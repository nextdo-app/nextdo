# Implementation Plan: 修复手机端习惯时间选择器高度坍缩（Issue #50）

## 1. 实施步骤

- [ ] 1. 调整 `apps/mobile/components/datetime-picker.tsx` 的布局结构：
  - 移除 ScrollView 的 `className="flex-1"`；
  - 为 ScrollView 配置 `className="shrink"`，`style={{ flexGrow: 0, flexShrink: 1 }}`，以及 `contentContainerStyle={{ flexGrow: 1, paddingBottom: 6 }}`；
  - 优化外层卡片容器尺寸样式，在 `max-h-[88vh]`（小屏 `max-h-[92vh]`）下保持整体居中且弹性收缩。
- [ ] 2. 完善单元测试：
  - 在 `apps/mobile/__tests__/datetime-picker.test.tsx` 中添加样式与属性断言，确保 ScrollView 没有被错误赋予 `flex-1`。
- [ ] 3. 运行本地测试：
  - `pnpm --filter @nextdo/mobile test apps/mobile/__tests__/datetime-picker.test.tsx`
- [ ] 4. 浏览器多视口实测与证据截图：
  - 针对 360×800 与 390×844 视口，打开习惯时间选择器，截取时间轮盘与时段选择区的实际渲染截图，保存至 `.verify/` 目录。
