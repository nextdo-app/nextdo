# Technical Design: 2 分钟行动完成与流转逻辑（Issue #51）

## 1. 系统设计与架构调整

### 1.1 数据层与事务边界
- **此前缺陷**：`applyClarify` 中的 `do-now-completed` 分支仅向 `completion_records` 插入一条 `action_kind = 'do_now'` 且 `action_id = inbox_item.id` 的孤立记录，随后直接软删 `inbox_items`。`next_actions` 从未有行记录，且 `completedActionsQuery` 也未连查 `inbox_items`。
- **全新流转（配合 2 分钟专注）**：
  - 在 `applyClarify` 和 `reclarifyAction` 中，新增契约或对 `do-now` 的处理策略重构：
    当 Q3b 选择「现在就做完」时，不再直接一步打死为已完成，而是将其物化为一条合法的 `NextAction`：
    - `id = ulid(now)`
    - `title = inbox.title`（或原行动 title）
    - `estMinutes = 2`
    - `value = 3`（GTD 推荐默认值）
    - `status = 'open'`
    - `projectId` 继承 Q2b 选择
    - 事务内软删除原 `inbox_item`（或在 reclarify 软删旧行动）。
  - 返回新生成的 `action.id`，并在前台立刻跳转 `/focus/${action.id}?kind=next&preset=2&autoStart=1`。

### 1.2 Focus 页面支持 2 分钟预设与自动启动
- `apps/mobile/app/focus/[id].tsx`：
  - 读取路由参数 `preset`（如 `preset=2`）和 `autoStart`（如 `autoStart=1`）。
  - 当 `actionId` 有效且当前尚无 `activeSession` 时，如果传入了 `preset` 且 `autoStart === '1'`，在挂载时自动触发 `focus.start(actionId, Number(preset))`。
  - 倒计时即刻从 02:00（120 秒）开始跳动。
  - 结束逻辑完全复用 Focus 既有的双阶段解耦机制（`completeFocusSession` -> 追问「行动也完成？」 -> `completeAction` 或 `先不完成`）。

### 1.3 列表闭环与状态持久化
- **已完成列表（`/completed`）**：
  - 用户在 Focus 追问中点击「完成行动」时，触发 `completeAction({ actionKind: 'next', actionId })`。
  - 行动状态置为 `done`，生成标准 `CompletionRecord`。
  - `listCompletedActions` 和 `completedActionsQuery` 完美查询到该 `next_actions` 行。
  - 用户随时可以在「已完成行动」中查阅，点击「恢复为未完成」即可一键撤销并回流执行池。
- **待完成列表（`/now`）**：
  - 用户若在 Focus 追问中点击「先不完成」或中途返回，行动保持 `open` 状态。
  - 处于 `next_actions` 中且 `deleted_at IS NULL`，实时在「现在」执行池（或备选清单中）可见。
- **Q3b 选「记成行动」**：
  - 维持 `toForm`，预填 `estMinutes: 2`，提交后作为 `NextAction` 存入数据库，向导完成页提示清晰，引导用户回到 Now 查看。

## 2. 影响文件与边界
- `apps/mobile/lib/clarify-flow.ts`：更新 submission 构建与流转动作。
- `apps/mobile/components/clarify-wizard.tsx`：Q3b 选择「现在就做完」后，若创建成功直接通过 `router.push` 进入 Focus。
- `packages/db/src/queries/inbox.ts`：支持将 do-now 物化为 NextAction 并返回其 id。
- `apps/mobile/app/focus/[id].tsx`：支持 URL 参数传入 `preset` 与 `autoStart`。
- 测试用例：`apps/mobile/__tests__/clarify-wizard.test.tsx`、`apps/mobile/__tests__/focus-screen.test.tsx`、`packages/db/src/test/queries.inbox.test.ts`。
