# 实现计划：支持编辑行动、项目与习惯 (Issue #19)

## 任务拆解与执行顺序

1. **Phase 1: DB 层增强与测试**
   - 修改 `packages/db/src/queries/habits.ts`：在 `updateHabit` 中支持周期/起始日/频率变更时的自动补种（`seedHabitDays`）。
   - 在 `packages/db/src/queries/habits.test.ts` 中添加测试用例，验证更新习惯起始日期与频率后补种逻辑正确执行。

2. **Phase 2: Mobile Hooks 扩展与新增**
   - 在 `apps/mobile/hooks/use-update-next-action.ts` 中补充 `contextIds?: string[]` 支持。
   - 新增 `apps/mobile/hooks/use-update-habit.ts`。
   - 新增或更新相关单元测试。

3. **Phase 3: 习惯编辑表单与界面集成**
   - 创建 `apps/mobile/components/edit-habit-form.tsx`。
   - 在 `apps/mobile/app/habits.tsx` 中为每个习惯行添加「编辑」按钮与表单展开。
   - 在 `apps/mobile/app/projects/[id].tsx` 中为项目习惯卡片添加「编辑」按钮与表单展开。

4. **Phase 4: 行动编辑表单场景补全与 Now 屏集成**
   - 在 `apps/mobile/components/edit-action-modal.tsx`（或统一组件）中，添加场景情境多选支持。
   - 在 `apps/mobile/app/projects/[id].tsx` 的 `EditActionForm` 补全场景选择。
   - 在 `apps/mobile/app/(tabs)/now.tsx` 的 `ActionRow` 和 Hero 卡片中增加「编辑」入口并集成编辑模态框。

5. **Phase 5: 验证与交付**
   - 运行单元测试并补齐测试用例。
   - 运行项目全量门禁：`pnpm verify:web`。
   - 启动本地服务，使用浏览器工具（cursor-ide-browser）在 `.verify/issue-19-edit-items/` 目录下完成截图验证。
   - 交付并向用户汇报。
