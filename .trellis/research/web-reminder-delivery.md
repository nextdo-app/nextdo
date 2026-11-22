# Web/PWA 前台任务提醒投递（issue #92）

## 状态

已实现（2026-11-20），已合入 main（2026-11-22，`12c85e3`）。

## 问题

`use-reminder-delivery` 在 `platform === 'web'` 时直接返回，数据监听、前台恢复与
到点 tick 都被跳过；`web.apply` 只在测试里被直接调用，生产链路从不执行。结果是
浏览器里提醒行照常写入，但前台页面打开也不会投递。

## 当前行为（代码事实）

- 平台分派：普通浏览器使用 `createWebAdapter()`（已有实现），tauri webview 仍用
  tauri 适配器。
- 调度：`computeReconcile` 新增 `web` 模式，语义与 tauri 的 in-session 投递一致。
  - 到点且未超过 5 分钟宽限、有标题、本会话未投递 → `toFireNow`。
  - 未来行等待 30 秒 tick 跨过 `firesAt`；超过宽限不补投。
  - 不产生 `toSchedule` / `toCancel`（浏览器没有 OS 侧排程）。
- 触发：web 现在参与 mount reconcile、数据变更监听（1 秒防抖）、窗口 focus 与
  30 秒 tick；页面持续打开、无数据变化/焦点切换/用户操作时也会到点投递。
- 去重：web 适配器的会话 `firedIds` 通过 `sessionContext()` 进入 reconcile，
  同一页面会话内同一提醒只投递一次；成功后才记入。页面刷新会重建会话集合
  （与 tauri 重启语义相同）。
- 总开关：`masterEnabled` 关闭时 `computeReconcile` 不产生投递，tick 也跳过
  数据库读取；重新打开时由设置订阅触发的 reconcile 立即补投仍在宽限内的行。
- 投递实现：优先 `navigator.serviceWorker.ready` + `showNotification`，2 秒内
  未就绪则回退到页面 `new Notification(...)`，避免 pending 的 `ready` 卡住整个
  reconcile 队列。
- 竞态防护（review 修复）：
  - 适配器持有 `deliveryEnabled` 实时门闩，hook 在设置加载与每次开关变化时同步
    更新。`apply` 在每批开始、每个条目开始、以及 `ready` 等待（resolve 或 2 秒
    超时回退）之后都重新检查门闩与浏览器权限；等待期间关闭总开关不会发送。
  - `inFlightIds` 在第一个 await 之前同步占用提醒 id，成功后转入 `firedIds`，
    失败后在 `finally` 释放。hook 重新挂载时旧 `apply` 与新 `apply` 不会重复
    发送同一条提醒；失败仍由后续 tick 重试。
- 失败提示：`Notification` / `showNotification` 拒绝时写入
  `lib/reminders/delivery-feedback.ts`，Settings「提醒与通知」卡片显示
  「最近一次提醒发送失败…」；下一次成功投递清除。权限被拒仍由 Settings 状态行
  与「开启浏览器通知」入口表达，不重复报成发送失败。
- 能力边界：v1 没有 Web Push 订阅/发送链路，页面关闭后不投递。Settings 文案
  明确写「需要保持 Nextdo 页面打开，页面关闭后不会提醒」。
- 权限请求：浏览器要求用户手势，`snooze` 等写提醒路径仍不触发权限弹窗；唯一
  入口是 Settings 的「开启浏览器通知」。

## 实现与测试

- `apps/mobile/hooks/use-reminder-delivery.ts` — web 接入 reconcile、数据监听、
  focus、30 秒 tick；设置加载完成前的门闩。
- `apps/mobile/lib/reminders/reminder-scheduler.ts` — `ReconcileMode` 增加
  `web`，in-session 语义与注释。
- `apps/mobile/lib/reminders/adapters/web.ts` — `sessionContext`、SW 超时回退、
  实时门闩与 `inFlightIds` 跨挂载去重、成功/失败反馈；`dispose` 不再清空会话
  去重集合。
- `apps/mobile/hooks/use-reminder-delivery.ts` — 设置加载与开关变化时同步
  更新适配器门闩。
- `apps/mobile/lib/reminders/adapters/types.ts`、`tauri.ts` — `tauriContext`
  改名为 `sessionContext`（两种 in-session 平台共用）；新增可选
  `setDeliveryEnabled`。
- `apps/mobile/lib/reminders/delivery-feedback.ts` +
  `hooks/use-reminder-delivery-failure.ts` — 失败状态的存储与订阅。
- `apps/mobile/app/(tabs)/settings.tsx` — web 能力边界文案、发送失败提示。
- 测试：
  - `lib/reminders/reminder-scheduler.test.ts` — web 模式的到点、未来、宽限、
    去重、总开关。
  - `__tests__/web-reminder-adapter.test.ts` — 失败上报与成功清除、SW 未就绪
    回退、等待期间关闭开关（resolve 与超时回退）、批次中途关闭、并发 apply
    去重、失败后重试。
  - `lib/reminders/delivery-feedback.test.ts` — 存储语义。
  - `__tests__/reminder-delivery-web.test.ts` — hook 集成：适配器选择、mount
    投递、静止到点、数据变更、总开关关/开、失败上报、SW 等待中关闭开关、
    重新挂载不重复。
  - `__tests__/settings-screen.test.tsx` — 失败提示可见。
  - `__tests__/notification-state.test.ts` — web 授权边界、拒绝与待授权文案。
- 删除 `lib/reminders/adapters/noop.ts`：无任何引用，且其「纯 web 不投递」
  描述已与实现相反。

## 待确认（实现假设，不是当前规则）

- 宽限窗口与 tauri 共用 5 分钟；web 也按 30 秒 tick、±35 秒精度。
- 去重按「页面会话」而非跨刷新持久化；刷新后仍在宽限内的提醒可能再次投递。
- 失败提示不持久化，刷新后清空；不提供手动关闭按钮。
- 多标签页各自运行投递层，同一提醒可能每个标签页各投递一次；本 issue 不处理
  跨标签页仲裁。
- 未实现 Web Push 后台投递与通知内操作。

## 来源

- issue #92（2026-11-20）：Web/PWA 前台普通任务提醒投递断链。
- 领域规范 `.trellis/spec/domain/domain-model.md` 的 Reminder 平台能力矩阵。
