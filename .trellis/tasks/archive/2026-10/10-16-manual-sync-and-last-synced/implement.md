# 执行计划：手动同步入口 + 上次同步时间

## 顺序清单

1. `apps/mobile/lib/sync-status.ts`（新）— `deriveSyncDisplay` + `formatLastSyncedAt` 纯函数。
2. `apps/mobile/lib/sync-status.test.ts`（新）— 各状态与「从未同步」分支。
3. `apps/mobile/hooks/use-sync-status.ts`（新）— `useStatus` + `getUploadQueueStats` + `syncNow()`。
4. `apps/mobile/app/(tabs)/settings.tsx` — 云同步卡片接状态行 / 「立即同步」/ 上次同步时间。
5. `apps/mobile/__tests__/settings-screen.test.tsx` — 各态渲染断言。

## 验证命令

```bash
pnpm --filter @nextdo/mobile test -- sync-status settings-screen
pnpm lint
pnpm typecheck
pnpm verify:web        # 交付前全量门禁；跑完打印 http://localhost:4180
```

浏览器实测：打开 `http://localhost:4180/settings`，确认云同步卡片的未连接态与新增文案；截图到 `.verify/manual-sync/`。已连接态的限制见 `design.md`「验证策略与已知限制」。

## 风险点 / 回滚点

- **回滚**：不新增依赖、不改 schema、不改连接选项；`git revert` 单个提交即可复原。
- `syncNow()` 会短暂断开同步流 —— 只在用户显式点击时发生，不得在任何自动路径（mount / 定时器）里调用。
- `useStatus()` 的 mock 已存在于 `settings-screen.test.tsx` 等测试中（返回 `{ status: 'synced', isSynced: true }`）；改用真实字段名时要同步更新 mock，否则屏幕测试会静默失真。
- `getUploadQueueStats()` 在未连接时也会返回（本地队列），不要把它当作「已连接」的依据。
- 超时保护必须存在：`waitForStatus` 在离线时会一直不满足，按钮不能永久停在「同步中…」。

## `task.py start` 前复查

- [ ] `prd.md` / `design.md` / `implement.md` 齐全
- [ ] `implement.jsonl` / `check.jsonl` 有真实条目
- [ ] 无阻塞性 open question
- [ ] 浏览器实测的已知限制已记录，交付时如实说明
