# 资料库（ReferenceItems）

## 状态

MVP 已实现（2026-11-20），已合入 main（2026-11-22，`18bd415`）。
**资料库入口是可选功能：用户可以关闭或不启用资料库**（2026-11-19 用户确认）。
关闭只隐藏入口与澄清选项，不删除已存资料。

## 当前行为（代码事实）

- 领域模型：`ReferenceItem` = `title`, `url?`, `note?`
  （`.trellis/spec/domain/domain-model.md`）。
- 厘清向导可选择「资料（留个参考）」并写入 `reference_items`。
- 资料库开关在「设置 → 通用与偏好」；默认开启。
  - 关闭后隐藏「现在」页的「资料库」入口，并隐藏澄清向导的「资料」选项；
    已有资料保留，重新开启后可见。开关写失败会恢复原值并显示提示。
- 入口：「现在」页二级列表导航「资料库」，不新增 tab。
- 列表：live watch query（`referenceItemsWatchQuery`）；显示 title、url 域名、
  备注预览（Markdown 截断 3 行）；空链接显示「无链接」。
- 搜索：客户端过滤 title / note / url。
- 行操作：打开链接、编辑 title / url / note、二次确认后软删除。软删除可在回收站恢复（issue #89）。
  - 打开前用统一解析器校验；只接受绝对 `http` / `https` 链接。
  - 旧资料里的 `file:`、`javascript:`、非法端口等链接显示「链接格式异常」与修正提示，
    不显示打开按钮，也绝不传给系统 opener。
- 校验：空标题拒绝；非空链接用平台 `new URL()` 解析，校验协议、host 与端口
  （非法端口、无协议、`ftp:` / `file:` / `javascript:` 拒绝；IPv4、IPv6、单段 host、
  中文域名等合法地址接受）。保存失败保留表单与旧数据。
- 失败态：列表读取失败、编辑 / 删除写入失败、Web `localStorage` 写入失败均显示中文提示。
  Web 写入失败时开关回滚到上次已持久化值，不报告成功。
- 没有独立详情页、硬删除或全文索引；v1 只是链接与备注。

## 实现与测试

- 页面：`apps/mobile/app/references.tsx`
- 链接解析：`apps/mobile/lib/reference-url.ts`（保存、打开、域名展示共用）
- 数据：`apps/mobile/hooks/use-reference-items.ts`、
  `packages/db/src/queries/watch-queries.ts` 的 `referenceItemsWatchQuery`
- 开关：`apps/mobile/lib/reference-library-settings.ts`、
  `apps/mobile/hooks/use-reference-library-settings.ts`
- 接线：`apps/mobile/app/(tabs)/now.tsx`、`apps/mobile/app/(tabs)/settings.tsx`、
  `apps/mobile/components/clarify-wizard.tsx`
- 测试：`apps/mobile/__tests__/references-screen.test.tsx`、
  `apps/mobile/lib/reference-url.test.ts`、
  `apps/mobile/lib/reference-library-settings.test.ts`、
  `apps/mobile/__tests__/use-reference-library-settings.test.ts`、
  Now 入口开关、澄清选项开关、
  `packages/db/src/test/queries.collections.test.ts` 的 watch/list 一致性。

## 已实现但尚未经用户确认的选择（实现假设，不是当前规则）

- 默认开启（理由：澄清已能写入资料；默认关闭会让已有资料不可见）。
- 开关放在「设置 → 通用与偏好」。
- 关闭时同时隐藏澄清向导的「资料」选项，避免继续写入不可见数据。
- 关闭后保留已存资料；重新开启即可再看到。
- 软删除而不是硬删除；恢复走回收站。

## 计划顺序（历史）

1. ~~先修 Focus 时长静默回退 bug~~ 已完成（2026-11-19，PR #88）。
2. 资料库 MVP —— 已完成（2026-11-20）。

## 来源

- 2026-11-19 用户确认：资料库为可选启用；先做 bug，资料库后做。
- 2026-11-19 reviewer 代码检查：存储接口已有、UI 入口缺失；MVP 验收要点。
- 2026-11-20 issue #90 实现与审查（本工作树）。
