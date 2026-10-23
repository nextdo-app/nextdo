# 执行计划 — 备注 Markdown 渲染

## 步骤 1：解析器（`packages/core`）

1. 新建 `src/lib/markdown.ts`：`parseMarkdown`、`parseMarkdownInline`、`markdownInlineSummary`、`markdownToPlainText`。
2. 新建 `src/lib/markdown.test.ts`：每个块级构造、每个行内构造、降级用例、`snake_case`、未闭合围栏、任意输入不抛错。
3. `src/index.ts` 显式导出函数与类型。

**验证**：`pnpm --filter @nextdo/core test -- markdown` → 17 项通过。

## 步骤 2：渲染组件（`packages/ui`）

1. 新建 `src/components/markdown-note.tsx`：`MarkdownNote`，`mode: 'block' | 'inline'`，`numberOfLines`、`onLinkPress`。
2. `src/index.ts` 导出组件与 props 类型。

**验证**：`pnpm --filter @nextdo/mobile test -- markdown-note` → 9 项通过（`packages/ui` 无测试基建，按仓库惯例在 mobile 侧覆盖渲染）。

## 步骤 3：接入展示

1. `apps/mobile/app/(tabs)/now.tsx`：行动卡片的备注从 `<Text>` 换成 `<MarkdownNote mode="inline" numberOfLines={2} />`。
2. `apps/mobile/app/projects/[id].tsx`：行动行在标题下插入 `<MarkdownNote value={action.note} />`。

**验证**：`pnpm --filter @nextdo/mobile test -- now-screen projects-screen`。

## 步骤 4：编辑器预览

1. `apps/mobile/components/edit-action-modal.tsx`：新增 `notePreview` 状态（随 action 重置），标题行加「预览 / 编辑」切换，预览用 `<MarkdownNote>`。
2. `apps/mobile/app/projects/[id].tsx` 的 `EditActionForm`：同样处理。

**验证**：`pnpm --filter @nextdo/mobile test -- clarify-wizard projects-screen`。

## 步骤 5：日历描述去标记

1. `apps/mobile/lib/calendar-sync/reminder-plan.ts`：`notes` 写 `markdownToPlainText(...).trim() || undefined`。
2. `apps/mobile/lib/calendar-sync/reconcile.ts`：同上。
3. `reminder-plan.test.ts` 加回归断言。

**验证**：`pnpm --filter @nextdo/mobile test -- reminder-plan reconcile`。

## 步骤 6：门禁与实测

1. `pnpm verify:web`（lint → typecheck → test → build:web → serve）。
2. 浏览器实测：在备注里写入含标题/列表/粗体/链接的 Markdown，确认 Now 卡片两行截断、项目详情完整排版、编辑器预览一致、日历描述无标记；截图存入 `.verify/10-22-note-markdown-rendering/` 并写 `evidence.md`。
3. 更新 `.trellis/spec/app/component-guidelines.md`（MarkdownNote 约定）与 `.trellis/spec/domain/domain-model.md`（note 是 Markdown 原文，日历描述为纯文本）。

## 已知限制

- 真机（iOS/Android）观感未在本轮验证：需要设备或模拟器加 `npx expo prebuild`，本地只能验证纯逻辑与 Web/浏览器。
- 日历事件描述的多段备注会被压成一行（`·` 连接），因为系统日历描述本就是纯文本段落。
