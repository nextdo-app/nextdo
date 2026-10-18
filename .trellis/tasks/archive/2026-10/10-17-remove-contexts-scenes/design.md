# 技术设计：#46 场景（contexts）能力下线

## 1. 结论先行

**产品面整体移除，数据面原样保留，引擎输入恒为空数组。** 完整实现存档在 `park/contexts-scenes`（= f398147，删除前的最后一个提交），main 不再包含它。

三层边界：

| 层 | 处置 | 理由 |
| :--- | :--- | :--- |
| 产品面（UI / 路由 / hook / 表单字段 / 文案 / 测试 / 文档） | 删除 | issue #46 要求「main 不需要这些代码」 |
| 数据面（表 / 列 / 同步规则 / 服务端 init SQL / db 查询） | 保留 | 「删除不会影响数据兼容性」；同步给旧客户端不炸 |
| 引擎契约（`context-match` / `context-mismatch` / `EngineInput.context`） | 保留，输入恒 `[]` | 见决策点 A |

## 2. 删除清单（逐文件动作）

### 2.1 整文件删除
- `apps/mobile/app/contexts.tsx`（/contexts 管理页）
- `apps/mobile/__tests__/contexts-screen.test.tsx`
- `apps/mobile/components/add-scene-modal.tsx`
- `apps/mobile/hooks/use-contexts.ts`
- `packages/ui/src/components/scene-option.tsx` + `packages/ui/src/index.ts` 中的 `SceneOption` / `SceneOptionProps` 导出
- `场景条件栏-UI-设计简报.md`（根；存档分支里还有）

### 2.2 改造（去场景维度）
- `app/(tabs)/now.tsx`：条件栏只保留「可用时间」（5 档 + 自定义）；删除「当前场景」标题行、管理场景链接、任意/已选 N 个胶囊、SceneOption 列表、＋添加场景、`AddSceneModal` 与 `modalVisible` 状态、`useContexts`/`useFocusEffect` 的 reload 接线。
- `hooks/use-now*.ts` 与 now.tsx 的 `EngineInput` 构造点：`context: { contextIds: [], availableMinutes }`（实施时先 `grep -rn contextIds apps/mobile` 定位全部构造点）。
- `lib/engine-context.ts`：`EngineContextSettings` 去掉 `contextIds`（保留 `availableMinutes`；存储键不变，旧 blob 的多余键被忽略）+ `engine-context.test.ts` 相应收敛。
- `components/clarify-wizard.tsx`：删 `CONTEXT_FORMS` 的场景多选块、预览行的场景名、`useContexts` 依赖与 `contextNames`。
- `lib/clarify-flow.ts`：`FormFields.contextIds` 与 `WizardBase.initialContextIds` 删除；`buildFormSubmission` 不再输出 `contextIds`（db 默认 `[]`）；re-clarify 的旧场景不再回填（能力已下线）。
- `app/projects/[id].tsx` / `app/(tabs)/projects.tsx` / `components/edit-action-modal.tsx`：删「场景（可选）」块与 contextIds 透传。
- `hooks/use-add-next-action.ts` / `use-update-next-action.ts` / `use-action-title.ts`：contextIds 参数与注释清理。
- `app/(tabs)/settings.tsx`：删「场景管理」入口行（保留其余设置分组结构）。

### 2.3 文档 / 规范
- `README.md:48`「场景与时间自适应」→「时间自适应」（含 `:230` 清单项）。
- `.trellis/spec/domain/domain-model.md`、`next-action-engine.md`、`.trellis/spec/app/component-guidelines.md`：场景段落改为「已下线；实现存档在 `park/contexts-scenes`；重建注意事项」的短记录（Phase 3.3 统一改）。
- `lib/reason-labels.ts`：`'context-match'` / `'context-mismatch'` 保留（字面量联合类型强制齐全；见决策点 A）。`lib/error-messages.ts` / `lib/app-update.ts` 的顺带提及清理。

### 2.4 测试
- 整删：`contexts-screen.test.tsx`。
- 收敛：`now-screen`、`clarify-wizard`、`settings-screen`、`projects-screen`、`inbox-screen`、`completed-screen`、`focus-screen`、`habits-screen`、`review-daily`、`review-weekly`、`waiting-screen`、`watch-error-null`、`tabs.smoke`（多为表单 props / fixture 里的 `contextIds: []`）。
- db：`queries.collections.test.ts` 等对 contexts 表/查询的测试**保留**（数据面）。

## 3. 保留清单（与 research §2 一致）

`schema.ts`（contexts 表、`ContextRow`、四个 mapper 的 context_ids）、`server/powersync/sync-config.yaml`、`server/app/src/schema-init.ts`、`packages/db/src/queries/contexts.ts` + 数据层测试、core 的 `Context` 类型与 `contextIds` 字段、引擎的 context 契约。

## 4. 决策点（复核时可否决）

- **A. 引擎契约保留、输入恒空**：删掉引擎的 context 逻辑会牵动 `engine/filters.ts`、`recommend.ts`、`types.ts`、`ReasonCode`/`FilterRuleId` 联合类型与其全部测试，风险与收益不成比例；且 `contextIds` 列既然保留，契约留着正好描述「空=任意」。
- **B. 数据面全留（含 db 查询层）**：表在、列在、同步规则在 —— 查询层是它的访问面；只删产品面最符合「不影响数据兼容性」。
- **C. re-clarify 不再回填旧场景**：能力下线后表单没有该字段；替换行 contextIds 为空（= 随处可执行）。这是预期行为，不是丢失。

## 5. 存档与变更说明

- 分支：`park/contexts-scenes`（f398147）→ 推送 origin（AC-1）。
- 变更说明（PR 描述 + spec）记录：场景能力对应的产品场景、数据面保留的范围、**重新实现注意事项**（research §3：引擎 eligibility 语义、数据面已在同步面、哈希配色的教训、向导接线）。

## 6. 风险与回滚

- 回滚 = revert 本条工作提交；数据面未动，无需补偿。
- 风险：别的模块仍引用被删符号（typecheck 会立刻暴露）；并行 deadline 任务交叠（见父任务 R5）。

## 7. 验证

1. `grep -rn "SceneOption\|AddSceneModal\|useContexts\|/contexts\|场景" apps packages` 归零（除 data 面注释与存档说明）。
2. `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。
3. 浏览器实测：Now 屏无场景维度、候选池含（旧数据里带 contextIds 的）行动；截图 + `evidence.md`（AC-4）。
4. db 测试证明 contexts 表与 `context_ids` 列照常读写（AC-3）。
