# Design — 提醒通知投递

## 1. 架构总览

```
reminders 表 (本地 SQLite，PowerSync 同步)
        │ state='scheduled' + fires_at + intensity + action_kind/action_id
        ▼
packages/db/src/queries/reminders.ts (新)
        │ listScheduledReminders(db) → { id, kind, actionId, firesAt, intensity, title|null }
        │ (JOIN 行动表取标题；行动被软删 → title=null → 孤儿)
        ▼
apps/mobile/lib/reminders/
  reminder-scheduler.ts   纯 reconcile 函数（无平台依赖，单测核心）
  adapters/
    native.ts             expo-notifications（iOS/Android，OS 持久化调度）
    tauri.ts              30s tick + 直接 invoke `plugin:notification|notify`（桌面，会话内投递）
    noop.ts               纯 web
  index.ts                平台选择 + 统一 DeliveryAdapter 接口
        ▲
apps/mobile/hooks/use-reminder-delivery.ts   （挂 app/_layout.tsx 根部）
  - db.onChange({ tables: reminders/next_actions/calendar_actions/habit_days/habits }) → 1s 防抖 → reconcile
  - AppState active (native) / window focus (tauri) → reconcile
  - 通知响应 listener（冷/热启动）→ router.replace('/(tabs)/now')
        ▲
权限入口：use-snooze-action / clarify 日历提交 → maybeRequestNotificationPermission()
设置页：通知状态块（getPermissionsAsync / isPermissionGranted）
```

**边界遵循 spec**：查询在 `packages/db/src/queries`（app spec checklist）；`db.onChange` 经 `usePowerSync()` 实例在 app 层 hook 内订阅并自管生命周期（`@powersync/react` 边界例外，`use-action-title.ts` 同模式——本任务在 Phase 3.3 把该先例写进 database-guidelines）。

## 2. 数据契约

### 2.1 `listScheduledReminders`（新查询）

```sql
SELECT r.id, r.action_kind AS kind, r.action_id AS action_id,
       r.fires_at, r.intensity,
       CASE r.action_kind
         WHEN 'next'     THEN na.title
         WHEN 'calendar' THEN ca.title
         WHEN 'habit'    THEN h.title
       END AS title
FROM reminders r
LEFT JOIN next_actions na     ON r.action_kind='next'     AND na.id=r.action_id AND na.deleted_at IS NULL
LEFT JOIN calendar_actions ca ON r.action_kind='calendar' AND ca.id=r.action_id AND ca.deleted_at IS NULL
LEFT JOIN habit_days hd       ON r.action_kind='habit'    AND hd.id=r.action_id
LEFT JOIN habits h            ON h.id=hd.habit_id AND h.deleted_at IS NULL
WHERE r.state='scheduled' AND r.deleted_at IS NULL
```

返回 `title: string | null`——null = 行动行消失/软删（孤儿，R8 修 trash 后此路径只剩跨设备竞态/旧构建行，reconcile 兜底）。Kysely 写法注意：三表 LEFT JOIN 同层、CASE 取 title，`noUncheckedIndexedAccess` 下行访问全部显式判空。

### 2.2 通知内容

| 字段 | 值 |
|---|---|
| title | 按 kind：next → 「稍后提醒」，calendar → 「即将开始」，habit → 「习惯提醒」（中文，与全 app 文案一致） |
| body | 行动标题（habit = 习惯名，与 `use-action-title.ts` 的解析口径一致） |
| data | `{ reminderId, actionKind, actionId }`（native deep-link 用；桌面 payload 无消费方） |
| identifier（native） | **reminder 行 ID**（reconcile 的 join key） |

### 2.3 intensity 映射

| intensity | iOS | Android | 桌面 |
|---|---|---|---|
| normal | 默认声 | 渠道 `nextdo-normal`（importance default） | 同左（无区分） |
| important | `important.wav` | 渠道 `nextdo-important`（importance high） | 同左 |
| alarm | `alarm.wav` | 渠道 `nextdo-alarm`（importance high） | 同左 |

