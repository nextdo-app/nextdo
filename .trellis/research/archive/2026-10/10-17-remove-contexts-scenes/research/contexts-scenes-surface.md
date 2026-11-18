# 现状调研：场景（contexts）能力的接触面清单（2026-10-17）

issue #46 的范围 = **整套「场景」能力**（用户已确认），代码保留在 `park/contexts-scenes` 分支（已建，指向 f398147），main 移除。
下面每一行都核对过；清单同时是「删除范围」和「保留范围」的依据。

## 1. 要删除（产品面）

### 路由 / 页面
- `apps/mobile/app/contexts.tsx`（/contexts 管理页：列表 + 软删除 + 快捷新建）
- `apps/mobile/__tests__/contexts-screen.test.tsx`

### 组件
- `apps/mobile/components/add-scene-modal.tsx`（「添加新场景」底部抽屉，含 7 个预设）
- `packages/ui/src/components/scene-option.tsx`（`SceneOption`） + `packages/ui/src/index.ts` 的导出

### Hook / 持久化
- `apps/mobile/hooks/use-contexts.ts`（listContexts / addContext / trashContext 的 UI 包装）
- `apps/mobile/lib/engine-context.ts` 的 `contextIds`（保留 `availableMinutes`）+ `lib/engine-context.test.ts` 中的场景用例

### 使用点（改而不是整删）
- `app/(tabs)/now.tsx`（35 处）：条件栏的场景维度（「当前场景」标题行、管理场景链接、任意/已选 N 个胶囊、SceneOption 横向列表、＋添加场景、AddSceneModal）；**保留**「可用时间」维度
- `components/clarify-wizard.tsx`（18 处）：表单里的场景多选（`CONTEXT_FORMS`）、预览行的场景名、`useContexts` 依赖
- `lib/clarify-flow.ts`：`FormFields.contextIds` 与 `WizardBase.initialContextIds`
- `app/projects/[id].tsx`（8 处）、`app/(tabs)/projects.tsx`（4 处）、`components/edit-action-modal.tsx`（6 处）：表单里的「场景（可选）」块
- `hooks/use-add-next-action.ts` / `use-update-next-action.ts` / `use-action-title.ts`：contextIds 透传
- `app/(tabs)/settings.tsx`（3 处）：设置页「场景管理」入口行
- `lib/reason-labels.ts`：`'context-match'`（ReasonCode）/ `'context-mismatch'`（FilterRuleId）文案 —— 见「保留」第 3 条
- `lib/error-messages.ts`、`lib/app-update.ts`：仅注释/文案提及，随手清理

### 文档
- `README.md:48`「场景与时间自适应」条目、`:230` 功能清单
- `场景条件栏-UI-设计简报.md`（仓库根，156 行；描述的重设计对象即将不存在）
- `.trellis/spec/app/component-guidelines.md`、`.trellis/spec/domain/domain-model.md`、`.trellis/spec/domain/next-action-engine.md` 中的场景段落（Phase 3.3 改为「已下线 + 存档分支」的记录）

### 测试
`__tests__/` 下 12 个文件有命中：`clarify-wizard`、`completed-screen`、`focus-screen`、`habits-screen`、`inbox-screen`、`now-screen`、`projects-screen`、`review-daily`、`review-weekly`、`settings-screen`、`tabs.smoke`、`waiting-screen`、`watch-error-null`、`contexts-screen`（整删）。多数是表单 props/payload 里的 `contextIds` 或文本断言，按删除面收敛。

## 2. 要保留（数据兼容 + 类型系统耦合）

1. **数据面**：`contexts` 表（`packages/db/src/schema.ts:186`，`ContextRow` :303）、`next_actions.context_ids` / `calendar_actions.context_ids` 列（mappers :414/:439/:488/:508）；PowerSync 同步规则（`server/powersync/sync-config.yaml:25,27,30`）；服务端初始化 SQL（`server/app/src/schema-init.ts:113`）。**存量数据不迁、不删**；老客户端不受影响。
2. **db 查询**：`packages/db/src/queries/contexts.ts`（`listContexts`/`addContext`/`trashContext`）+ 其数据层测试保留 —— 表还在，这是它的访问层（若你要连它一起删，说一声）。
3. **core 契约**：`Context` 类型、`NextAction.contextIds`、引擎的 `EngineInput.context.contextIds`（`packages/core/src/engine/types.ts:73`）与 `context-match` / `context-mismatch` 的契约（`engine/filters.ts`、`recommend.ts`、`reason-labels.ts` 的标签表按 `ReasonCode`/`FilterRuleId` 联合类型强制齐全）。本轮**只让输入恒为空数组**（= 随处可执行，永不筛掉任何行动），不动引擎内部；动机见 design.md「决策点 A」。
4. **park 分支**：`park/contexts-scenes`（f398147）保存完整实现；「重新实现时的注意事项」写入下面第 3 节。

## 3. 重新实现时需要注意（写进 PR 变更说明）

- **引擎语义**：context 是 *eligibility*（`hardFilter` 里不匹配直接排除，理由 `context-match`）+ 空数组 = 任意；重建时先确认这个契约是否还要（`packages/core/src/engine/filters.ts`）。
- **数据面已经在同步规则里**，重建不需要新迁移；`contexts` 的软删除（`trashContext`）与「不选即随处可执行」的空态语义是既有约定。
- **UI 教训**（`场景条件栏-UI-设计简报.md` §4，分支里可查）：曾用 `ContextChip` 的哈希配色区分场景，某个名字恰好命中暖色 → 被读成「已选中」，整体回滚。重建时任何场景 chip 的外观都不得取决于名字。
- **向导里的场景多选**曾是 `FormFields.contextIds` 的来源；重建时要同时接回表单提交与预览文案。

## 4. 统计

- 命中文件（apps/packages/server/spec/README，去掉 node_modules/dist/target）：**59 个**；其中 mobile 非测试文件 19 个、core 11 个、db 9 个、ui 2 个、spec 3 个、README 1 个、根文档 1 个。
- 无数据库种子代码：唯一的「种子」是 `app/contexts.tsx:50` 的 `PRESET_SCENES`（UI 文案）与设计简报里的 5 个名字；**没有**启动时写 contexts 行的逻辑，删除不涉及迁移。
