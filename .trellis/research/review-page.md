# 回顾页面（issue #67）

状态：本次切片代码完成，浏览器实测按用户要求跳过（2026-11-22）；#67 其余方向待做。

## 现状（代码事实）

- 回顾 tab（`apps/mobile/app/(tabs)/review.tsx`）有今日 / 本周两张入口卡与
  历史记录；历史记录支持加载中、空态与加载失败重试。
- 日回顾（`app/review/daily.tsx`）已能对未完成行动做完成 / 安排到明日 /
  暂不处理 / 排期，并提交 `review_records`。
- 周回顾（`app/review/weekly.tsx`）已能调整项目状态、处理 Someday、
  勾选跟进与两个确认项。
- 回顾详情（`app/review/[id].tsx`）只读展示提交时的快照与决定，不修改数据。

## 本次增量：详情跳转

- `lib/review-detail.ts` 的 section 从纯文本行改为
  `{ text, href? }` 条目；有路由的目标才带 `href`：
  - 项目 → `/projects/<id>`（日回顾的「缺少行动的项目」；周回顾的项目
    列表、停滞项目、项目状态决定）；
  - 等待事项 → `/waiting`（日/周的待跟进与本次跟进）；
  - Someday 决定 → `/someday`。
- 行动与日程没有独立详情路由，仍是纯文本；不构造假链接。
- 详情页对带 `href` 的条目渲染为可点击行（`accessibilityRole="link"`，
  文案后加 `→`），其余保持不变。
- 测试：`lib/review-detail.test.ts` 覆盖各 section 的链接与回退标题；
  `__tests__/review-detail-screen.test.tsx` 覆盖点击项目/等待事项的
  `router.push` 以及无链接条目不渲染为链接。

## issue #67 剩余方向

- 日 / 周 / 月回顾的周期切换（当前只有日、周）。
- 完成数、完成率、逾期数、延期数等指标与趋势图。
- 从回顾结论生成新任务 / 下一周期计划。
- 回顾记录批量处理、分享或导出。
- 生成中 / 生成失败等生成态（当前提交是同步事务，只有提交失败提示）。

## 验证记录

- 门禁（2026-11-22，合并后）：`pnpm verify:web --no-serve` 通过；server 134、
  core 313、db 415、mobile 1079，共 1941 项；web 构建通过。日志：
  `/Users/printsdf/.claude/jobs/df844aba/tmp/verify-merge-final.log`。
- 浏览器实测：跳过（2026-11-22 用户明确要求「不用这个 browser check 了」）。
  本切片不声称浏览器已验证；链接的点击行为由
  `__tests__/review-detail-screen.test.tsx` 的 `router.push` 断言覆盖。
  如果以后要补测：创建项目 → 提交日回顾 → 打开历史详情 → 点击项目条目
  → 落到 `/projects/<id>`；周回顾同样验证；等待 → `/waiting`，
  Someday → `/someday`，删除项目后旧记录链接应出现「项目不存在」。
