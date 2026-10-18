# 调研：2 分钟行动完成与流转逻辑（Issue #51）

## 1. 现象与 Issue 描述

### 问题现象
用户在澄清（或重新明晰）流程中：
- Q3 问：“大约 2 分钟内能完成吗？” -> 选择“是，2 分钟内”；
- Q3b 问：“现在就做掉吗？” -> 无论选择“是，现在就做完”还是“否，记成行动”，该行动在完成选择后，用户在界面上都找不到。
- 预期：如果选择“现在完成”，应该出现在“已完成”列表中且状态被正确持久化；如果选择“暂不完成”，应该显示在“待完成”列表中。
- 评论要求（来自 printsdf）：**“我觉得应该在用户选择是否能在两分钟内完成之后选择现在完成的话，直接倒计时 2 分钟，要求用户现在完成。”**
- 用户确认选择：**「唤起 2 分钟专注」：选现在完成后直接跳转并启动应用现有的 Focus 专注模式（2 分钟）**。

## 2. 根因分析（Root Cause）

### 2.1 选择「现在完成」时的逻辑漏洞
1. 现状：
   用户在 `clarify-wizard.tsx` 的 Q3b 选择「是，现在就做完」时，直接调用 `handleDoNow()` -> `submit(buildDoNowSubmission(mode))`。
   在数据库层 `applyClarify` 处理 `do-now-completed` 分支：
   ```ts
   case 'do-now-completed': {
     const record: CompletionRecord = {
       id: ulid(now),
       actionKind: 'do_now',
       actionId: inbox.id,
       completedAt: nowIso,
       estMinutes: null,
     };
     await tx.insertInto('completion_records').values(record).execute();
     break;
   }
   ```
   随后将 `inbox_items` 软删除（`deleted_at = nowIso`）。
   **根本没有创建任何 `next_actions` 行！**

2. 列表查询 `completedActionsQuery` 的漏洞：
   位于 `packages/db/src/queries/actions.ts`：
   ```ts
   export function completedActionsQuery(db: NextdoDb) {
     const next = db.selectFrom('next_actions')...where('status', '=', 'done');
     const calendar = db.selectFrom('calendar_actions')...where('status', '=', 'done');
     const habit = db.selectFrom('habit_days')...where('status', '=', 'done');
     return next.union(calendar).union(habit);
   }
   ```
   「已完成行动」页面（`/completed`）**仅从 `next_actions`、`calendar_actions`、`habit_days` 中查询已完成事项**。
   它根本没有联合 `completion_records` 里 `action_kind = 'do_now'` 的记录！
   因此，当场完成的事项在「已完成行动」页面中是**完全查不到的**！同时在 Inbox 被软删、在 Now 池没创建，在用户看来就是彻底消失！

### 2.2 选择「暂不完成 / 记成行动」时的逻辑
在向导中选择「否，记成行动」时：
向导流转至 `step: 'form'`, `form: 'action'`（预填 2 分钟）。
提交时写入 `next_actions`，状态为 `open`。
但在向导结束展示「已整理为『下一步行动』」后，未自动跳转或引导用户前往「现在」执行池查看；且若在 reclarify 重新明晰或项目内，用户容易误以为该行动应直接存在于原来的列表。

### 2.3 全新交互流转：直达 2 分钟专注
用户明确确认了**「唤起 2 分钟专注」**：
1. 当用户在 Q3b 选择「是，现在就做完」时：
   - 系统为该事项创建一条真实的 `NextAction`（`status: 'open'`, `estMinutes: 2`, `value: 3`）；
   - 若处于 `clarify` 模式，清理对应 `inbox_item`；
   - 立即跳转至 `/focus/${action.id}?kind=next&preset=2&autoStart=1`（或利用 Focus 现有的计时能力立即启动 2 分钟倒计时）；
2. 用户在 Focus 界面中直面 2 分钟倒计时：
   - 倒计时结束或点击「结束专注」后，进入 Nextdo 既有的解耦追问：「专注已完成，行动也完成？」；
   - 点击「完成行动」：调用 `completeAction`，行动状态置为 `done`，写入 `CompletionRecord`，且可在「已完成行动」列表中查看、恢复；
   - 点击「先不完成」或退出：行动保持 `status: 'open'`，安全留存在「现在」执行池（待完成列表）中，绝不丢失！
3. 当用户在 Q3b 选择「否，记成行动」时：
   - 走标准创建行动逻辑（预填 2 分钟），生成 `NextAction`，展示完成卡片，引导进入执行池。
