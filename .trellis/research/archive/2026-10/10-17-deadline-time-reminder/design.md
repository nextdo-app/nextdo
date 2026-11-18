# 技术设计：截止时间与提醒时间

## 1. 结论先行

本次只改「入口粒度 + 提醒接线」，**不动数据模型、不加列、不改 schema**：

- `deadline` 早就是精确时刻（`packages/core/src/domain/types.ts:59`）；变的是表单能选到时刻，以及表单值从 `YYYY-MM-DD` 变成可选的 `YYYY-MM-DDTHH:mm`。
- 提醒复用既有的 `reminders` 表 + `use-reminder-delivery` reconcile 循环 + 各平台适配器；新增的只是「谁在什么事务里写这行」。

## 2. 时间表示（唯一的边界约定）

| 层 | 形状 | 谁负责 |
| :--- | :--- | :--- |
| 表单 state / picker 值 | `YYYY-MM-DD`（只选日期）或 `YYYY-MM-DDTHH:mm`（选了时刻），本地时区 | `DateTimePicker`（已有 `DATETIME_LOCAL` 正则，`datetime-picker.tsx:29`） |
| 数据库 / 领域 | ISO UTC 精确时刻 | 表单提交时的转换 |

新增两个纯函数（放 `apps/mobile/lib/clarify-flow.ts`，与 `endOfLocalDayIso` 并列）：

- `localDateTimeToIso(value: string): string | null` —— 含 `T` 时按本地墙钟构造精确时刻；只含日期时**回落到 `endOfLocalDayIso`**（旧行为，零迁移）；非法返回 null。
- `localDateTimeKey(iso: string): string` —— 反向：ISO → 本地 `YYYY-MM-DDTHH:mm`，用于表单预填（沿 `localDateKey` 的既有做法）。

`endOfLocalDayIso` 保留并被复用（它成了「没选时刻」这一分支），因此存量数据、`clarify-flow` 的既有测试全部不动。

## 3. core 层

1. **提醒工厂**：新增 `deadlineReminderSpec(firesAt: Date, now: Date): ReminderSpec | null`，与 `calendarActionReminderSpec`（`packages/core/src/domain/invariants.ts:415`）同形 —— 过去时刻返回 `null`（AC-5），强度沿用一次性提醒的既有取值；不合并/不改名 `snoozeReminderSpec`（它的语义属于 snooze，另有强度约定）。
2. **chip 文案**：`packages/core/src/domain/deadline.ts` 的 `formatDeadline` 增加时刻分支，判定规则是**本地 23:59 哨兵**：本地 `HH:mm === '23:59'` 视为「只选了日期」，沿用「今天截止 / 还剩 N 天」；否则文案带 `HH:mm`（如「今天 18:00 截止」）。哨兵要用具名常量 + 注释写清「存量数据与不选时刻的落盘值都是它」，避免后人以为这是巧合。
3. `deadlineStatus` / `DEADLINE_SOON_HOURS` 不变 —— 阈值本来就按小时算，带时刻后只会更准。
4. **默认提醒时刻常量**：`DEFAULT_DATE_ONLY_REMINDER_HHMM = '10:00'` 放 `packages/core/src/domain/deadline.ts`（与习惯的 `DEFAULT_ALL_DAY_REMINDER_HHMM` 同一个做法）—— 截止只选了日期时，提醒预填这一天 10:00：默认值属于 core，UI 不得写死字符串。

## 4. db 层（`packages/db`）

1. `addNextAction` / `updateNextAction`（`packages/db/src/queries/actions.ts`）输入增加 `reminderAt?: string`（ISO，缺省 = 不设提醒；`null` 的语义不用区分，二者都表示「保存后没有提醒」）。事务里照抄 snooze 的既有写法（`actions.ts:484-500`）：
   - 先 `updateTable('reminders').set({state:'cancelled'})` 清掉该 action 的 scheduled 行；
   - 再用 `deadlineReminderSpec` 的结果 `insertInto('reminders')`（`action_kind: 'next'`，`state: 'scheduled'`）。
   同一个事务 ⇒ 行动保存失败不会留下孤儿提醒；而「取消旧 + 写新」的语义让「改提醒时间」天然幂等（AC-2）。
