# 通知内联操作：完成 / 推迟 / 跳过（issue #99）

状态：部分完成，2026-11-21。前台路径（系统打开应用后执行事务）已实现并验证；
应用被杀死时的后台事务未实现，保留在 `.trellis/backlog.md`（见「未完成」）。
验证记录见下文。

## 背景

- issue #99：原生通知注册「完成 / 推迟 / 跳过」操作；操作完成对应事务，
  失败时给出可见提示或打开应用；Web/桌面端按平台能力降级。
- 此前通知只携带 `reminderId` / `actionKind` / `actionId` 与可选路由
  （`apps/mobile/lib/reminders/adapters/native.ts`），用户必须打开应用才能处理。
- `.trellis/backlog.md` P0 #1 的剩余部分（投递主体已在 09-30 交付）。

## 决策与实现

### 动作目录与解析（`apps/mobile/lib/reminders/inline-actions.ts`）

- 目录标识 `nextdo_reminder_actions`（iOS 不接受 `:` 与 `-`）；三个动作
  `nextdo.action.complete` / `.snooze` / `.skip`。
- `parseInlineAction(actionIdentifier, data)` 是纯函数：只接受三个已知动作
  标识 + 合法的 `actionKind`（`next` / `calendar` / `habit`）+ 非空
  `actionId`。其余响应（普通点击、未知动作、字段漂移）返回 `null`，由适配器
  回退到「打开应用」。
- 推迟默认复用应用唯一的常用档 `commonSnoozeOption`（10 分钟后，
  `lib/snooze-options.ts`），按钮文案由同一数字生成，避免出现第二个默认值。

### 原生适配器（`apps/mobile/lib/reminders/adapters/native.ts`）

- `init` 注册动作目录，三个按钮：完成、推迟 10 分钟、跳过。
- 每条提醒通知的 `content.categoryIdentifier` 指向该目录；next / calendar /
  habit 三类提醒都带同一组操作——Now 屏对三类行动都提供完成/推迟/跳过，
  通知保持一致。
- 响应分发（热启动监听 + 冷启动 `getLastNotificationResponseAsync`）：
  - 识别为内联动作 → 交给 hook 执行事务；
  - 普通点击、未知动作标识、payload 漂移、或调用方未提供动作处理器 →
    走原有打开路径（深链路由或 Now 页）。
- 冷启动响应可能同时经 emitter 事件与 `getLastNotificationResponseAsync`
  到达（expo 在模块创建时重放 pending 响应）；按「通知标识 + 动作标识」
  去重，保证一次操作只执行一次事务，避免第二次完成显示「状态变更不被允许」。
- 按钮保持 `opensAppToForeground: true`（系统默认），因此当前交付的是
  **前台路径**：系统打开应用，应用内监听器执行事务。issue #99 要求的
  「在后台完成事务」尚未实现——本地通知的动作响应在应用被杀死时无法运行
  JS（未安装 `expo-task-manager`；其 Android 后台任务入口需要新增原生
  依赖并在后台上下文重建数据库连接，iOS 终止态不支持通知动作的后台 JS
  任务）。这是本次的完成范围边界，不是遗漏；后台事项见
  `.trellis/backlog.md` 的「通知动作的后台事务」。
- 目录注册失败只记录警告并继续投递：通知降级为无按钮，不影响提醒本身。

### 事务与失败提示（`apps/mobile/hooks/use-reminder-delivery.ts`）

- 三个动作分别调用 `packages/db` 的规范事务：
  - `completeAction`（完成，含习惯窗口校验）；
  - `snoozeAction`（写入 snooze，目标为操作时刻 + 10 分钟，并替换提醒行）；
  - `skipAction`（写入 skip 计数）。
- 推迟与跳过在事务内读取行动行并检查 `status === 'open'`
  （`packages/db/src/queries/actions.ts` 的 `assertActionOpen`）。旧通知可能
  在行动完成后才被点击：此时事务整体失败（`action.not-open`），不写
  `snoozed_until` / `consecutive_skips`，也不新建 scheduled reminder，
  避免给已完成的行动重新排程提醒。
- 动作与 reconcile 共用同一条 promise 队列，写入与随后的表变更 reconcile
  不交错；写库走 PowerSync 的 `wrapDb`，应用内 watch 自动刷新状态。
- 失败：记录日志并把 `errorMessage(err)` 的中文文案放入 `actionNotice`。
  根布局的 `<ReminderDelivery/>` 渲染顶部横幅
  （`components/reminder-action-notice.tsx`），标题「通知操作失败：…」，
  可点「知道了」关闭；成功执行会清掉旧提示。
- 典型失败：行动已在另一设备完成/删除、习惯打卡超出时间窗口、状态迁移
  不再允许。习惯窗口失败不会自动 override——应用内仍需用户确认。

### 平台降级

- **Web（普通浏览器）**：不注册动作；适配器不投递提醒（R6）。直接
  `new Notification` 路径补上 `onclick → window.focus()`；Service Worker
  的 `notificationclick` 本就聚焦/打开应用（Web Push 路径）。
- **桌面（Tauri）**：不注册动作（Rust 侧只实现 notify /
  request_permission / is_permission_granted，`onAction` 会 command not
  found）；点击通知由系统聚焦/启动应用，沿用既有边界。
- **原生**：未知动作标识按普通点击打开应用。

