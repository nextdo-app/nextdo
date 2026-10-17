# 截止时间与提醒时间

## Goal

截止字段由「只选日期」改为「日期+可选时刻」；行动新增可选「提醒时间」（有截止时预填为截止时刻、可改，无截止也能单设），复用 reminders 表与现有通知投递层，含取消/重排与截止 chip 文案

## Requirements

- **R1 截止时间**：项目与行动的截止字段从「只选日期」改为「日期 + 可选时刻」。
  - 不填时刻 → 存当天 23:59:59（与现有数据、现有引擎阈值一致，旧数据不迁移也不改显示）；
  - 填了时刻 → 存该精确时刻（本地时区）。
  - 覆盖所有截止入口：项目 Tab 新建项目、项目详情 编辑项目 / 添加行动 / 编辑行动、Now 屏的编辑行动弹窗、澄清向导的项目表单与行动表单。
- **R2 提醒时间（行动）**：行动新增可选「提醒时间」（日期 + 时刻）。
  - 表单打开时的预填规则：该行动已有 `state='scheduled'` 提醒 → 显示它；没有提醒但有截止时间 → 截止带显式时刻则预填同一时刻；**截止只选了日期则预填当天 10:00**（提醒在 23:59 响没有意义）；预填结果若已过去 → 留空（不塞一个过去的时刻）。用户可改早/改晚/清空。
  - 没有截止时间也能单独设提醒 —— 本次的核心诉求。
  - 项目（project）本轮不加提醒，理由见 Non-goals。
- **R3 投递与取消**：提醒复用 `reminders` 表与现有投递层（reconcile + native/tauri/web 适配器 + 通知总开关/权限）。
  - 保存行动：同一事务里取消旧的 scheduled 提醒、写入新提醒（无提醒则不写）；
  - 完成 / 删除 / 稍后（snooze）行动：既有事务已按 `action_id` 取消 scheduled 提醒（`packages/db/src/queries/actions.ts:336` / `:533`），本次不新增代码，但必须有测试守住；
  - 提醒时刻已过去或为空：不写提醒行（不排过去时刻的通知）。
- **R4 展示**：截止 chip 能读出时刻（`DeadlineChip` → `formatDeadline`）：
  - 截止带「有意义的时刻」（本地 23:59 以外）→ 文案带时刻，如「今天 18:00 截止」「还剩 2 天 · 10:00」；
  - 存量数据（23:59:59）保持现有文案（今天截止 / 还剩 N 天），不让老数据突然多出一个「23:59」。
- **R5 时间语义**：全部用 `DateTimePicker`（`mode='datetime'`）选取，不加手输；存储一律 ISO UTC，显示按设备本地时区。

## Non-goals（本轮明确不做）

- **项目的提醒时间**：提醒的 kind 白名单是 `next | calendar | habit`（`packages/db/src/queries/reminders.ts` 的三个 LEFT JOIN + `ScheduledReminderRow.kind`），项目不是行动。扩枚举的代价不只是新代码：同步到旧客户端时未知 kind 会被当成孤儿提醒并被**取消**本机通知（前向兼容风险），所以单独开任务再做。
- 手写日期/时刻：一律用 picker（`app/component-guidelines.md` §Forms）；每日回顾里的「排期到 YYYY-MM-DD」是 snooze 不是 deadline，本次不顺手改。
- 重复提醒 / 提前量规则（提前 10 分钟、每天提醒等）：v1 只做「一个行动一个提醒时刻」。
- 提醒的已触发/历史状态：v1 的 `reminders` 不写 `fired`（沿用现状）。

## Acceptance Criteria

- [ ] AC-1 表单：新建项目、编辑项目、添加行动、编辑行动、编辑行动弹窗、澄清向导的项目与行动表单都能选到「日期 + 时刻」；不选时刻时保存结果与今天完全一致（本地当天 23:59:59）。
- [ ] AC-2 预填：截止设成 18:00 → 「提醒时间」预填 18:00；截止只选日期（不选时刻）→ 预填当天 10:00；预填时刻若已过去 → 留空。改过提醒时间再保存后，`reminders` 表里只有一条 `state='scheduled'`、`fires_at` = 新时刻的行。
- [ ] AC-3 独立提醒：没有截止时间也能设提醒（如「明天 09:00」），保存后 `reminders` 行为 `action_kind='next'`、`action_id` = 该行动。
- [ ] AC-4 取消：完成 / 删除该行动后，它的 scheduled 提醒变为 `cancelled`（既有事务），native 模式下 reconciles 会把 OS 侧待发通知撤下。
- [ ] AC-5 过去时刻：提醒时刻在过去 → 不写提醒行。
- [ ] AC-6 chip 文案：带时刻的截止显示时刻（如「今天 18:00 截止」）；存量 23:59 数据仍显示「今天截止 / 还剩 N 天」。
- [ ] AC-7 门禁与证据：`pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿（新增回归测试覆盖 R1–R5），并在 `.verify/deadline-time-reminder/` 留下浏览器实测截图与 `evidence.md`。

## Notes

- 领域层早已把 `deadline` 存成精确时刻（`packages/core/src/domain/types.ts:59`：“ISO datetime (exact moment; drives deadline-urgency in exact hours)”），UI 只是用 `endOfLocalDayIso` 把它压成了当天 23:59 —— 本次改的是入口粒度，不是数据模型。
- 用户原话：「截止日期改成截止时间，方便提醒，即使没有时间，也可以让用户设置提醒时间」；已在问答中确认：「两个字段，提醒默认跟随截止（有截止时预填为截止时刻、可改），没有截止也能单独设」。
