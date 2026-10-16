# 设计：手动同步入口 + 上次同步时间

## 边界与职责

### 1. 纯逻辑（新增）`apps/mobile/lib/sync-status.ts`

- `deriveSyncDisplay(input): SyncDisplay` —— 纯函数。输入 `{ connected, connecting, downloading, uploading, hasSynced, lastSyncedAt, downloadError, uploadError, pendingUploads, manualState }`，输出 `{ kind, label, detail? }`。
- `kind` 取值：`'offline' | 'syncing' | 'pending' | 'synced' | 'failed'`。
- `formatLastSyncedAt(now: Date, lastSyncedAt: Date | undefined)` → 「上次同步时间：10月16日 14:32」，从未同步时为 `null`。
- 单独成文件的理由：状态归并与时间格式化是可测纯逻辑，与 `lib/format.ts` / `lib/snooze-options.ts` 同层；屏幕只消费结果。

### 2. 数据 hook（新增）`apps/mobile/hooks/use-sync-status.ts`

- `useStatus()`（`@powersync/react`，database-guidelines 允许列表内）拿实时同步状态；该 hook 内部已用 `registerListener({ statusChanged })`，状态变化即重渲染。
- `usePowerSync()` + `getUploadQueueStats()` 拿未上传计数；在 status 变化时刷新，不额外轮询。
- `syncNow()`：
  1. 读 `getStoredBackendConfig()` + `getOwnerToken()`；任一为空 → 返回「未连接」失败，不发任何网络请求。
  2. `await powersync.connect(createPowerSyncConnector(config))` —— 重连会重新建立同步流并冲刷本地待上传队列。
  3. `await powersync.waitForStatus(predicate, signal)`，带超时保护，等待 `connected`。
  4. 按 `downloadError` / `uploadError` 决定成功或失败，返回 `{ ok: true } | { ok: false, reason }`；文案映射留在屏幕。
- **不使用 `requestCheckpoint()`**：@alpha，要求 `checkpointMode: 'requests'`（SDK 默认 `'legacy'`）且服务端 ≥ 1.24.0；`_layout.tsx` 的 `connect()` 未传该选项，在真实部署上会直接抛错（R4）。

### 3. UI（修改）`apps/mobile/app/(tabs)/settings.tsx` 云同步卡片

- 状态行改为四态文案：同步中… / 已同步（上次 HH:mm）/ 有 N 条未同步改动 / 同步失败：<原因>；未连接保持既有文案。
- 新增「立即同步」按钮：同步中或未连接时 `disabled`；按下调用 `syncNow()` 并显示本次结果。
- 新增「上次同步时间：…」一行；从未同步时显示明确文案（R2 / AC3）。
- 保留既有地址展示、`SyncExplainer`、rejections 警告、「复制连接串」/「扫码配对」、「断开连接」。

## 数据流

```
PowerSync SDK ──statusChanged──▶ useStatus() ─┐
                                              ├─▶ deriveSyncDisplay() ─▶ 卡片文案
getUploadQueueStats() ───────────────────────┘
                    ▲
                    └─ 在 status 变化时刷新

「立即同步」按下
  ├─ storedConfig / token 缺失 → 失败（未连接）
  └─ powersync.connect(connector)      // 重连 + 冲刷上传队列
       └─ waitForStatus(s => s.connected)（超时保护）
            ├─ downloadError / uploadError → 失败
            └─ 否则 → 成功；lastSyncedAt 由 SDK 更新
```

## 兼容性与权衡

- **「立即同步」的诚实语义**：PowerSync 是长连接实时同步，没有 "sync now"。重连是唯一可用的公开手段，能真实达成「立刻拉一次」，代价是短暂断开流 —— 用户主动触发，可接受。
- **不引入 `checkpointMode: 'requests'`**：那会改 `_layout.tsx` 的连接选项并依赖服务端版本，等于把 UI 需求升级成部署要求；本次不碰。
- **`lastSyncedAt` 的语义**：SDK 定义为「最近一次完整同步完成的时间」，且**服务重启后会被重置** —— 界面文案必须承认这一点（「尚未完成过同步」），不能显示假时间（R2）。
- **状态优先级**：失败 > 同步中 > 有未同步改动 > 已同步 > 离线；先展示最需要用户注意的那个。
- **不新增依赖**：全部用既有 SDK 与 `@nextdo/db` 导出。

## 验证策略与已知限制

| 层 | 证据 |
|---|---|
| 纯逻辑 | `apps/mobile/lib/sync-status.test.ts`：五态 + 从未同步 + 时间格式化（注入 `now`） |
| 屏幕 | `__tests__/settings-screen.test.tsx`：驱动 `useStatus` mock 到各态，断言「立即同步」「上次同步时间」「同步失败」文案 |

**已知限制（必须在交付说明中如实报告）**：浏览器端的同步配置存储按 storage matrix 是**内存态**，刷新即丢，因此 `pnpm verify:web` 的浏览器实测只能覆盖「未连接」态与新增文案；已连接态的渲染由 `settings-screen.test.tsx` 的 mock 覆盖。「重连真的推进了一次同步」属于运行时契约，单测与浏览器都无法证明，需要真实同步服务才能验证。
