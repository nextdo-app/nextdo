# 等待事项的预期日期、跟进时间与回顾读侧（issue #94）

## 状态

已实现（2026-11-20，分支 `fix/waiting-for-fields`，工作树改动未提交）。

## 问题

Waiting For 页面只能新建标题、类型和等待对象；`expectedBy` / `followUpAt`
没有写入入口，行不能编辑。回顾读侧只消费 `expectedBy`，完全忽略
`followUpAt`，与领域规范「followUpAt 到期进入 Daily Review」不一致。

## 当前行为（代码事实）

- 新建表单新增两个可选字段：
  - 预期日期：`date` 选择器；
  - 跟进时间：`datetime` 选择器。
- 日期存储沿用 Clarify 的本地日约定：
  - `expectedBy` 的纯日期按当地当天 23:59:59 写入；
  - `followUpAt` 保存所选本地时刻；只选日期时同样落在当天结束；
  - 清除字段写入 `NULL`。
- 每行新增「编辑」，展开同一表单（不离开页面）。保存走
  `updateWaitingForItem`；写入失败时编辑态和输入保留，顶部显示错误。
- 回顾读侧按两个字段各自的含义判定：
  - `expectedBy` 是日期：设备本地日为今天或更早即入选；
  - `followUpAt` 是时刻：该时刻已过（`<= now`）才入选；只选日期时存为
    当天结束，因此当天 23:59:59 才到期。今天更晚的时刻不算逾期。
  - Daily 与 Weekly 共用同一查询 helper；两个日期都到期时该 id 只出现一次。
- 编辑表单区分「未改 / 明确修改 / 清空」：未触碰的日期字段不进入 patch，
  保留原始 ISO 时刻；明确修改才按当前设备本地时区重新编码；清空写 `NULL`。
- 「已得到结果」仍为软删除，行为不变。

## 实现与测试

- `packages/db/src/queries/reviews.ts` — `overdueWaitingFollowUps` 改名为
  `dueWaitingFollowUps`：`expectedBy` 按本地日、`followUpAt` 按精确时刻判定。
- `apps/mobile/components/datetime-picker.tsx` — datetime 模式接受
  `YYYY-MM-DD` 初值（此前会回退到 now，重新打开纯日期跟进会改成今天）。
- `apps/mobile/hooks/use-waiting-for.ts` — 新增
  `update(item, patch)`；合并整行、更新 `updatedAt`、错误上报与
  `submitting` 沿用既有模式。
- `apps/mobile/app/waiting.tsx` — 共用新建/编辑表单、日期字段、行内编辑、
  跟进标签与失败提示；日期字段带 dirty 标记，未改字段不发送 patch。
- 测试：
  - `packages/db/src/test/queries.reviews.test.ts` — followUpAt 到期（无
    expectedBy）、未来 followUpAt 不入选、同日未来时刻不入选、恰好到点与
    已过时刻入选（Daily/Weekly 一致）、expectedBy 与 followUpAt 同时到期
    去重；fixture 快照断言改为包含 `waiting.due`。
  - `apps/mobile/__tests__/waiting-screen.test.tsx` — 新建携带两个日期、
    编辑保留未改日期、清除日期、写入失败保留输入、纯日期跟进的选择器初值、
    跨时区原始 ISO 只改标题时逐字节保留。
  - `apps/mobile/__tests__/datetime-picker.test.tsx` — datetime 模式恢复
    纯日期初值并原样确认（真实选择器）。
- 规范同步：`.trellis/spec/domain/domain-model.md` 的 WaitingForItem 段。

## 待确认（实现假设，不是当前规则）

- 编辑保存写入整行（`updateWaitingForItem` 的既有契约），但日期字段仅在
  用户改动时进入 patch，未改值保持原始存储时刻。
- 允许选择过去的日期；与 Clarify 一致，过期项显示为逾期。
- 预期日期不提供时间部分；若将来需要精确到时刻，需同时改存储约定与回顾
  触发口径。

## 来源

- issue #94（2026-11-20）：等待事项补全预期日期、跟进时间、编辑与回顾读侧。
- `.trellis/spec/domain/domain-model.md` 的 WaitingForItem 段。
