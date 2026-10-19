# Design: issues #58–#62

## 变更边界

只改 `apps/mobile` 的应用层（`app/`、`components/`、`hooks/`、`lib/`）与其测试；不新增数据库表、不改同步表面。设备偏好沿用 `lib/theme.ts` / `lib/notification-settings.ts` 已有的平台存储矩阵（native → `expo-secure-store`，web/Tauri → `localStorage`，Node → 内存）。

## #59 专注时长自定义

### 持久化（新 `apps/mobile/lib/focus-settings.ts`）

- key：`nextdo.settings.focus`
- 形状：`{ lastMinutes: number | null }` — 上次用户实际选择的专注分钟数；`null` 表示从未选择（保持旧默认 25/45/60）。
- 读取修复：仅接受 `[1, 180]` 内的整数，其余回落 `null`。
- 对外：`loadFocusSettings` / `saveFocusSettings(patch)` / `subscribeToFocusSettings` / `__setFocusSettingsStoreForTests`，结构照抄 `notification-settings.ts`（write-first-then-cache，失败不污染缓存）。

### UI（`app/focus/[id].tsx` 选时长步骤）

- 常见档位改为 `[15, 25, 45, 60]`；仍保留「自由计时」。
- 上次选择存在时：
  - 若属于常见档位 → 该按钮用 `variant="primary"`（其余 secondary），保持顺序稳定；
  - 若不属于 → 在常见档位前追加一个 `${lastMinutes} 分钟` 的 primary 按钮。
  - 该默认按钮带 `accessibilityLabel="${minutes} 分钟（上次使用）"`，便于测试与读屏。
- 自定义输入：数字 TextInput + 「分钟」+ 「开始」按钮，预填 `lastMinutes`；仅接受 1–180 整数，非法输入禁用开始并给出内联提示。
- 用户主动选择（档位/自定义）成功启动后写入 `lastMinutes`；`preset=2&autoStart=1` 的澄清流程与「自由计时」不写偏好（不是用户的时长选择）。

## #58 记录与澄清解耦

### 记录默认不澄清

- `QuickCaptureModal`：`onCaptured` 语义改为「保存成功后的回调」（父级负责关闭）；新增可选 `onCapturedAndClarify`，渲染次要按钮「记录并澄清」。
- Inbox 内联卡片：主按钮「记录」只保存并清空草稿；次要按钮「记录并澄清」保存后打开向导。
- Inbox 快速记录弹窗：保存 → 关闭弹窗；「记录并澄清」→ 关闭 + 打开向导。
- 「再记一条」的 `recapture=1` 一次性参数行为不变。

### 待澄清列表与批量澄清

- Inbox 列表本身就是「待澄清」列表：计数 Tag 文案改为「待澄清」，并新增「开始澄清」按钮（`data.length > 0`），打开最早一条：`/clarify/${data[0].id}?batch=1`。
- 澄清路由 `app/clarify/[inboxId].tsx`：读取 `batch` 参数，用 `useInboxItems()` 计算 `nextInboxId = data.find(i => i.id !== inboxId)?.id ?? null` 与 `remaining = data.filter(i => i.id !== inboxId).length`（过滤当前 id，避免 PowerSync 订阅尚未刷新时自跳转）。
- `ClarifyWizard` / `WizardBody` 透传 `batchNextId: string | null | undefined`（`undefined` = 非批量模式）与 `batchRemaining`：
  - done 步骤在批量模式下主按钮为「澄清下一条」：`nextInboxId !== null` → `router.replace('/clarify/{next}?batch=1')`；否则返回收件箱。
  - 显示「还有 N 条待澄清」提示。
- 非批量模式的 done 步骤保持「再记一条 / 完成」。

## #58 专注页速记

- 专注页底部固定「速记一笔」坞（图标 + 文案 + 「想到就记，计时不停」），始终可见且在拇指区；打开 `QuickCaptureModal`（无 `onCapturedAndClarify`，保存即关闭并给出 2.4s 的「已记入收集箱」提示）。
- 不再在头部放 ghost 速记按钮：头部只留返回与标题，避免入口被忽略且不占拇指区。
- 使用 `useAddInboxItem`；记录不导航、不触发澄清，`active` session 与计时状态不受影响（弹窗只是覆盖层）。

## 测试设计

- `focus-screen.test.tsx`：选时长步骤出现 15/25/45/60/自定义；自定义 30 分钟启动 → `startFocusSession` 收到 30；保存后选时长步骤出现默认「30 分钟」；速记保存后弹窗关闭且仍停留在 `/focus/f-1`（计时未中断）。
- `inbox-screen.test.tsx`：内联保存 → 仍停留在收件箱且草稿清空；「记录并澄清」→ 打开向导；弹窗保存 → 关闭且不导航；「开始澄清」→ `/clarify/{oldest}?batch=1`；计数文案「待澄清」。
- `quick-capture-modal.test.tsx`：`onCapturedAndClarify` 按钮调用；`onCaptured` 仍只作保存回调。
- `clarify-wizard.test.tsx`：批量 done 步骤显示「澄清下一条」并 `router.replace` 到下一 id；无下一条时返回收件箱。
- `lib/focus-settings.test.ts`：解析/范围修复与持久化往返。

## #60 专注 / 休息结束的系统级通知

### 平台矩阵

- `lib/focus-notification.ts`（新）：
  - `requestFocusNotificationPermission()`：按平台申请/检查通知权限（native → expo-notifications；web → `Notification.requestPermission`；Tauri/未知 → 不支持）。
  - `scheduleFocusCompletionNotification({ endsAt, phase })` / `cancelFocusNotifications()`：native 用 expo-notifications 的 date trigger 预排「专注结束」「休息结束」本地通知（App 未打开也能响）；web/Tauri 退化为页内提示。
  - 通知 `data` 带 `focusNotification: true`，供点击路由与静音策略识别。
- `lib/notification-channels.ts`（新）：Android 通知渠道（专注结束 / 休息结束）。
- `lib/reminders/adapters/native.ts`：复用/扩展已有 schedule/pending 能力，focus 通知与提醒共用响应监听（点击 → 路由到对应页面）。
- `app/focus/[id].tsx`：计时区渲染权限引导（未授权时）、到时页、5 / 10 分钟休息与「提前结束」。

## #61 习惯打卡高可见入口

- `app/(tabs)/now.tsx`：在执行主区上方渲染「今日习惯待打卡」卡片：最多 3 条未打卡习惯，每条一个「快速打卡：{标题}」按钮（写 `toggleHabitDay`），超过 3 条显示「还有 N 项…」；全部完成后卡片自动消失。
- 底部「今日习惯」区块保留完整列表与「管理」入口。

## #62 项目可选首行动 + 行动类型

### 领域与存储

- `Task.actionKind: 'next' | 'waiting' | 'delegated'`（默认 `'next'`）；DB `tasks.action_kind`（text，not null，default `'next'`）。
- 等待清单独立于执行池：`listWaitingItems` / `addWaitingItem` / `removeWaitingItem`（`packages/db/src/queries/inbox.ts`），`hooks/use-waiting-for.ts` 暴露读写。
- `app/waiting.tsx`：等待事项页（新增 + 清单 + 类型标签 + 移出）。

### 澄清向导

- 行动表单新增「行动类型」：下一步行动 / 等待外部 / 已委派。
- 「等待外部」与「已委派」：出现「在等谁 / 什么」（aria-label 同名），说明「记为等待事项，不进执行池」。
- 项目表单：「现在就定首个行动吗」→「现在就定」/「先挂着」；选「先挂着」时不要求首个行动标题，预览显示「首个行动：暂不设定」。

