# 执行计划：截止时间与提醒时间

> 复核门：**本文件与 `prd.md` / `design.md` 经用户确认后才 `task.py start`**，确认后再动代码。

## 步骤（按依赖顺序）

1. [ ] **core：时间与文案**
   - `apps/mobile/lib/clarify-flow.ts`：新增 `localDateTimeToIso` / `localDateTimeKey`（`endOfLocalDayIso` 保留为日期分支）。
   - `packages/core/src/domain/deadline.ts`：`formatDeadline` 增加「本地 23:59 哨兵 → 旧文案 / 否则带 HH:mm」分支（哨兵具名常量 + 注释）。
   - `packages/core/src/domain/invariants.ts`：新增 `deadlineReminderSpec(firesAt, now)`。
   - 单测：`deadline.test.ts`（新分支）、`clarify-flow.test.ts`（两个新函数）、`invariants/state` 相关（工厂的过去/未来）。
2. [ ] **db：提醒的写与读**
   - `packages/db/src/queries/actions.ts`：`addNextAction` / `updateNextAction` 接受 `reminderAt`，事务内「取消旧的 + 写新的」（照 `actions.ts:484-500` 的 snooze 写法）。
   - `packages/db/src/queries/reminders.ts`：新增 `listScheduledReminderFor`。
   - 测试：新增/修改/清空/过去时刻不写；完成与删除事务取消 deadline 提醒。
3. [ ] **mobile：表单**
   - 截止字段 6 处改 `mode="datetime"` + 展示格式化；行动表单加「提醒时间（可选）」与预填逻辑（表单打开读一次：已有提醒→显示；截止带时刻→同刻；**截止只有日期→当天 10:00**；预填已过去→留空；用户改过就不再跟随截止）。
   - 提交走 `localDateTimeToIso`；`clarify-flow` 的三处调用点同步替换。
   - 测试：编辑行动表单预填（三种情形）、保存时的 payload 形状。
4. [ ] **门禁 + 浏览器实测**
   - `pnpm lint && pnpm typecheck && pnpm test`（root，全 workspace）。
   - `node scripts/verify-web.mjs --port=4180` → `.verify/deadline-time-reminder/capture.mjs`（脚本按 `project/quality-guidelines.md`「交互态截图」四条写）→ 截图 + `labels`/数据断言写入 `evidence.md`。
5. [ ] **规范更新（Phase 3.3）**：`domain/domain-model.md`（截止时刻语义 + 23:59 哨兵）、`domain/next-action-engine.md`（若文案/阈值表述受影响）、`app/component-guidelines.md` §Forms（截止/提醒字段用 datetime picker）。
6. [ ] **Phase 3.4**：提交计划先发给用户确认（按顺序 add + commit，不 amend、不 push），然后提示 `/finish-work`。

## 复核门（review gates）

- 每层改完先跑该层单测（core / db / mobile 各自 `pnpm --filter`），最后跑 root 全量。
- 浏览器实测必须覆盖 AC-1/2/3/6；`reminders` 行的断言来自 db 查询（脚本或测试），不能只看截图。
- 交付说明里写明桌面端提醒的投递限制（应用未运行就会错过）。

## 回滚点

- 三层各自可独立 revert；无数据迁移，回滚不需要补偿脚本。
- 若发现「写提醒」让行动保存变慢或事务失败率上升：先把 `reminderAt` 的写入降级为「保存后异步补写」，再定位（不要就地放宽断言）。