- 声音 wav ≤30s，`assets/sounds/`，app.json 插件 `sounds: ["important.wav","alarm.wav"]`（脚本生成两个可区分的提示音）。
- Android 渠道 importance 创建后不可改 → 三渠道固定，`createNotificationChannelAsync` 幂等调用（已存在则忽略错误）。
- 桌面：`sendNotification` 的 `sound` 字段 notify-rust 桌面支持弱，v1 不做强度区分（PRD R3 已注明）。

## 3. Reconcile（纯函数，`reminder-scheduler.ts`）

```ts
interface ReconcileInput {
  now: Date;
  rows: ScheduledReminderRow[];   // listScheduledReminders 结果（含 title=null 孤儿）
  pendingIds: Set<string>;        // adapter 当前 pending 的 reminder ID
  firedIds?: Set<string>;         // tauri-only：本会话已投递
  sessionStart?: Date;            // tauri-only
}
interface ReconcileOutput {
  toSchedule: { row; title }[];   // 仅 title 非空且 firesAt > now
  toCancel: string[];             // pending 中无对应 scheduled 行的 ID
  toFireNow: { row; title }[];    // tauri-only
}
```

规则（native 路径）：
1. `firesAt > now && !pendingIds.has(row.id) && title != null` → `toSchedule`。
2. `title == null`（孤儿）→ 若 `pendingIds.has(row.id)` 进 `toCancel`（行已 scheduled 但行动没了——R8 修后理论上 DB 侧应已 cancel，此路径是跨设备/竞态兜底；行本身留 DB 不动，v1 不写 fired）。
3. `pendingIds` 中不在任何 row.id 集合里的 ID → `toCancel`（业务事务已 cancel 但 OS 侧还挂着）。
4. 过去行（`firesAt <= now`）：不排、不补发（R7）；若 OS 侧还挂着（尚未触发）→ 让它自然触发（已 OS 持久化、到点自响），不主动 cancel。

规则（tauri 路径，GRACE = 5 分钟）：
1. `firesAt <= now && now - firesAt <= GRACE && title != null && !firedIds.has(row.id)` → `toFireNow`（tick 30s，精度 ±35s）。
2. 启动时已超 GRACE 的过去行 → 跳过（迟到不补发，Now 屏会显示逾期行动）。
3. 无 `toCancel`（无 OS 持久状态）。

**并发**：reconcile 走单条 promise 链（`reconcileQueue = reconcileQueue.then(run)`），onChange 防抖 1s。操作幂等（先查 pending 再排程），重复执行无副作用（AC7）。

## 4. 平台适配器

### 4.1 native（iOS/Android）

- init（hook 挂载时一次）：`setNotificationHandler`（保留默认 banner/声音，禁 badge）+ Android 建三渠道。
- `listPending()` → `getAllScheduledNotificationsAsync()` → `new Set(requests.map(r => r.identifier))`（identifier 即 reminder ID）。
- `schedule(row)` → `scheduleNotificationAsync({ identifier: row.id, content: {...}, trigger: new Date(firesAt) })`。
- `cancel(ids)` → 逐个 `cancelScheduledNotificationAsync(id)`（expo-notifications 57 无批量变体）。
- 权限：`getPermissionsAsync()` / `requestPermissionsAsync()`；Android 12+：expo-build-properties 注入 `SCHEDULE_EXACT_ALARM` + `USE_EXACT_ALARM` manifest 权限。
- 响应：`addNotificationResponseReceivedListener`（热启动）+ init 时 `getLastNotificationResponseAsync()`（冷启动，用后立即 `clearLastNotificationResponseAsync()` 防重放）→ `router.replace('/(tabs)/now')`（D2；data 里的 reminderId 仅日志用，v1 不定位具体行）。

### 4.2 tauri（桌面）

