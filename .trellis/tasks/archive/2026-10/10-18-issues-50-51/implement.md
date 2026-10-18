# Implementation Plan: 修复 issues #50 #51 集成与测试版发布

## 1. 阶段路线图

- [ ] 1. 实施子任务 1：修复手机端习惯时间选择器高度坍缩（`10-18-habit-time-picker-mobile`）
  - 修改 `apps/mobile/components/datetime-picker.tsx`；
  - 运行并通过单元测试；
  - 归档子任务 1。
- [ ] 2. 实施子任务 2：修复两分钟行动完成与流转逻辑（`10-18-two-minute-action-flow`）
  - 修改 `packages/db/src/queries/inbox.ts`、`apps/mobile/app/focus/[id].tsx`、`apps/mobile/components/clarify-wizard.tsx`；
  - 运行并通过全量单元测试；
  - 归档子任务 2。
- [ ] 3. 跨任务浏览器实测（.verify/issues-50-51）：
  - 手机视口习惯时间窗口选择器；
  - 澄清 2 分钟行动 -> 进入 2 分钟专注倒计时 -> 完成后在已完成列表确认与恢复。
- [ ] 4. 版本升级与门禁校验：
  - 按照测试版规范同步升级 6 处版本号为 `0.1.8-beta.1`；
  - 全量 lint、typecheck、test（所有子工程）、build:web 校验通过。
- [ ] 5. 提交确认、分支推送与 PR 提交。