## 验收对应

- 通知上直接完成行动：`completeAction` 事务执行，PowerSync 变更驱动应用内
  状态更新（hook 测试断言规范事务被调用；db 事务行为由既有测试覆盖）。
  当前按钮会把应用带到前台再执行，见「未完成」。
- 推迟写入 snooze：`snoozeAction` 收到 `snoozedUntil = now + 10 分钟`。
- 跳过写入 skip：`skipAction` 被调用。
- 不支持内联操作的平台仍可点击打开应用：web 直接通知的 `onclick` 聚焦窗口，
  SW 点击聚焦/打开；桌面点击由系统聚焦/启动；原生普通点击保持原路由。

## 测试

- `lib/reminders/inline-actions.test.ts`：目录标识字符约束；三个动作标识；
  三类 `actionKind`；普通点击/未知动作/缺失或漂移 payload 返回 `null`；
  推迟目标等于 `commonSnoozeOption` 且为 10 分钟。
- `__tests__/native-reminder-actions.test.ts`：目录注册的三个按钮；每条排程
  带 `categoryIdentifier`；热启动动作响应进入动作回调而非打开回调（同一响应
  重复到达只分发一次）；普通点击保留深链；未知动作标识走打开路径；调用方
  未提供动作处理器时动作点击仍打开应用；冷启动动作响应只分发一次并清理；
  目录注册失败仍能排程；dispose 后响应不再分发。
- `__tests__/reminder-delivery-inline-actions.test.tsx`：完成/推迟/跳过分别
  调用规范事务，推迟差值为 10 分钟；失败显示中文提示并可关闭；旧通知对已
  完成行动推迟/跳过时显示 `action.not-open` 的中文提示；下一次成功清掉
  旧提示；普通点击仍按深链/Now 路由。
- `packages/db/src/test/queries.actions.test.ts`：已完成行动拒绝推迟/跳过
  （`action.not-open`，原行的 snooze/skip 字段不变，不新建 scheduled
  reminder）；`reopenAction` 的恢复测试改为直接写入 snooze/skip 状态。
- `__tests__/reminder-action-notice.test.tsx`：无消息不渲染；有消息显示
  「通知操作失败：…」并响应关闭。
- `__tests__/web-reminder-adapter.test.ts`：直接通知的 `onclick` 聚焦窗口。
- `__tests__/mocks/expo-notifications.ts`：补 `setNotificationCategoryAsync`
  的默认 mock（所有挂载根布局的屏幕测试都会初始化原生适配器）。

## 验证记录（2026-11-21）

- 门禁：`pnpm verify:web --no-serve` 退出码 0；lint、typecheck、测试与 web
  构建全绿，共 1669 个测试（core 275 / server 133 / db 372 / mobile 889）；
  日志 `gate-99-r6.log`。本工作树从 `main` 分出，未包含 #89–#98 的未合入
  改动。
- 浏览器冒烟（headless Chrome + 自建静态服务器，无截图）：Web 产物在
  1280×960 下打开 `/now`，执行池空态正常；进入 `/settings`，「提醒与通知」
  区（应用内提醒、应用内通知、习惯打卡提醒）正常渲染；刷新后仍正常；控制台
  无 `TypeError` / `ReferenceError` / 新通知 API 相关错误。结果见
  `run-99-r6.log`：`{"ok":true,"webReminderSection":true,"reloadOk":true,"errors":[]}`。
- 原生通知按钮本身无法在浏览器中触发：动作响应来自系统通知界面。该层由
  适配器与 hook 测试覆盖（目录注册参数、热/冷启动分发、三类事务、失败提示），
  未在真实 iOS / Android 设备上点击验证。
- 复核 reviewer 的 SQLite 复现（两项断言旧行为）：修正后 2/2 因
  `action.not-open` 失败，即「完成后旧通知推迟/跳过」均被事务拒绝。

## 未完成

- 后台事务（issue #99「操作在后台完成对应事务」）：当前三个按钮全部
  `opensAppToForeground: true`，应用被杀死或处于后台时由系统先打开应用，
  再由应用内监听器执行事务。这不是纯后台执行。
  - Android：可用 `expo-task-manager` + `Notifications.registerTaskAsync`
    在通知动作的后台任务中执行事务（Expo 57 文档
    https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#registertaskasynctaskname）。
    需要新增原生依赖、在后台 JS 上下文初始化本地数据库，并在真实设备上
    验证。
  - iOS：终止态不支持通知动作的后台 JS 任务。
  - 跟踪项：`.trellis/backlog.md`「通知动作的后台事务」。

## 边界

- 未在真实 iOS / Android 设备上验证系统通知按钮的渲染与点击（仓库无原生
  目录，构建走 EAS）。组件/适配器层测试覆盖了注册参数与响应分发。
- 应用被杀死时的动作响应依赖系统启动应用（`opensAppToForeground` 默认），
  不是纯后台事务，见「未完成」。
- 动作目录注册失败、按钮在旧通知上不出现等系统级降级只记录日志，不做用户
  提示。
- 升级前已排入系统的通知没有 `categoryIdentifier`，不会出现按钮，仍按原样
  点击打开应用；下一次排程后才带内联操作。
- 推迟没有多档选择：通知按钮只提供应用唯一的常用档，自定义时间仍需打开
  应用。