- Rust 三处改动：`Cargo.toml` + `tauri-plugin-notification = "2.4.0"`；`lib.rs` + `.plugin(tauri_plugin_notification::init())`；`capabilities/default.json` + `"notification:default"`。
- JS：`@tauri-apps/plugin-notification@2.4.0` 加到 **apps/mobile** deps（仅 web 分支惰性使用）；检测用 `typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__`，命中才 `import()` 插件（不污染 native bundle）。
- tick：hook 内 `setInterval(30_000)` 触发 reconcile（tauri 分支）；`firedIds` 模块级 Set（上限 500，超出清最老）。
- 权限：只调 `isPermissionGranted()`（恒 true，无弹窗）；**不得**调 pending/cancel/channels 系列（桌面 command not found，research 已确认）。
- **投递走直接 invoke（2026-10-01 根因修复）**：不用插件 JS 的 `sendNotification`——它在 2.4.0 里是 `new window.Notification(...)`，依赖插件 init 脚本把该构造器替换成 fire-and-forget 的 IPC 调用；构造器的 async IIFE 从不 return，`await sendNotification` **永远不 reject**（「确认发送才标记 fired」的重试契约成为死代码），init 脚本缺失时更是同步 TypeError。改为经 `window.__TAURI_INTERNALS__.invoke('plugin:notification|notify', { options: { title, body } })` 直调 Rust 命令（init 脚本内部调的也是它；与 `packages/db` stronghold 同款裸桥接模式，不引入 `@tauri-apps/api` 依赖）。真实 promise → 失败进 catch → grace 窗口内下 tick 重试 + jsonl 错误可见。
- 窗口聚焦触发 reconcile：`window` focus 事件 + Tauri 的 `onFocus`（`@tauri-apps/api/window`，若已装；否则 web focus 事件足够）。
- 固有限制（文档注明）：app 关闭期间不响；macOS dev 模式通知归属 com.apple.Terminal → 验收走 release 构建。

### 4.3 noop（纯 web）

全接口空实现；设置页显示「浏览器环境不支持通知」。

**选择逻辑**（`adapters/index.ts`）：

```
Platform.OS === 'web'
  ? (isTauri() ? tauri : noop)
  : native
```

## 5. 触发与生命周期（`use-reminder-delivery.ts`，挂 `_layout.tsx`）

1. **挂载**：选 adapter → init（渠道/handler/listener）→ 首次 reconcile。
2. **数据变更**：`powersync.onChange(() => debouncedReconcile(), { tables: ['reminders','next_actions','calendar_actions','habit_days','habits'] })`——覆盖本地写（snooze/complete/trash）+ sync 流入（跨设备）。
3. **回前台**：native `AppState` → 'active' → reconcile；tauri window focus → reconcile（AC2 持久化后此步主要防漂移）。
4. **权限（D4）**：`maybeRequestNotificationPermission()` 由 `useSnoozeAction`（成功回调后）与 Clarify 日历提交路径调用；内部：native 且 status==='undetermined' → request；幂等（每会话最多弹一次由系统保证——被拒后不再弹）。
5. **卸载**：dispose onChange、清 interval、remove listener。

## 6. 设置页「通知」状态块（R5）

- native：`getPermissionsAsync()` → 未请求（undetermined）/ 已授权 / 已拒绝；已拒绝 → iOS 显示「去系统设置」按钮（`openSettings()`）；Android 拒绝 → 文案指引（系统设置 → 应用 → 通知），无按钮（expo-notifications 无 Android 对应 API，v1 不引新依赖）。
- tauri：状态行「桌面通知跟随系统设置（当前可用/不可用）」（`isPermissionGranted()`）。
- noop：「浏览器环境不支持通知」。
- 状态块放在云同步块上方（通知是执行核心，优先级更高）；数据来自 hook（`useNotificationPermission` 或同 hook 导出），不直连 expo 模块（component-guidelines：屏只读 hook）。

## 7. R8：`trashAction` 修复

`packages/db/src/queries/actions.ts` `trashAction`：软删 update 后同事务加

```ts
await tx.updateTable('reminders')
  .set({ state: 'cancelled', updated_at: nowIso })
  .where('action_id', '=', actionId)
  .where('state', '=', 'scheduled')
  .execute();
```

