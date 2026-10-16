# 核心页面 UI 细节优化执行计划

## Checklist

- [x] **Phase 1: 准备与基线确认**
  - [x] 激活任务（`task.py start`）

- [x] **Phase 2: 代码实现**
  - [x] 优化 `review.tsx`（双卡片图标、chevron-forward、max-w-2xl）
  - [x] 优化 `completed.tsx`（max-w-2xl、紧凑恢复按钮）
  - [x] 优化 `contexts.tsx`（max-w-2xl、场景快捷建议标签）
  - [x] 优化 `waiting.tsx` 与 `habits.tsx`（max-w-2xl 容器视宽）

- [x] **Phase 3: 验证与交付**
  - [x] 运行全套单元测试
  - [x] 运行 `pnpm lint` 和 `pnpm typecheck`
  - [x] 验证浏览器呈现并留存证据
