# 专注历史与统计（issue #96）

状态：已实现，2026-11-20。浏览器实测结果见下文「验证」。

## 背景与范围

- 缺口：`focus_sessions` 有完整读写，但没有历史或统计视图；README 路线图
  「专注时长热力图与长期统计报表」未完成（issue #96）。
- 入口：回顾页（Review）的「专注历史」卡片 → `/focus-history`。
- 内容：汇总（今日 / 本周 / 总计）、12 周热力图、7 天 / 8 周时长趋势、
  完成与放弃的会话列表。
- 不做：导出报表、按行动/项目筛选、专注会话编辑或删除。

## 默认选择（issue 未固定）

- 历史只含终态会话：`completed` 与 `abandoned`；`active` 属于专注屏。
- 放弃会话的时长计入统计，因为时间实际花掉了；列表用标签区分状态。
- 统计按**会话开始时刻的设备本地日期**归桶，跨午夜不拆分；跨时区以设备
  本地日历为准。
- 周从周一开始；趋势窗口为最近 7 个本地日与最近 8 个本地周（含当前）。
- 热力图 12 周，颜色阈值固定为每日 0 / 1–14 / 15–29 / 30–59 / 60+ 分钟。
- 时长不落库，由 `endedAt − startedAt − pausedSec` 派生。

## 实现

- DB 读侧：`packages/db/src/queries/focus.ts`
  - `focusSessionsWithTitle` 抽出「会话 + 行动标题」的 LEFT JOIN（标题为
    `null` 表示行动已被删除）；`listCompletedFocusSessions` 改为复用它。
  - `listFocusHistory` / `focusHistoryQuery` / `focusHistoryFromRow`：
    终态会话，`started_at` 倒序，带 `mode` / `plannedMinutes` / `pausedSec` /
    `status`。
  - `packages/db/src/queries/watch-queries.ts` 的 `focusHistoryWatchQuery`
    让历史页随本地写入自动刷新。
  - `packages/db/src/index.ts` 导出 `listFocusHistory`、`FocusHistoryRow`、
    `focusHistoryWatchQuery`。
- 聚合：`apps/mobile/lib/focus-stats.ts`，纯函数、注入 `now`：
  - `focusDurationSec` 派生时长并夹到 ≥ 0；
  - `buildFocusStats` 生成日/周桶、12 周热力图、今日/本周/总计。
  - 日期键用 `localDateKey`；跨 DST 用本地正午锚点做日期加减。
- 数据 hook：`apps/mobile/hooks/use-focus-history.ts`，直接包
  `focusHistoryWatchQuery`，暴露 `{ data, error, loading }`。
  `@powersync/react` 2.0.1 的 watch 结果没有 `refresh`（只有 `runQueryOnce`
  路径才有），所以不提供伪重试；读取失败后的「重试加载」由页面改变子组件
  `key`，卸载后新建 watch 并重新读取，正常 watch 更新不受影响。
- 页面：`apps/mobile/app/focus-history.tsx`。
  - 空数据、加载中、读取失败（含重试）三种状态。
  - 词条与日期用设备本地格式；跨午夜的会话在结束时间前补日期。
- 回顾页：`apps/mobile/app/(tabs)/review.tsx` 新增「专注历史」入口卡片。

## 测试

- `packages/db/src/test/queries.focus.test.ts`（15/15）：
  - 终态会话倒序、`active` 排除、标题 join；
  - `mode` / `plannedMinutes` / `pausedSec` / `status` 保留；
  - 软删除会话排除；行动被删后标题为 `null`、时长记录仍在；
  - `focusHistoryWatchQuery` 编译并返回同样的行。
- `apps/mobile/__tests__/focus-stats.test.ts`（6/6）：
  - 暂停时长扣减与非法时间；
  - 本地日期 / 周一分桶、周日归上一周、跨午夜算开始日；
  - 热力图固定阈值；空窗口补零；窗口外会话只进总计。
- `apps/mobile/__tests__/focus-history-screen.test.tsx`（5/5）：
  - 汇总、热力图/趋势可访问标签、完成/放弃列表；
  - 日/周切换；空、加载状态；
  - 读取失败后重试：mock 与真实 SDK 一样不返回 `refresh`，断言重试新建
    watch、再次读取并清除错误。
- `apps/mobile/__tests__/review-screen.test.tsx` 增加入口卡片断言。

## 验证

- 门禁：`pnpm verify:web --no-serve` 通过（退出码 0）。测试合计 1656：
  core 275、server 133、db 374、mobile 874；lint、typecheck、web 构建均通过。
- 浏览器实测（headless Chrome，2026-11-20）：
  - 先打开 `/focus-history`，空状态「还没有专注记录」可见。
  - 从收件箱记录并澄清一条「整理实验数据（专注测试）」为普通下一步行动
    （预估 30 分钟），在 Now 页进入专注：
    - 第一次运行约 65 秒后点「结束专注」→「先不完成」，历史多一条「完成」；
    - 第二次运行约 65 秒后点「放弃」，历史多一条「放弃」。
  - 回顾页「专注历史」卡片可打开页面；汇总为「今日 2 分钟 / 本周 2 分钟 /
    总计 2 分钟」，列表显示两条「· 1 分钟」记录和「完成 1 · 放弃 1」。
  - 热力图当天单元格与日趋势条都显示「11月20日 专注 2 分钟」；切到「近 8 周」
    后，本周趋势条显示「11月16日 专注 2 分钟」（周一开始）。
  - 读取失败与重试：在页面加载前注入一次性 Comlink `execute` 故障，匹配
    `focus_sessions` + 标题 JOIN 的历史 SELECT（不匹配 EXPLAIN），延迟 1.5 秒
    后返回 THROW。打开历史页先看到「加载中…」，随后显示注入的错误；点
    「重试加载」后新建 watch，错误消失，汇总与列表正常显示。

## 边界

- 未验证：原生端本地 SQLite / PowerSync 的真实 watch 通知（浏览器用 web
  worker）。查询一致性由 db 测试覆盖。
- 统计以会话开始日归桶，不按结束日拆分；跨日长会话会整段计入开始日。
