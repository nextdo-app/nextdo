# 设计：通知主动授权 + App 内总开关

## 边界与职责

一次改动落在四层，各自职责单一。

### 1. 偏好存储（新增）`apps/mobile/lib/notification-settings.ts`

- 形状：`{ masterEnabled: boolean; optInPromptSeen: boolean }`。
- 存储矩阵复用 `apps/mobile/lib/habit-reminders.ts` 的既有模式：native → `expo-secure-store`，web / Tauri → `localStorage`，其它 → 内存。
- 导出 `DEFAULT_NOTIFICATION_SETTINGS` / `loadNotificationSettings()` / `saveNotificationSettings(patch)` / `subscribeToNotificationSettings(listener)` / `__setNotificationSettingsStoreForTests(store)`。
- 不使用 `packages/db/src/owner-token.ts` 的存储后端：desktop 的 stronghold 后端强制两键契约（其它键抛 `storage.multi-key`），那是给密钥用的，不是给普通偏好用的。
- 默认值 `{ masterEnabled: true, optInPromptSeen: false }` —— 默认开保住既有行为（R4）。
- 读写带缓存 + 单飞（与 `habit-reminders.ts` 一致）；订阅用于把开关变化推给投递层。

### 2. 投递开关（修改）`apps/mobile/lib/reminders/reminder-scheduler.ts`

- `ReconcileInput` 增加必填 `enabled: boolean`。
- `computeReconcile` 在 `enabled === false` 时短路：`{ toSchedule: [], toCancel: [...pendingIds], toFireNow: [] }` —— 撤销全部已排入 OS 的通知，且不再安排。这就是「即时生效」的真实机制，且保持纯函数可测。
- 必填而非可选：调用点只有 `use-reminder-delivery.ts` 与其共置单测，必填可避免「忘了传 → 静默保持开启」。
- tauri 模式没有 OS pending，`toCancel` 天然为空；`toFireNow` 被清空即达成「不再通知」。

### 3. 生命周期接线（修改）`apps/mobile/hooks/use-reminder-delivery.ts`

- 读入 `loadNotificationSettings()`，把 `masterEnabled` 传给 `computeReconcile`。
- 订阅偏好变化 → 触发一次 reconcile（走 `queueRef` 的单条 promise 链，与既有触发源同一入口，天然串行）。
- 开关关闭时 reconcile 会取消已排程，无需额外取消逻辑；desktop 的 30s tick 在关闭时直接早退，省掉无谓的 DB 查询。
- 偏好读取失败按默认值（开）处理，绝不因偏好读失败而停掉投递。

### 4. UI（新增 + 修改）

- 新增 `apps/mobile/components/notification-optin-dialog.tsx`：一次性说明弹窗，结构仿 `apps/mobile/components/auto-update-dialog.tsx`。
  - 可见条件：`optInPromptSeen === false` 且 `permission.status === 'undetermined'` 且 `permission.platform !== 'tauri'`（桌面无授权模型，投递跟随系统）。
  - 主按钮「开启通知」→ `requestPermission()`；无论结果如何都写 `optInPromptSeen = true`。
  - 次按钮「暂不」→ 只写 `optInPromptSeen = true`。
  - 状态未就绪（`permission === null` 或偏好未读）时渲染 `null`，不闪烁、不阻塞首屏。
- 根布局 `apps/mobile/app/_layout.tsx`：与 `IosInstallPrompt` / `AutoUpdateNotifier` 并列挂载。
- 设置页 `apps/mobile/app/(tabs)/settings.tsx`「提醒通知」卡片：
  - 新增 `Switch` 总开关（带 `accessibilityLabel`），切换即写偏好。
  - native `undetermined` 分支补「开启通知」按钮（现在是纯文案），复用既有 `requestPermission()`。
  - 文案明确区分「App 内开关」与「系统权限」（R3）。

## 数据流

```
App 启动
  └─ NotificationOptinDialog 挂载
       ├─ loadNotificationSettings()  → optInPromptSeen
       ├─ useReminderPermission()     → OS 权限
       └─ 未引导 && undetermined && 非 tauri → 显示弹窗
              ├─「开启通知」→ requestPermission() → 写 optInPromptSeen=true
              └─「暂不」    → 写 optInPromptSeen=true，关闭

设置页开关切换
  └─ saveNotificationSettings({ masterEnabled })
       └─ subscribeToNotificationSettings 通知
            └─ useReminderDelivery 触发 reconcile(enabled=false)
                 └─ computeReconcile → toCancel: 全部 pending
                      └─ adapter.apply() → 撤销 OS 待发通知
```

## 兼容性与权衡

- **默认开**：现有用户升级后通知行为不变；开关只提供「关」的能力（R4）。
- **不引入新依赖**：全部用既有 `expo-secure-store` / `localStorage`。
- **`enabled` 必填**：见上，防静默回归。
- **开关对 native 与 tauri 都生效**：tauri 靠清空 `toFireNow` 实现；web 的 noop adapter 本就不投递。
- **风险**：`computeReconcile` 是既有投递核心，改签名会波及调用点与测试，必须一次改完。
- **不做 Android 系统设置跳转**：维持文案（Out of Scope）。

## 验证策略

| 层 | 证据 |
|---|---|
| 纯逻辑 | `reminder-scheduler` 共置单测新增 `enabled: false` 分支：撤回全部 pending、不排程、不 fire |
| 偏好存储 | `notification-settings` 单测：默认值、解析容错、订阅通知 |
| 组件 | `__tests__/notification-optin-dialog.test.tsx`：undetermined 显示 / granted、denied 不显示 /「暂不」后不再显示 |
| 屏幕 | `__tests__/settings-screen.test.tsx`：总开关存在、切换后写入偏好 |
| 界面 | 浏览器实测（`pnpm verify:web`），截图 `.verify/notification-optin/` |
