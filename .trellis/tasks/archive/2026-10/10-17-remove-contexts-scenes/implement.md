# 执行计划：#46 场景能力下线

> 复核门：本文件与 `prd.md` / `design.md` 经用户确认后才 `task.py start`，确认后再动代码。

## 步骤（按依赖顺序）

1. [ ] **存档分支就位**：确认 `park/contexts-scenes` = f398147 且已推 origin（`git ls-remote --heads origin park/contexts-scenes`）。
2. [ ] **定位全部使用点**：`grep -rn "SceneOption\|AddSceneModal\|useContexts\|contextIds\|场景" apps packages --include='*.ts' --include='*.tsx'`（排除 node_modules/dist），与 `research/contexts-scenes-surface.md` §1 对表，补漏。
3. [ ] **Now 屏 + 引擎输入**：condition bar 只留可用时间；`EngineInput.context.contextIds = []`；`lib/engine-context.ts` 去掉 contextIds（+ 测试收敛）。
   - 门槛：`pnpm --filter @nextdo/mobile test now-screen engine-context`。
4. [ ] **向导与各表单**：`clarify-wizard.tsx` 场景多选、`clarify-flow.ts` 的 `FormFields.contextIds`/`initialContextIds`、`projects/[id].tsx`、`(tabs)/projects.tsx`、`edit-action-modal.tsx`、三个 hooks。
   - 门槛：`pnpm --filter @nextdo/mobile test clarify-wizard clarify-flow projects-screen`。
5. [ ] **整文件删除 + 设置入口**：`app/contexts.tsx`、`components/add-scene-modal.tsx`、`hooks/use-contexts.ts`、`packages/ui/src/components/scene-option.tsx` + 导出、设置页入口行、`contexts-screen.test.tsx`。
   - 门槛：`pnpm typecheck`（悬空引用会在这里全部暴露）。
6. [ ] **文档 / 规范（Phase 3.3）**：README、三份 spec、根设计简报（删）、变更说明里写重新实现注意事项。
7. [ ] **门禁 + 浏览器实测**：root 全量 `pnpm lint/typecheck/test`；`.verify/remove-contexts-scenes/`（Now 屏截图 + 旧数据行动仍被推荐 + `evidence.md`，覆盖 AC-2/4）。
8. [ ] **Phase 3.4**：提交计划先发用户确认（本任务单独一条工作提交，便于日后 revert / 对照存档分支），然后进入父任务的发布步骤。

## 复核门（review gates）

- 第 2 步的清单与 research 对表后才开始删；发现清单外的使用点先记下来（可能推翻决策点 A/B）。
- 删除后 `grep` 必须归零（除数据面注释与「已下线」说明）；这是 AC-5 的证据。
- db 测试保留且通过 = 数据面未动的证据（AC-3）。

## 回滚点

- 工作提交单独一条（例：`feat(mobile): 场景（contexts）能力下线，实现存档在 park/contexts-scenes`），revert 即恢复；存档分支是第二重保险。
- 若发现「旧数据里带 contextIds 的行动被错误展示/推荐」，先查引擎输入是否真的传了空数组，再查 hardFilter 的空数组语义 —— 不要就地放宽断言。