（对齐 completeAction Step 4；trashAction 目前无事务包装 → 改 `db.transaction()`。）

## 8. 兼容 / 回滚

- 无 schema 变更、无同步面变更（reminders 已在流内）→ **e2e 零改动**；server 零改动。
- 新增依赖：expo-notifications（mobile）、@tauri-apps/plugin-notification（mobile JS + desktop Rust）、expo-build-properties（mobile，manifest 权限）。回滚 = 还原代码 + 卸依赖；已排程的 OS 通知随 app 重装/`cancelAll` 清除，无残留状态。
- 旧设备升级：本地 reminders 表若已有 scheduled 行（不可能——旧版本从不写投递，但行本身由 snooze 产生）→ 首次启动 reconcile 自动补排，无迁移。

## 9. 文件清单

**packages/db**：`src/queries/reminders.ts`（新）、`src/queries/actions.ts`（R8）、`src/index.ts`（导出）、对应 `__tests__`。

**apps/mobile**：`package.json`（+3 依赖）、`app.json`（通知 plugin + build properties）、`assets/sounds/{important,alarm}.wav`（新）、`lib/reminders/{reminder-scheduler.ts,adapters/{native,tauri,noop}.ts,index.ts}`（新）、`lib/reminders/reminder-scheduler.test.ts`（新）、`hooks/use-reminder-delivery.ts`（新）、`app/_layout.tsx`（挂 hook）、`app/(tabs)/settings.tsx`（状态块）、`hooks/use-snooze-action.ts`（权限触发）、`components/clarify-wizard.tsx` 或其提交 hook（日历路径权限触发）。

**apps/desktop**：`src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`、`src-tauri/capabilities/default.json`。

## 10. 验收反馈变更：snooze 选项（2026-10-01，用户拍板）

原方案（09-22-app-ui-screens design §4.7）：四固定档 `[10 分钟后, 30 分钟后, 今晚 20:00, 明天 08:00]`。
验收反馈：「稍后提醒应该自定义设置，最多给一个常用的时间」→ 收敛为：

- `lib/snooze-options.ts`：`commonSnoozeOption(now)`（唯一常用档 `10 分钟后`）+ `customSnoozeSeed(now)`（自定义 picker 种子 = now+1h，`'YYYY-MM-DDTHH:mm'` device-local 字符串）+ `parseLocalDateTimeString`（显式本地构造器解析——**不用** `new Date(string)`，无时区偏移输入的解释是引擎相关的）。
- `components/datetime-picker.tsx` 新增 `mode: 'datetime'`：日（7 天窗口：今天/明天/后天/周X，seed 超窗 clamp 到 0..6）+ 时 + 分，复用既有 chip 网格与 a11y 惯例；confirm 契约 `'YYYY-MM-DDTHH:mm'`。周X 标签而非 M月D日（固定宽 cell 装不下 5 字符）。
- **验收反馈 2026-10-01 第二轮**：时/分 ± 步进器弃用（改 1 分钟要点 59 次、样式与 app 其他 chip 网格不统一）→ 时/分改用与 mode `'time'` 相同的 chip 网格（24 时 + 60 分，任意分钟可选）；日 chip 改两行（今天/明天/后天/周X + M月D日 副标签——周X 单行看不出是哪一周）。snooze-sheet 测试同步改写（步进器用例 → chip 点击用例）。
- `components/snooze-sheet.tsx`：两行（常用档 + 自定义时间）；自定义早于当前时刻 → 内联报错不提交（过去 reminder 行会在桌面 grace 窗口内立即触发 / native OS 调度拒收——R7：过去行永不补排）；`open` 翻转时重置 picker 瞬态状态（sheet 常驻挂载）。
- 测试：`lib/snooze-options.test.ts` 重写 + 新增 `__tests__/snooze-sheet.test.tsx`（chip 流 / 过去时间拒收 / 两种取消语义）。
- 验收影响：桌面 AC1/AC3/AC4/AC5 桌面半需用**重建的 release 包**重走（包路径不变）。
