# UI 体验与交互全栈优化

## Goal

全面审查并优化 Nextdo UI 设计系统与核心流体验：设计令牌纯度、圆角几何规范、现在Tab情境排版、专注Timer沉浸感、桌面宽屏自适应与无障碍微字号容错

## Requirements

1. **设计令牌纯度与主题适配**
   - 彻底移除散落的硬编码 Hex（`#c85a17`, `#716b64`, `#9b948a`）及未经规范的 Tailwind 类（`bg-emerald-500/70`, `text-red-500`）；
   - 图标与状态组件全量统一为 `@nextdo/ui` 导出的 `colors.accent` / `colors.accentDark`、`colors.muted` / `colors.mutedDark` 及 `danger` 令牌，确保深浅主题动态无缝切换。

2. **组件几何比例与阶梯一致性**
   - 统一表单输入框圆角阶梯规范，将 `clarify-wizard.tsx`、`projects/[id].tsx`、`habits.tsx`、`waiting.tsx` 和 `review/daily.tsx` 的 `INPUT_CLASS` 由 `rounded-md` 升级为 `rounded-xl`；
   - 重构 `projects/[id].tsx` 与 `edit-action-modal.tsx` 中的预估时长选择 Chip，采用弹性胶囊设计（`min-w-[36px] px-2.5 rounded-full`），消除三位数（如 `120` 分钟）贴边挤压。

3. **「现在」Tab 与「专注」模式心智重构**
   - 「现在」Tab 将驱动引擎计算的「可用时间」条件筛选导轨（`FilterContextCard`）前置于推荐卡正上方，符合「设置情境 → 驱动引擎 → 呈现推荐」的自然认知路径；
   - 升级「专注」模式计时器体验：行动目标标题突出居中，倒计时数字改用等宽字体（`font-mono`）消除抖动，新增温润的状态胶囊，主行动强调「暂停/继续」，容器自适应居中。

4. **收件箱速记体验调优**
   - 优化 `quick-capture-modal.tsx` 抽屉的遮罩质感（降低遮罩压迫感），并在抽屉右上角新增显式关闭按键，使常驻顶部输入卡片与底角悬浮按钮（FAB）协同运作。

5. **宽屏自适应与人体工学**
   - 消除大屏下单行文字无限拉伸与子页面宽度跳跃的割裂感，在各主 Tab 及二级页面统一使用 `max-w-4xl mx-auto` 视宽上限。

6. **无障碍微字号排版健壮性**
   - 在 `packages/ui/src/components/tag.tsx` 中将固定的 `h-[22px]` 改为 `min-h-[22px] py-0.5` 弹性结构，在系统开启大字号或 Dynamic Type 时自适应撑开容器，避免微字号截断。

## Acceptance Criteria

- [x] 所有散落的硬编码颜色彻底清除，暗黑模式下对比度清晰；
- [x] 表单输入框圆角一致规范为 `rounded-xl`，时长胶囊三位数展示舒适；
- [x] 「现在」Tab 条件筛选栏位于推荐卡上方，专注模式时钟平稳无抖动；
- [x] 大屏下各页面阅读视宽统一收敛（`max-w-4xl`），无宽度跳跃感；
- [x] 静态类型检查 `pnpm -r typecheck` 全部通过；
- [x] 单元测试 `pnpm --filter @nextdo/mobile test` 全部 42 套件通过；
- [x] 代码规范 `pnpm eslint .` 零报错。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
