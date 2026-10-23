# 技术设计 — 备注 Markdown 渲染

## D1 分层归属

| 关注点 | 位置 | 理由 |
|---|---|---|
| 解析 | `packages/core/src/lib/markdown.ts` | 纯函数、零依赖（`project/directory-structure.md` Rule 1 硬约束），可在无 React 环境下单测 |
| 渲染 | `packages/ui/src/components/markdown-note.tsx` | 两处以上复用 → 归 `packages/ui`（`directory-structure.md` 归属表） |
| 链接打开 | 调用方 | `Linking` 是平台关注点，`packages/ui` 不引入 |

不新增依赖。仓库已有 lint 规则会在 `packages/core` 出现运行时依赖时报错，且 `quality-guidelines.md` 要求任何新依赖在 PR 说明里论证——自研 200 行解析器比引入 `react-native-markdown-display`（需要额外 RN 版本对齐与样式覆盖）更符合约束。

## D2 数据模型

```ts
type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'strike'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'quote'; children: MarkdownInline[] }
  | { type: 'code'; text: string; lang?: string };
```

导出：`parseMarkdown`、`parseMarkdownInline`、`markdownInlineSummary`、`markdownToPlainText`。

## D3 契约：不丢内容

这是本设计的核心不变量，也是唯一的失败模式来源（备注是自由文本，会存进 DB 再显示）。

1. **任何输入都不抛错**。解析器没有 `throw`，所有正则都是可选的。
2. **任何输入都不丢字符**。子集外的构造降级为字面文本：
   - `**` 不配对 → 两个星号原样输出；
   - `[x](y` 括号不闭合 → 整段原样输出；
   - 孤立 `` ` `` → 原样输出；
   - `snake_case` 中的 `_` 前后是单词字符 → 不当作强调（避免最常见的误判）。
3. **未闭合围栏吞掉剩余内容**，因为用户正在输入时看到的就是这样，比丢弃正文更符合预期。

## D4 两种渲染形态

- **block**：一个块一个 `<Text>`（列表是 `<View>` 行 + 序号/圆点 + 内容），用于项目详情——那里整行就是内容。
- **inline**：`markdownInlineSummary` 把全部块压平成一段（块之间、列表项之间用 ` · ` 连接，代码块只保留首行），保留强调节点但丢弃换行。这样 `numberOfLines={2}` 仍能截断，列表行不会被文档撑开。

链接在 inline 形态下不可点：截断的行里出现意外的跳转目标是错误行为。

## D5 编辑器预览

备注框编辑原文，非空时标题行右侧出现「预览 / 编辑」切换。预览复用同一个 `MarkdownNote`，因此用户在编辑器里看到的就是列表里的效果。切换 action 时预览状态重置，避免打开到上一次的预览。

## D6 日历描述

`reminderEventSpec`（提醒通道）与 `buildCalendarSyncPlan`（日历行动）写 `notes` 前调用 `markdownToPlainText`。系统日历不渲染强调，`**重要**` 会连星号一起显示。剥掉标记后若为空则写 `undefined`，让 `device.ts` 回退到默认描述。

签名（`calendarEventSignature`）基于剥标记后的描述，因此「只改了标记符号」不会触发一次无意义的事件更新。

## D7 风险

- **`markdownToPlainText` 的 `·` 连接**可能让多段备注在日历描述里变成一行。可接受：日历描述本来就是纯文本段落。
- **行内模式的信息损失**：列表序号与换行在列表行里不可见。可接受：列表行是摘要，完整内容在项目详情与编辑器预览里。
- **性能**：解析是 O(n) 单遍扫描 + 每行正则，备注规模下无感；`parseMarkdown` 没有缓存，也不需要对 React 做 memo（渲染只在数据变化时发生）。

## 变更文件

- 新增 `packages/core/src/lib/markdown.ts`、`packages/core/src/lib/markdown.test.ts`
- 新增 `packages/ui/src/components/markdown-note.tsx`、`apps/mobile/__tests__/markdown-note.test.tsx`
- 修改 `packages/core/src/index.ts`（导出）、`packages/ui/src/index.ts`（导出）
- 修改 `apps/mobile/app/(tabs)/now.tsx`（行内渲染）
- 修改 `apps/mobile/app/projects/[id].tsx`（块级渲染 + 编辑器预览）
- 修改 `apps/mobile/components/edit-action-modal.tsx`（编辑器预览）
- 修改 `apps/mobile/lib/calendar-sync/reminder-plan.ts`、`reconcile.ts`（描述去标记）
- 修改 `apps/mobile/lib/calendar-sync/reminder-plan.test.ts`（回归断言）
- 更新 `.trellis/spec/app/component-guidelines.md`、`.trellis/spec/domain/domain-model.md`
