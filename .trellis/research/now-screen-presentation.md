# 「现在」页展示与「换一个」规则

状态：用户已确认，2026-11-18 已实现并验证（Web）。以下规则带条件，不可扩写成「永远」。

## 「换一个」

- 只在存在其他可执行备选（`eligible` 中除当前推荐外还有行动）时写 skip。
- skip 写入成功后才切换推荐；写入失败时停在原推荐，不假装已切换。
- 同一会话内，每个行动最多写一次 skip。轮回到本次已跳过的行动时只移动视图，不再写 skip。
- 只有 1 条可执行时，按钮禁用并显示「暂无其他备选」。
- 不改变引擎排序：候选顺序仍取 engine 返回的 `eligible` 顺序，不重新打分。

## 备选清单

- 只列除当前推荐外的可执行行动；计数用该列表长度，不用 `eligible` 总数。
- 没有备选时整块隐藏。
- 推荐卡本身带完成入口；备选行保留完成与更多操作入口。

## 习惯块

- 顶部保留快速打卡条：最多列出 3 个今日未打卡习惯，每个一行快速打卡按钮；超过 3 个时显示「还有 N 项…」，右上角「全部」进入习惯页。
- 底部改为摘要：进度条、「今天习惯 X/Y」、「进行中 N 个 · X 天周期 · 本期累计 M 天」、
  「管理」入口；不再有逐习惯操作行。
- 有昨日未打卡习惯时，摘要下方显示「可补昨日」与习惯名 chip。

## 依据

- 实现：`apps/mobile/app/(tabs)/now.tsx`、`apps/mobile/hooks/use-skip-action.ts`、
  `apps/mobile/lib/reason-labels.ts`、`apps/mobile/lib/action-links.ts`。
- 测试：`apps/mobile/__tests__/now-screen.test.tsx`（轮换、失败停留、单行动禁用、
  备选排除当前推荐、习惯摘要与补打卡）、`apps/mobile/hooks`/`lib` 相关单测。
- 浏览器证据：`.verify/now-tab-cleanup/evidence.md`、`.verify/now-tab-cleanup/run.log`。
  「换一个」连续点击实测标题序列 A → B → A → B。
