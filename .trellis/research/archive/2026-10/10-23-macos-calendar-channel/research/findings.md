# 网络检索结论（2026-10-23）

## 1. macOS 能否被第三方应用写入日历

能。三条路径，能力递增：

| 路径 | 是否静默 | 能读回/删除 | 适用 |
|---|---|---|---|
| EventKitUI（`EKEventEditViewController`） | 否，每条事件都要用户在系统表单里确认 | 否 | 手动单条添加 |
| EventKit 仅写入（`requestWriteOnlyAccessToEvents`，Sonoma 14+） | 是 | **否**（读不到自己建的事件，也列不出日历、建不了日历） | 只追加、不管理 |
| EventKit 完全访问（`requestFullAccessToEventStore`） | 是 | 是 | 需要更新/删除已有事件 |

来源：Apple WWDC23「Discover Calendar and EventKit」与 EventKit 文档。

- Info.plist 键：仅写入用 `NSCalendarsWriteOnlyAccessUsageDescription`，完全访问用 `NSCalendarsFullAccessUsageDescription`，两者都会出现在系统授权弹窗里。
- Apple 的指引：只有核心功能需要展示/更新/删除已有事件时才申请完全访问。
- **仅写入档位下应用连自己刚建的事件都读不回来**（原文：the app still cannot read any existing events from the calendar, including events added by the same app），因此无法实现「更新 / 删除」。
- 「提醒事项」是 EventKit 的一部分，但没有仅写入档位，写入 Reminders 需要完全访问。

## 2. Rust 侧怎么调 EventKit

- `objc2-event-kit`（crates.io，2025-10 发布）：objc2 项目对 EventKit 的官方 Rust 绑定，暴露 `EKEventStore` 等类型。**本任务采用。**
- `highlandcows-eventkit`（docs.rs）：macOS-only 的 Rust 封装，覆盖 Reminders 与 Calendar 的创建与修改。范围比本任务需要的宽，未采用。
- 未检索到现成的 Tauri 日历插件。社区做法是自建桥（例：Mindwtr 用 Objective-C 的 in-process EventKit 实现）。另有 `tauri-plugin-notifications`，但那是推送通知插件，与系统日历无关。

## 3. Tauri 侧的配置要求

- Tauri v2 官方文档「macOS Application Bundle」：在 `src-tauri/Entitlements.plist` 写 entitlement，并在 `tauri.conf.json` 的 `bundle.macOS.entitlements` 指向它。日历相关 entitlement 键是 `com.apple.security.personal-information.calendars`。
- **坑（社区 issue，Mindwtr #203）**：该 entitlement 只加进 Mac App Store 用的 `Entitlements.mas.plist`、漏在标准 `Entitlements.mac.plist` 里时，Homebrew / Developer ID 分发的构建启用了 Hardened Runtime，macOS 会在内核层直接拦掉 TCC 弹窗——应用表现是「点了没反应」，而不是报错。两个 entitlements 文件都要有。
- 同一 issue 的另一个坑：`#ifdef EKAuthorizationStatusFullAccess` 永远为假，因为它是 enum 而非预处理宏；应改用 SDK 版本判断（`__MAC_OS_X_VERSION_MAX_ALLOWED >= 140000`）。这条提醒我们：**权限状态的枚举分派不要用 `#ifdef`**。
- 当前仓库 `apps/desktop/src-tauri/tauri.conf.json` 的 `bundle` 段没有 `macOS.entitlements`，需要新增。

## 4. 待实测确认的点（未验证，实现时验证）

- Tauri 2.x webview 里 `window.__TAURI_INTERNALS__.invoke` 的确切签名（仓库现有约定是不 import `@tauri-apps/api`，见 `adapters/index.ts:23-33`）。
- 未公证的本地 dev 构建能否弹出日历授权弹窗（Hardened Runtime 与 TCC 的交互）。
- 系统日历事件的「开始时提醒」闹钟在 EventKit 里对应 `EKAlarm(absoluteDate:)` 还是相对 `EKAlarm(relativeOffset: 0)`——两者语义在开始时刻相同，取后者更贴近移动端写法。
