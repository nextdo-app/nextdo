# Someday 转行动 / 项目（issue #91）

## 状态

已实现（2026-11-20），已合入 main（2026-11-22，`3b82069`）。

## 当前行为（代码事实）

- 周回顾的 Someday 行有四个决定：保留、转为行动、转为项目、删除。
- 转为行动：创建一条 `open` 的 NextAction（进入「现在」执行池），并软删除原
  Someday 项。
  - 表单字段：行动标题（预填 Someday 标题）、预计分钟（预填 10）。
  - 价值默认 3；表单不提供自定义价值。
  - 原 Someday 备注会带到新行动的备注；转为项目时带到首个行动（没有首个行动
    则记录在回顾记录并在详情显示，见上）。
- 转为项目：创建 `active` 项目，可勾选同时创建首个行动。
  - 项目名称（预填）、项目结果（必填）、首个行动标题（预填）与时长（默认 10）。
  - 项目价值默认 3。
  - 没有首个行动时，原 Someday 备注保存到回顾记录的 `promotion.sourceNote`，
    回顾详情「Someday 决定」显示「原备注：…」；不需要从回收站恢复源项才能
    读到备注。有首个行动时备注带到行动上。
- 原子性：目标行创建、Someday 软删除与回顾记录写入在同一个事务里；任何一步
  失败全部回滚，原 Someday 项保留。
- 回顾记录 `answers.somedayDecisions` 保存 `to: 'action' | 'project'` 与
  `promotion` 字段；回顾详情页已有「转为行动 / 转为项目」文案。
- 提交前做客户端校验（空标题、空项目结果、时长不大于 0）；校验失败停在本页，
  选择与输入保留。
- 未实现：Someday 页直接转换、自定义价值 / 场景 / 截止日期、批量转换。

## 实现与测试

- 类型：`packages/core/src/domain/types.ts` 的 `SomedayPromotion`
- 校验：`packages/core/src/domain/invariants.ts`（项目结果必填、字段范围）
- 默认值：`packages/core/src/domain/clarify.ts` 的
  `SOMEDAY_PROMOTION_DEFAULT_EST_MINUTES`
- 数据：`packages/db/src/queries/someday.ts` 的
  `promoteSomedayMaybeItemInTransaction`；
  `packages/db/src/queries/reviews.ts` 的周回顾事务
- UI：`apps/mobile/app/review/weekly.tsx`
- 测试：`packages/core/src/domain/invariants.test.ts`、
  `packages/db/src/test/queries.reviews.test.ts`、
  `apps/mobile/__tests__/review-weekly.test.tsx`

## 待用户确认（实现假设，不是当前规则）

- 转换后原 Someday 项软删除（移出清单），不保留副本。
- 只在周回顾提供转换；Someday 页保持列表 + 删除。
- 默认价值 3、默认时长 10 分钟；表单不提供价值 / 场景 / 截止日期。
- 项目结果必填（沿用 Clarify 的领域规则）。

## 来源

- issue #91（2026-11-20）：Someday/Maybe 支持转回行动或项目，补全回顾闭环。
- 领域规范 `.trellis/spec/domain/domain-model.md` 的 SomedayMaybeItem 节。
