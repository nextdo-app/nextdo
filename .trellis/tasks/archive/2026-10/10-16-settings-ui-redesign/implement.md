# 设置页面 UI 重构执行计划

## Checklist

- [x] **Phase 1: 准备与基线确认**
  - [x] 确保测试 `pnpm --filter @nextdo/mobile test __tests__/settings-screen.test.tsx` 通过
  - [x] 激活任务（`task.py start`）

- [x] **Phase 2: 代码重构与组件美化**
  - [x] 更新 `settings.tsx` 页面容器布局（`max-w-2xl` 居中收敛）
  - [x] 实现优雅的分组小节头（SectionHeader）
  - [x] 重构「通用与偏好」卡片（带图标的主题分段选择 + 场景管理 Cell）
  - [x] 重构「提醒与通知」卡片（聚合应用内通知与习惯提醒）
  - [x] 重构「数据与同步」卡片（优化教程 Banner、Tab 切换、状态展示与断开操作）
  - [x] 重构「关于与更新」卡片（统一 Switch 开关、美化渠道选择器）
  - [x] 开关激活状态全面对齐设计系统品牌主色（`colors.accent` / `#c85a17`），修复 Web 纯白滑块圆钮与干净背景轨

- [x] **Phase 3: 验证与交付**
  - [x] 运行单元测试验证功能无回归（`pnpm --filter @nextdo/mobile test __tests__/settings-screen.test.tsx`）
  - [x] 运行工程级类型检查与 Lint（`pnpm lint` && `pnpm typecheck`）
  - [x] 启动本地 Web 并用浏览器截图验证（浅色与深色，保存至 `.verify/settings-ui-redesign/`）
  - [ ] 提交检查报告与完成验收
