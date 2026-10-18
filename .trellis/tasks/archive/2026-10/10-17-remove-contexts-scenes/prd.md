# #46 场景能力下线：从 main 移除，代码保留在 park/contexts-scenes

## Goal

https://github.com/nextdo-app/nextdo/issues/46 —— 整体移除场景（contexts）能力：Now 条件栏筛选、向导场景多选、设置入口、/contexts 管理页、SceneOption/AddSceneModal、引擎场景匹配及相关类型/测试/文档；数据保留、代码存档到 park/contexts-scenes 分支

## Requirements

- **R1 从 main 移除场景（contexts）的产品面**（清单：`research/contexts-scenes-surface.md` §1）：`/contexts` 路由、`SceneOption` / `AddSceneModal`、`use-contexts`、Now 屏条件栏的场景维度、澄清向导的场景多选、设置页「场景管理」入口、README / spec / 根设计简报里的场景文案。
- **R2 保留数据面**：`contexts` 表、`next_actions.context_ids` / `calendar_actions.context_ids` 列、PowerSync 同步规则、服务端初始化 SQL、db 查询层 —— 存量数据不迁、不删；引擎输入恒为空数组（= 随处可执行，不再筛掉任何行动）。
- **R3 代码存档 + 变更说明**：`park/contexts-scenes`（f398147）分支保留完整实现并推送 origin；PR 变更说明记录「被删除代码对应的场景 + 重新实现时需要注意的事项」（research §3）。
- **R4 行为等价**：删除后任何行动在 Now 屏都可执行；存量带 `contextIds` 的行动照常展示、完成、同步。
- **R5 不留死引用**：表单 props / payload / 注释 / 文案 / 测试断言 / spec 段落同步清理。

## Non-goals

- 不动引擎内部契约（决策点 A：`context-match` / `context-mismatch` 保留，输入恒空 → 永不命中）。
- 不做数据库清理/迁移（决策点 B：表、列、查询层原样保留）。
- 不删 `.trellis/` 里的历史归档任务文档。

## Acceptance Criteria

- [ ] AC-1 `park/contexts-scenes` 分支存在且已推送（= 删除前的完整实现，可随时 `git diff` 找回）。
- [ ] AC-2 main 上不存在场景产品面（路由/组件/hook/条件栏场景行/向导多选/设置入口）；`pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。
- [ ] AC-3 数据面完好：无迁移；db 测试证明 contexts 表与 `context_ids` 列照常读写。
- [ ] AC-4 行为：Now 屏无场景筛选，候选池不再被 context 过滤（单测 + 浏览器实测截图）；带旧 contextIds 的行动仍出现在推荐里。
- [ ] AC-5 README / spec 更新为「已下线，实现存档在 park/contexts-scenes」；根设计简报从 main 删除。
- [ ] AC-6 变更说明含重新实现注意事项（写进 PR 描述）。

## Notes

- 决策点 A（默认：保留引擎契约）与 B（默认：保留数据面）的动机在 `design.md`；不同意的部分在复核时说一声。
- 与另一条并行任务的交叠：deadline 任务也改 `clarify-flow.ts` / `clarify-wizard.tsx`（表单字段），合并顺序需一条先落。
