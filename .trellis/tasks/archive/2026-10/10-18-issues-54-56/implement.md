# Implementation Plan: issues #54 / #56 集成

## 阶段路线图

- [x] 1. 复核 #50 / #51：确认 `datetime-picker.tsx` 与两分钟行动流转代码在发布分支上；在 issue 中记录复核结论。
- [x] 2. 子任务 1（#56）：完成专注页「时间到」区块重构，跑 `focus-screen.test.tsx`，截图。
- [x] 3. 子任务 2（#54）：提示音设置 + 播放，日历同步 + 权限引导，跑相关测试与设置页测试。
- [x] 4. 集成：`pnpm verify:web` 全绿；浏览器实测「专注结束 + 设置页 + 提醒回归」并截图到 `.verify/issues-54-56/`。
- [ ] 5. 版本 bump、提交计划确认、提交、建 PR（`Closes #56 #54`）。
- [ ] 6. 关闭 #50 / #51（附复核说明），归档子任务与父任务，记录 journal。

## 验证命令

```bash
pnpm --filter @nextdo/mobile test -- focus-screen
pnpm --filter @nextdo/mobile test -- settings-screen
pnpm verify:web
```

## 完成定义

- 三个 issue 的验收标准全部满足或明确降级；
- 门禁全绿 + 浏览器截图证据；
- 提交与 issue 关闭动作经用户确认。
