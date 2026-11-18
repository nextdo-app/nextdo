# macOS 日历通道 — 技术设计

## 决策摘要

在 `apps/desktop/src-tauri` 增加一个 **macOS 专属的 EventKit 桥**，通过 Tauri command 暴露「权限查询 / 请求权限 / 写入 / 更新 / 删除日历事件」；`apps/mobile/lib/calendar-sync/` 增加一个与现有 `device.ts`（expo-calendar 封装）同接口的桌面实现；`use-calendar-sync.ts` 的平台门禁从「仅 iOS/Android」放宽到「iOS/Android 或 macOS 桌面端」。

权限档位选**完全访问**（`requestFullAccessToEventStore`），理由见下。

## 为什么是完全访问而不是仅写入

macOS 的 EventKit 有三个档位，与移动端 `expo-calendar` 的能力模型不同：

| 档位 | 能写入 | 能读回自己建的事件 | 能删除 |
|---|---|---|---|
| 无 | 否（只能走 EventKitUI 让用户手动确认） | — | — |
| 仅写入（Sonoma 14+） | 是 | **否** | **否** |
| 完全访问 | 是 | 是 | 是 |

移动端实现的生命周期语义（R3）依赖读回与删除：`use-calendar-sync.ts` 保存 `reminders.id → eventId` 映射，提醒取消时按映射删除事件，标题/时间变化时更新同一事件。仅写入档位下 `eventStore.event(withIdentifier:)` 被拒，`remove(event:span:)` 也就无从取得 `EKEvent` 实例——**仅写入只能追加，永远清不掉**，等于放弃 R3。

Apple 的指引是「只有当应用的核心功能需要展示、更新或删除已有事件时才申请完全访问」。本功能恰恰需要删除与更新自己创建的提醒事件，符合该条件，因此在 Info.plist 里用 `NSCalendarsFullAccessUsageDescription` 说明用途。

仅写入/EventKitUI/生成 `.ics` 三条路都保留为**降级选项**记录在此，若将来决定放弃生命周期管理可退回，但当前不作为方案。

## 分层

```
apps/desktop/src-tauri/src/calendar.rs   ← 新增：EventKit 桥（#[cfg(target_os = "macos")]）
apps/desktop/src-tauri/src/lib.rs        ← 注册 command + capabilities
apps/mobile/lib/calendar-sync/device.ts  ← 现有 expo-calendar 封装（不动，作为原生实现）
apps/mobile/lib/calendar-sync/desktop.ts ← 新增：与 device.ts 同接口的 Tauri 实现
apps/mobile/lib/calendar-sync/index.ts   ← 新增/扩展：按平台选实现
apps/mobile/hooks/use-calendar-sync.ts   ← 放宽平台门禁
apps/mobile/hooks/use-reminder-delivery.ts ← 通道所有权判定放宽
apps/mobile/app/(tabs)/settings.tsx      ← 提醒区块增加 macOS 选项
```

### Rust 侧命令契约

```
calendar_permission() -> "notDetermined" | "restricted" | "denied" | "authorized"
calendar_request_permission() -> 同上（返回请求后的状态）
calendar_upsert_event({ id, title, notes, startsAt, durationMinutes, alarmOffsetMinutes }) -> { eventId }
calendar_delete_event({ eventId }) -> ()
```

- `id` 是 `reminders.id`；Rust 侧不保存映射，映射仍由 `calendar-sync/store.ts` 持久化，保持单一事实来源在客户端 DB。
- `calendar_upsert_event` 内部：按 `eventId` 查已有事件（不存在则新建），写标题/备注/时间/闹钟后 `save`。这样「更新」与「创建」共用一条路径，天然幂等。
- 时间参数传 ISO 8601 字符串，Rust 侧转 `NSDate`；不做时区推断，由调用方给绝对时刻。
- 所有 command 返回 `Result<T, String>`，错误信息只描述类别（权限/日历不存在/写入失败），不带用户数据。

### Rust 依赖

