# Agent Note: 收件箱支持直接完成与废弃，不再强制走澄清

Status: implemented

## Problem

收件箱里的待澄清事项，即使用户已经做完了、或者决定不需要做了，也只能先进入「下一步澄清」流程再处理掉。澄清问的是「这件事接下来要变成什么」，对已经完成或已经放弃的事项没有意义，多出来的几步让收件箱这个「大脑缓冲区」不再是零摩擦入口（issue #106）。

## Decision

- `packages/db/src/queries/inbox.ts` 增加 `completeInboxItem(db, { id, now })`：一个事务内先读取仍存活的 InboxItem（校验在写事务内部，两次并发点击会串行，第二次看到已软删除的行并抛 `inbox.not-found`），再写入一条 `do_now` CompletionRecord（`actionId` = InboxItem id，`estMinutes` = null），并软删除该 InboxItem。不创建任何 action 实体。
- 该形状沿用 domain-model 的「DO NOW, completed on the spot」定义；回顾侧 `resolveReviewTitles` 已经包含 `inbox_items`（含软删除行），所以完成记录仍能解析出标题。
- UI（`apps/mobile/app/(tabs)/inbox.tsx`）：每行标题下方一行操作，「完成」一键完成；「废弃」先进入确认态（``确认废弃？``）再调用既有的 `trashInboxItem`（软删除，可从回收站恢复）；「处理 →」保留给确实需要推进的事项。行布局改为标题独占一行、操作按钮单独一行，避免窄屏挤压。
- `apps/mobile/hooks/use-complete-inbox-item.ts` 照 `use-trash-inbox-item` 的模式委托 db 事务，`now` 来自 `useAppClock`；错误与 capture/trash 错误一起显示在收件箱顶部。重复提交的 `inbox.not-found` 视为幂等成功（行已不存在，目标状态已达成），不显示错误横幅；其他错误照常显示。

## Alternatives considered

- **创建 2 分钟 NextAction 再调用 `completeActionInTransaction`** — 好处是直接复用完成事务、条目会出现在「已完成行动」列表。否掉原因：收件箱没有估时，2 分钟是编造出来的；这会凭空生成一个用户从未澄清过的 action，而 domain-model 明确规定「完成在当下」的 do-now 不创建 action 实体。
- **「完成」只调用 `trashInboxItem`，不写 CompletionRecord** — 实现最简单。否掉原因：完成后没有任何完成记录，每日回顾的「今日完成」会漏掉这批事项，完成与废弃也就没有语义差别。
- **点击行弹出操作菜单（复用 `ActionMenuModal`）** — 能容纳更多动作。否掉原因：issue 要求「直接选完成/废弃」，多一层弹层正是要消除的摩擦。

## Consequences

- **收益**：收件箱对「已完成 / 不需要」两类事项各有一个直接出口；完成会进入每日回顾的完成记录，废弃保留回收站恢复路径。
- **代价与已知上限**：直接完成的条目不会出现在「已完成行动」窗口（该窗口只 union 三张 action 表），只出现在每日回顾的完成列表。若用户开始在两个「完成」入口之间感到不一致，应把 `do_now` 记录接入该窗口。

## Verification

- `packages/db/src/test/queries.inbox.test.ts` 的 `completeInboxItem (issue #106)`：断言完成记录形状、InboxItem 软删除、不创建 NextAction、回顾标题可解析，重复/缺失 id 抛 `inbox.not-found` 且不写记录；并发调用两个 `completeInboxItem` 只产生一条完成记录。
- `apps/mobile/__tests__/inbox-screen.test.tsx`：完成一键调用 `completeInboxItem` 且停留在收件箱；重复完成返回 `inbox.not-found` 时不显示错误横幅；其他失败显示错误横幅且行保留；废弃先进入确认态再调用 `trashInboxItem`。
- 浏览器实测（`pnpm verify:web` 产物 + 390×700 视口）：新建捕获 →「完成」行消失；新建捕获 →「废弃」→「确认废弃？」→ 行消失；同一行连续触发两次「完成」后行消失且页面无错误横幅（幂等的 `inbox.not-found` 不上屏）。失败态由脚本在 `MessagePort` 层拦截下一次 `insert into "completion_records"` 并注入一次 Comlink 异常：错误横幅显示、行保留；随后重试成功且横幅消失，未修改生产代码。
