# 同步：手动同步入口 + 上次同步时间

## Goal

issue #22：设置页提供「立即同步」入口与同步中/成功/失败反馈，展示「上次同步时间」，并区分同步中/已同步/有未同步改动/失败。

## Background（现状，含代码锚点）

- `apps/mobile/app/(tabs)/settings.tsx` 云同步卡片：`state === 'connected'` 只渲染「已连接 — 数据在这台设备与服务器之间自动同步。」+ 两个只读地址 + 断开按钮。**无手动同步入口、无上次同步时间**。
- `apps/mobile/hooks/use-cloud-sync.ts` 提供 `{state, storedConfig, ownerToken, connect, disconnect}`；`state` 只区分 `connected` / `disconnected` / `loading`。
- 连接生命周期由 `apps/mobile/app/_layout.tsx` 的 `PowerSyncProvider` 拥有：token + config 都在时 `powersync.connect(createPowerSyncConnector(config))`，否则 `disconnect()`。
- `@powersync/react` 2.0.1 导出 `useStatus(): SyncStatus`（实现为 `useState(currentStatus)` + `registerListener({statusChanged})`，状态变化即重渲染）。`SyncStatus` 提供 `connected / connecting / downloading / uploading / downloadError / uploadError / lastSyncedAt?: Date / hasSynced?: boolean`。
- `@powersync/common` 2.2.1 的 `PowerSyncDatabase` 另有 `getUploadQueueStats()`（未同步改动计数）与 `requestCheckpoint()`（**@alpha**，要求 `checkpointMode: 'requests'`，而 SDK 默认是 `'legacy'`，且需服务端 ≥ 1.24.0）。
- 边界约定（`.trellis/spec/app/database-guidelines.md`「`@powersync/react` boundary」）：`@powersync/react` 是 `packages/db` 之外**唯一**可导入的 PowerSync 包，且限于根布局与 app 数据 hook —— `useStatus` 在允许列表内。

## Requirements

- R1 **手动同步入口**：云同步卡片（已连接）提供「立即同步」按钮，点击后立刻推进一次同步，并反馈「同步中… / 同步成功 / 同步失败（含原因）」（issue #22 验收标准 1）。
- R2 **上次同步时间**：卡片展示「上次同步时间：X月X日 HH:mm」，成功同步后更新；从未成功同步过时给明确文案，不显示假时间（issue #22 验收标准 2）。
- R3 **更细状态**：区分「同步中」（connecting / downloading / uploading）、「已同步（上次 HH:mm）」、「有未同步改动」（本地上传队列非空）、「同步失败」（download / upload error）（issue #22 验收标准 3）。
- R4 「立即同步」只用公开稳定 API：PowerSync 没有真正的 "sync now"；实现 = **重连同步流**（重新 `connect(connector)`，本地待上传队列在 (re)connect 时冲刷）+ 等待状态确认。**不使用** `requestCheckpoint()`（@alpha，且依赖服务端版本与 `checkpointMode` 配置）。
- R5 保持既有边界：`@powersync/react` 的使用只出现在数据 hook；`packages/db` 之外不出现 raw PowerSync API；不在 hook 里 fetch。
- R6 时间派生逻辑注入 `now`（`useAppClock()`），不在 hook 里调用 `Date.now()`。

## Acceptance Criteria

- [ ] AC1 已连接时点「立即同步」，按钮进入「同步中…」，随后给出「同步成功」或「同步失败：<原因>」的明确反馈。
- [ ] AC2 卡片展示「上次同步时间」；成功同步后更新为本次时刻。
- [ ] AC3 从未成功同步时展示「尚未完成过同步」类文案，而不是空值或假时间。
- [ ] AC4 断网时点「立即同步」得到失败 / 离线反馈，界面不谎报成功。
- [ ] AC5 本地有未上传改动时状态体现「有未同步改动」，队列清空后回到「已同步」。
- [ ] AC6 纯函数（状态派生 + 时间格式化）有共置单测，覆盖各状态与「从未同步」分支。
- [ ] AC7 未连接时不出现可用的「立即同步」，不会误导。

## Out of Scope

- 依赖 Docker 的真实断连 / 重连全链路回归（`e2e/sync-roundtrip.ts`）。
- 按表 / 按记录的同步进度明细。
- 同步频率配置（issue #15 已明确「不能设置频率」）。

## Open Questions

（无）
