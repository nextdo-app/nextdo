# Waiting For 事项管理与跟进专屏设计

## 1. 架构总览

本任务遵循 Trellis 单向数据流与分层架构（`domain` → `db` → `app` hooks → `app` components）：

```
[packages/core] WaitingForItem 实体类型与断言 (已有)
      │
[packages/db]   waitingForWatchQuery (新增) + add/trashWaitingForItem (已有并导出)
      │
[apps/mobile]   useWaitingForItems Hook (新增)
      │
[apps/mobile]   waiting.tsx 页面 + inbox.tsx 入口 (新增)
```

## 2. 数据库层接口与导出

在 `packages/db/src/queries/watch-queries.ts` 新增：
```typescript
export function waitingForWatchQuery(db: NextdoDb): CompilableQuery<WaitingForItem> {
  const builder = db
    .selectFrom('waiting_for_items')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc');
  return toCompilableQuery(builder, waitingForItemFromRow);
}
```
并在 `packages/db/src/index.ts` 导出：
- `addWaitingForItem`
- `updateWaitingForItem`
- `trashWaitingForItem`
- `waitingForWatchQuery`

## 3. Hook 层设计 (`apps/mobile/hooks/use-waiting-for.ts`)

封装 `@powersync/react` 的响应式查询：
- `data: WaitingForItem[]`（未软删除的事项，实时同步更新）
- `add(title: string, waitingOn: string, options?: { expectedBy?: string; notes?: string }): Promise<void>`
- `trash(id: string): Promise<void>`

## 4. UI 界面设计 (`apps/mobile/app/waiting.tsx`)

- **布局与安全区**：使用 `useAppInsets` 适配各种屏幕安全边距；
- **导航头**：左上角 `← 返回` 按钮，使用 `goBack(router, '/(tabs)/inbox')` 回退，统一全站规范；
- **新建卡片**：
  - 事项标题输入框
  - 等待对象输入框（如：同事、客户、系统等）
  - 可选期望时间选择 / 输入
  - 保存按钮（有校验拦截）
- **事项卡片**：
  - 标题与等待对象高亮标签（Tag/Badge: `等待: 张三`）
  - 预期时间展示（逾期标红提示）
  - 右下角快捷按钮：`已完成 / 结束等待`（一键软删除归档）
- **空状态**：使用 `@nextdo/ui` 的 `EmptyState`。

## 5. 入口设计 (`apps/mobile/app/(tabs)/inbox.tsx`)

在收件箱顶部卡片或操作栏中，放置 `等待事项 (N) →` 跳转胶囊，实现从收集到委托跟进的自然流转。
