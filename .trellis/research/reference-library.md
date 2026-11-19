# 资料库（ReferenceItems）

## 状态

计划中，尚未实现。**资料库入口是可选功能：用户可以关闭或不启用资料库**
（2026-11-19 用户确认）。这是实现时的产品约束，不是当前已实现的行为；
具体开关位置、默认值与关闭后的行为尚未确认。

## 现状（代码事实）

- 领域模型：`ReferenceItem` = `title`, `url?`, `note?`
  （`.trellis/spec/domain/domain-model.md:189`）。
- 厘清向导已能选择「资料（留个参考）」并写入 `reference_items`
  （`apps/mobile/components/clarify-wizard.tsx:559`）。
- DB 已有 `listReferenceItems` / `updateReferenceItem` /
  `trashReferenceItem`（`packages/db/src/queries/references.ts`）。
- `apps/mobile` 下没有资料列表、详情或搜索路由/入口，归档后无法找回。

## 计划顺序

1. ~~先修 Focus 时长静默回退 bug~~ 已完成（2026-11-19，PR #88，合并提交
   27c1fde）：超过 180 分钟夹紧到 180 并提示，autoStart 正常启动。
2. 再做资料库 MVP。

## MVP 范围建议（尚未确认，非当前规则）

- 入口沿用「现在」页的二级列表导航，不新增 tab（reviewer 产品建议）。
- read model：补 watch hook；列表展示 title / note / url 域名，v1 客户端过滤。
- 行操作：打开链接、编辑 title / url / note、软删除；删除确认与其他列表一致。
- 验收重点：归档后立即可见且重启后仍可检索；title / url / note 都可编辑；
  空链接不显示打开按钮；非法链接给出可恢复错误；列表 / 删除写入失败保留
  数据并提示。

## 来源

- 2026-11-19 用户确认：资料库为可选启用；先做 bug，资料库后做。
- 2026-11-19 reviewer 代码检查：存储接口已有、UI 入口缺失；MVP 验收要点。
