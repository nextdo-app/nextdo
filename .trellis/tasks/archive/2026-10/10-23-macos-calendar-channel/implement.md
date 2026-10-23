# 执行计划

## 前置

- 阅读 `.trellis/spec/domain/domain-model.md`（提醒投递与平台能力矩阵）、`.trellis/spec/app/component-guidelines.md`（MarkdownNote 约定，备注纯文本化）、`.trellis/spec/project/directory-structure.md`（包边界）。
- 本任务触及 `apps/desktop/src-tauri`（Rust）与 `apps/mobile`（TS），不触及 `server/powersync`、`server/app`、`packages/db/src/powersync.ts`，因此**不需要**跑 `node e2e/sync-roundtrip.ts`。

## 步骤

### 1. Rust：EventKit 桥（`apps/desktop/src-tauri/src/calendar.rs`）

- `#[cfg(target_os = "macos")]` 模块，用 `objc2` + `objc2-event-kit` 实现四个 command（契约见 `design.md`）。
- 非 macOS 目标编译出一个返回 `calendar_supported() -> false` 的桩，保证 Windows/Linux 构建不破。
- 权限状态枚举按 SDK 版本判断分派，不用 `#ifdef`（见 `research/findings.md` 的坑）。
- 事件查找：`calendar_upsert_event` 按 `eventId` 查已有事件，查不到就新建；闹钟用相对偏移 0。

**验证**：`cargo check`（在 `apps/desktop/src-tauri`）；纯逻辑（ISO 时间解析、时长兜底 15 分钟 / 最少 1 分钟、事件字段组装）抽成不依赖 EventKit 的函数并写 `#[cfg(test)]` 单测，`cargo test` 通过。

### 2. Rust：注册与权限声明

- `src/lib.rs` 的 `invoke_handler` 注册四个 command；`capabilities/default.json` 加对应权限。
- 新增 `src-tauri/Entitlements.plist`（`com.apple.security.personal-information.calendars`），`tauri.conf.json` 的 `bundle.macOS.entitlements` 指向它；确认**标准 entitlements 文件**（非 MAS）里有该键。
- Info.plist 的 `NSCalendarsFullAccessUsageDescription` 通过 `tauri.conf.json` 的 `bundle.macOS.infoPlist`（或 `Info.plist` 注入）写入，文案说明「用于把提醒写入系统日历」。

**验证**：`cargo check` 通过；`tauri.conf.json` JSON 合法；`plutil -lint` 校验两个 plist。

### 3. TS：桌面日历适配器（`apps/mobile/lib/calendar-sync/desktop.ts`）

- 与 `device.ts` 同接口（权限查询 / 请求 / upsert / delete / 选目标日历）。
- 遵守既有约定：**不 import `@tauri-apps/api`**，用 `window.__TAURI_INTERNALS__` 的类型化全局视图调 `invoke`（`adapters/index.ts:23-33` 的写法），或把 `@tauri-apps/api` 放进懒加载分支。
- 平台判定用 `calendar_supported()` command 的结果，不依赖 `Platform.OS`。

**验证**：`pnpm --filter @nextdo/mobile typecheck`；`pnpm --filter @nextdo/mobile lint`。

### 4. TS：接线与门禁放宽

- `apps/mobile/hooks/use-calendar-sync.ts:183` 的平台门禁从「仅 iOS/Android」放宽到「iOS/Android 或 macOS 桌面端（且 `calendar_supported()` 为真）」。
- `apps/mobile/hooks/use-reminder-delivery.ts` 的通道所有权判定（`calendarOwnsReminderDelivery`）确认对桌面端日历通道成立，权限未授予时仍降级为 app 投递。
- `apps/mobile/app/(tabs)/settings.tsx` 的「提醒」区块：仅 macOS 桌面端显示 `calendar` / `both`；权限被拒时显示状态与「打开系统设置」入口（桌面端用 `x-apple.systempreferences:` URL scheme 打开日历隐私面板，或 Rust command 打开）。
- 选项持久化沿用 `apps/mobile/lib/notification-settings.ts` 的 `reminderChannel`，不新增字段。

**验证**：`pnpm --filter @nextdo/mobile test`（既有 reconcile / reminder-plan 测试不回归）；新增门禁判定的单测。

### 5. 规范修正

- 改写 `domain-model.md` 平台能力矩阵的 Desktop 行（见 `design.md`「规范修正」）。

**验证**：文档自洽，无遗留「桌面端无法投递」的表述。

### 6. 门禁与实测

- `node scripts/verify-web.mjs --no-serve` 必须 `EXIT=0`（lint / typecheck / build:web / 全量测试）。
- **macOS 真机实测**：`pnpm --filter @nextdo/desktop tauri dev`，在设置页切到 `calendar`，授权后确认事件出现在系统日历（开始时刻、0 分钟闹钟、描述为纯文本备注）；改时间/标题/备注后事件被更新；取消提醒后事件消失；切回 `app` 后事件被清除。
- 证据存 `.verify/10-23-macos-calendar-channel/`：`evidence.md` + 截图（设置页、系统日历中的事件、授权弹窗、拒绝后的降级状态）。

## 未验证项（需在实现中确认，已列入 design 风险）

- ~~Tauri 2.x 的 `__TAURI_INTERNALS__.invoke` 确切签名~~ → 已按 `adapters/tauri.ts` 既有写法实现，`desktop.test.ts` 覆盖参数形状。
- **未公证 dev 构建的 TCC 弹窗行为** —— 仍需真机确认。
- **闹钟用 `EKAlarm(relativeOffset: 0)` 的实际效果** —— 仍需真机确认。

## 实现记录（2026-10-23）

实际落地与计划的两处偏离，均为实现中发现的问题：

1. **非 macOS 不是「不注册」，而是「同名桩模块」**。原计划让 `generate_handler!` 在非 macOS 目标上不列日历命令，但这会让 Windows/Linux 上的 `calendar_supported` 变成 `command not found`，前端只能靠 catch 兜底。改为 `calendar_stub.rs` 用 `#[path]` 顶替同一模块名：`calendar_supported()` 明确回答 `false`，其余命令返回「当前系统不支持日历通道」。两条 cfg 分支都已 `cargo check` 通过。
2. **`calendar_request_permission` 不能在主线程阻塞**。EventKit 的 completion handler 在主队列投递，原实现把「发请求 + 等回调」整体塞进 `run_on_main_thread`，会自锁。改为只把发请求派到主线程、等待放在 command 自己的线程上。

验证证据见 `.verify/10-23-macos-calendar-channel/evidence.md`。

## 交付顺序

业务代码 → 规范 → 归档 → 会话日志；提交前先向用户提交提交计划并等待确认。