- `objc2` + `objc2-foundation` + `objc2-event-kit`（objc2 官方 EventKit 绑定，见 `research/findings.md`）。
- 不引入 `highlandcows-eventkit`：它同时封装 Reminders 与 Calendar，超出本任务范围，且本任务需要精确控制权限档位。

### 前端 IPC 约束（来自现有代码）

`apps/mobile/lib/reminders/adapters/index.ts:23-33` 的注释明确：Tauri 检测走 `window.__TAURI_INTERNALS__` 的类型化全局视图，**刻意不 import `@tauri-apps/api`**，以免把 IPC 拖进 web bundle graph。新的日历适配器必须沿用同一约束——要么同样用类型化全局视图调 `invoke`，要么把 `@tauri-apps/api` 放进懒加载模块，只在检测到 Tauri 时载入。这点直接决定 web 构建不会因为桌面端代码而变大。

### 平台判定

现有 `createAdapterForPlatform()` 用 `Platform.OS === 'web' && isTauriRuntime()` 选 Tauri 适配器。日历通道还需要区分 **macOS** 与 Windows/Linux：用 `@tauri-apps/plugin-os` 的 `platform()` 得到 `"macos" | "windows" | "linux"`，或由 Rust 侧提供一个 `calendar_supported()` command 直接回答「本机是否支持日历通道」，后者更省事且避免前端再引一个插件。

## 权限与降级

- 请求时机：只在用户主动把通道切到 `calendar` / `both` 时请求，不在启动时弹窗（与移动端「设置页拥有请求权」的约定一致，见 `use-calendar-sync.ts:19-27` 的三道门注释）。
- 被拒 / restricted：`calendarOwnsReminderDelivery` 判定为「日历不接管」，继续走 app 通道投递。现有逻辑已经把「权限未授予」当作不接管，桌面端复用即可。
- 撤销权限后：写入失败不抛到 UI，记 `logger.warn` 并在下次对账重试；已建事件无法删除时留下孤儿事件（在设置页说明），这是撤销权限的必然结果，不做静默清理。

## 与「日历事项同步」开关的关系

沿用移动端不变量：`calendarEnabled`（事项同步）与 `reminderChannel`（提醒通道）互相独立，两套 reconcile 各自维护自己的映射，互不删除对方创建的事件。桌面端接入后此不变量必须保持——实现上仍是两个独立的 reconcile 循环，只是 `device.ts` 的实现换成平台自适应。

## 规范修正

`domain-model.md` 平台能力矩阵的 Desktop 行需要改写为：

- `tauri-plugin-notification` 无未来定时 → 应用内 tick，应用关闭后不投递**应用通知**；
- macOS：日历通道（EventKit，完全访问）可在应用关闭后仍由系统日历提醒；
- Windows / Linux：暂无等价通道，v1 保持应用内 tick。

## 风险

1. **签名与 TCC**：entitlement 必须同时写进标准（非 MAS）entitlements 文件，否则 macOS 会在内核层静默拒绝 TCC 弹窗（社区案例见 `research/findings.md`）。发布包走 Developer ID 签名 + 公证，本地开发包也要能弹窗，需要实测确认。
2. **`__TAURI_INTERNALS__` 的 `invoke` 形状**：直接调内部 IPC 而非 `@tauri-apps/api` 是既有约定，但内部实现可能在 Tauri 版本间变化；实现时以当前 `tauri 2.x` 的 `invoke` 签名为准，必要时退回懒加载 `@tauri-apps/api`。
3. **首次写入的日历归属**：与移动端一样需要选定目标日历（Nextdo 自建，否则取一个可写日历）。完全访问下可以创建日历，但创建日历会污染用户的日历列表；优先复用移动端策略：找同名日历，没有就用系统默认日历。
4. **重复投递**：同一条提醒可能既被日历提醒又被应用内 tick 提醒（`both` 模式下这是预期；`calendar` 模式下必须确保 app 侧真的不投递，否则用户收到两次）。这是既有 `calendarOwnsReminderDelivery` 的职责，桌面端必须走同一判定。
