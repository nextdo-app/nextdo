# Keyboard navigation on desktop and gestures on mobile (GitHub issue #17)

> 来源 issue：https://github.com/nextdo-app/nextdo/issues/17 「支持电脑端键盘导航和手机端手势操作」

## 背景与问题陈述

在收集箱页面中，用户会不断回答问题、澄清下一步行动。电脑端目前只能依赖鼠标点击，用户希望能完全用键盘在这些选项之间操作以减少点击成本；手机端则在适合的场景中缺少手势操作。

## 目标

- 电脑端：收集箱（及其他交互式选项列表）支持纯键盘完成「选选项 → 确认 → 进入下一步」的循环。
- 手机端：在适合的场景支持手势操作，且不与系统返回手势和页面滚动冲突。

## Requirements

### 电脑端

- 使用键盘上下键在可选项之间移动和选择。
- 按 Enter 确认当前选项并进入下一步。
- 当前选中项有清晰的视觉焦点状态（focus ring），在明暗主题下都可辨识。
- 页面切换或进入下一步后，键盘焦点自动定位到合理位置（通常是列表首项或新页面的主区域），不需要用户手动 Tab 一遍。
- 鼠标操作保持现有行为，不被键盘逻辑破坏。
- Tab 键仍能正常在页面可聚焦元素间循环，不产生焦点陷阱。

### 手机端

- 在适合的场景支持手势操作，例如滑动切换、返回、完成或处理选项。
- 手势不与系统返回手势、页面滚动冲突。
- 仅在明确安全的场景启用手势，不做全站铺开（范围在设计阶段收敛）。

## Acceptance Criteria

- [ ] 在收集箱澄清流程中，可用上下键在不同选项间移动，当前项有可见焦点态。
- [ ] 按 Enter 确认当前选项并进入下一步，行为与鼠标点击一致。
- [ ] 进入下一步或页面切换后，焦点自动落到合理位置，用户可直接继续用键盘操作。
- [ ] 鼠标与触控操作行为与改动前一致，无回归。
- [ ] 明暗主题下焦点态均清晰可见。
- [ ] 手机端手势在目标场景可用，且不会误触发页面滚动或系统返回。
- [ ] 如新增键盘/手势交互，在帮助文档中说明支持的操作。
- [ ] Web 端实测通过（`pnpm verify:web` 门禁全绿 + 浏览器截图存放在 `.verify/keyboard-nav-desktop-gestures/`）。

## Scope 提示

- 键盘导航优先落在收集箱澄清流程（issue 明确点名的场景），其余页面按设计阶段评估是否复用同一套 hook。
- 复用项目已有的选项列表组件，避免为每个页面重复实现焦点管理。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.