2. 新增 scoped 读：`listScheduledReminderFor(db, kind, actionId)`（扩 `queries/reminders.ts`，复用同一套 join 与标题解析），供表单预填与测试断言使用。
3. 完成/删除的事务无需改动（已按 `action_id` 取消，`actions.ts:336` / `:533`），但要在 db 测试里补一条「deadline 提醒也会被完成事务取消」的回归。

## 5. mobile 层

- **表单**（6 处）：`app/(tabs)/projects.tsx`（新建项目）、`app/projects/[id].tsx`（编辑项目 / 添加行动 / 编辑行动）、`components/edit-action-modal.tsx`、`components/clarify-wizard.tsx`（项目表单 + 行动表单）。
  - 截止字段：`DateTimePicker mode="datetime"`；picker 的 `value` 用 `localDateTimeKey(...)`（已有截止）或空串；`PickerField` 的展示文本用新格式化函数（`10月20日 18:00` / `10月20日`），不直接把 `T` 串甩给用户。
  - 提醒字段（**仅行动**）：label 「提醒时间（可选）」；表单打开时读 `listScheduledReminderFor`，有则显示；没有则按截止**预填一次**：截止带显式时刻 → 同一时刻；截止只有日期（23:59 哨兵）→ 当天 `DEFAULT_DATE_ONLY_REMINDER_HHMM`（10:00）；预填结果已过去 → 留空（不写一个过去的提醒，与 `calendarActionReminderSpec` 对过去时刻返回 null 一致）。用户改动后以 state 为准（不跟随后续截止编辑，避免把用户改过的值再拽回去）。
  - 提交：`deadline: localDateTimeToIso(deadline)`，`reminderAt: localDateTimeToIso(reminder)`。
- **`lib/clarify-flow.ts`**：`FormFields.deadline` 现在可含时刻；`toNextActionInput` / `toProjectInput` 里的三处 `endOfLocalDayIso(fields.deadline)` 换成 `localDateTimeToIso`（行为向后兼容，`endOfLocalDayIso` 仍被它内部调用）。
- **观察**：`use-reminder-delivery` 的 `WATCHED_TABLES` 已含 `reminders`/`next_actions`，写完即 reconcile，无需新钩子。

## 6. 兼容 / 风险 / 回滚

- **无迁移**：没有新表、新列、新 kind；`reminders` 早已在同步规则（`server/powersync/sync-config.yaml:33`）、初始化 SQL 与上传白名单里。
- **前向兼容**：不给 `action_kind` 加值（项目提醒延后正是为了这个），因此新旧客户端对同一份数据的解读一致。
- **桌面端限制（沿用现状，需在交付说明里写明）**：tauri 没有 OS 级排程，提醒只在应用运行/聚焦时靠 30s tick 投递（±35s），关着应用就错过了 —— 与习惯提醒完全同一套限制，不是本次引入的。
- **时区**：存 UTC 瞬间；跨时区同步后显示的是同一瞬间的本地时间，符合「截止时刻」的语义。
- **回滚**：三层改动彼此独立（core 文案/工厂 → db 参数 → 表单），单一 commit revert 即恢复；没有数据形态变更，无需回滚脚本。

## 7. 验证

1. 单测：`deadlineReminderSpec`（过去/未来/null）、`formatDeadline`（哨兵 vs 显式时刻 + 逾期/今天/剩 N 天四条分支）、`localDateTimeToIso` / `localDateTimeKey`（含非法输入）。
2. db 测试：写提醒（新增/修改/清空/过去时刻不写）、完成与删除事务取消提醒、`listScheduledReminderFor`。
3. mobile 测试：编辑行动表单的提醒预填三种情形（截止带时刻 → 同刻；截止只有日期 → 10:00；预填结果已过去 → 留空）+ 已有提醒时显示提醒；chip 文案在 Now / 项目详情的呈现。
4. 浏览器实测：`node scripts/verify-web.mjs --port=4180` + `.verify/deadline-time-reminder/capture.mjs`（沿用 form-field-labels 那套 CDP 交互脚本写法，规范见 `project/quality-guidelines.md`「交互态截图」），覆盖 AC-1/2/3/6，产出 evidence.md。
