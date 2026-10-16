# 核心页面 UI 细节与视宽质感优化

## Goal

全面优化回顾（Review）、已完成（Completed）、场景管理（Contexts）、等待清单（Waiting）及习惯（Habits）等页面的视觉细节，引入一致的图标规范与空状态质感，统一桌面端视宽收敛（`max-w-2xl`）。

## Requirements

1. **回顾页面（Review）美化**
   - 「今日回顾」与「本周回顾」卡片加入契合的矢量图标（`sunny-outline` 与 `calendar-outline`），替换原手打文本箭头为矢量 `chevron-forward` 图标；
   - 容器宽度由原本过度拉伸的 `max-w-5xl` 收敛为人体工学舒适的 `max-w-2xl`；
   - 保持所有现有测试契约与路由跳转（`/review/daily`、`/review/weekly`）100% 兼容。

2. **已完成行动页面（Completed）优化**
   - 修复头部导航依赖 `w-16` 写死占位导致的排版脆弱性；
   - 行内恢复按钮由冗长的「恢复为未完成」优化为紧凑清晰的「恢复行动」，避免移动端被挤压折行；
   - 容器宽度统一收敛至 `max-w-2xl`。

3. **场景管理页面（Contexts）优化**
   - 容器宽度收敛至 `max-w-2xl`；
   - 增加常用 GTD 场景预设推荐快捷标签（电脑、办公室、电话、外出、家里等），支持一键填入创建；
   - 场景列表行增加场景轻图标标识。

4. **等待清单（Waiting）与习惯（Habits）视宽统一**
   - 统一收敛至 `max-w-2xl` 居中对齐，消除宽屏下的空旷拉伸感。

## Acceptance Criteria

- [ ] `review.tsx` 双卡片视觉质感提升，图标规范对齐；
- [ ] `completed.tsx` 恢复按钮紧凑对齐，无折行异常；
- [ ] `contexts.tsx` 具备常用场景推荐预设；
- [ ] 相关单页面在桌面端与移动端均呈现自适应优雅比例；
- [ ] 全套单元测试、`pnpm lint` 和 `pnpm typecheck` 全部通过。

