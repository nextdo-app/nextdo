# Implementation Plan: #56 专注页「时间到」重构

## 步骤

- [x] 1. 读取 `apps/mobile/app/focus/[id].tsx`，确认 `timeUp` 分支与 `elapsed` 可用。
- [x] 2. 外层 Card：`rounded-3xl` → `rounded-2xl`，`gap-6` → `gap-5`（含加载态卡片）。
- [x] 3. 「时间到」分支：`Card` → `View`，左侧 4px warning 色条 + 轻底色；标题配 `Ionicons alarm-outline` 并加粗；按钮改纵向全宽。
- [x] 4. 计时数字：`timeUp` 时改用 `text-muted`，并在下方显示 `本次专注 N 分钟`。
- [x] 5. 更新 `__tests__/focus-screen.test.tsx`：按钮文案「继续专注」、断言无嵌套 Card / 实际用时。
- [x] 6. 运行 `pnpm --filter @nextdo/mobile test -- focus-screen` 与 `pnpm typecheck`。
- [x] 7. `pnpm verify:web` 后浏览器实测截图到 `.verify/issues-54-56/`。

## 验证

```bash
pnpm --filter @nextdo/mobile test -- focus-screen
pnpm typecheck
```

## 完成定义

- issue #56 的 6 条视觉问题全部消失；
- 现有专注流程测试全绿；
- 截图证据落盘。
