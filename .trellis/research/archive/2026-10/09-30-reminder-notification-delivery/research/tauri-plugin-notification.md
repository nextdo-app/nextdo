# 研究：tauri-plugin-notification（Tauri v2 桌面端）

> 任务：09-30-reminder-notification-delivery · 研究日期 2026-09-30
> 结论均给出出处；「源码」指 **crates.io 发布的 tauri-plugin-notification 2.4.0 crate 源码包**（与 JS 2.4.0 对应、兼容本 app 的 tauri 2.11.6 / @tauri-apps/api 2.11.1），另核对 npm 2.3.3/2.4.0 tarball 与 plugins-workspace v2 分支。
> 产品约束（见 prd.md Decisions）：D1 桌面用本插件；D2 仅 deep-link 无按钮；桌面 webview 跑的是 `expo export --platform web` 的同一份 bundle。

## 0. 结论速览

1. **版本**：与 Tauri 2.11 配套 = **Rust crate `tauri-plugin-notification = "2.4.0"` + JS `@tauri-apps/plugin-notification@2.4.0`**（两者自 2.2.0 起版本号同步）。JS 2.4.0 依赖 `@tauri-apps/api ^2.11.0`（app 现为 2.11.1 ✅）；Rust 2.4.0 依赖 `tauri ^2.10`（app Cargo.lock 为 2.11.6 ✅）。**不要用 2.5.0**：它要求 `tauri ^2.12` / `@tauri-apps/api ^2.12.0`，会迫使升级 core。
2. **（最关键）桌面端不支持原生调度**：macOS / Windows / Linux **全部**只能立即弹出。插件 `schedule` 字段在桌面端被反序列化后**从未被读取**（源码确认）；桌面 `show()` 只取 title/body/icon/sound 四个字段，经 `notify-rust` 立即投递。**结论：桌面端只能靠 app 运行期间自己的 JS 定时器到点调 `sendNotification`**——app 进程不在时（关机/已退出），桌面端该提醒不会响。
3. **权限**：`isPermissionGranted()` / `requestPermission()` 可用，但桌面 Rust 侧**恒返回 granted**（`PermissionState::Granted`，无弹窗）；JS 层先查 `window.Notification.permission`（插件 init 脚本已同步为 granted）。macOS 无系统级请求弹窗（用户在 系统设置→通知 里管理）；Windows 恒授权；Linux 无。
4. **payload 透传 / 点击回调**：`Options.extra` 字段存在，但**桌面端 show() 不读、也无处读回**（桌面无 pending/active/任何事件）→ 桌面端 payload 实际不可用。**2.x 没有 `onNotificationClick`**；JS 只有 `onNotificationReceived`/`onAction`，且**仅移动端原生代码会 emit**（Android Kotlin / iOS Swift），桌面端零事件 → 点通知的 payload 在桌面拿不到。
5. **Rust 集成**：Cargo.toml 加 `tauri-plugin-notification = "2.4.0"`；`lib.rs` Builder 链加 `.plugin(tauri_plugin_notification::init())`；`apps/desktop/src-tauri/capabilities/default.json` 的 `permissions` 数组加 `"notification:default"`（现状：`core:default` + 2 条 stronghold，见 §4）。
6. **macOS dev 模式**：`tauri dev` 下插件**强制把通知归属 bundle ID 设为 `com.apple.Terminal`**（desktop.rs 源码，`tauri::is_dev()` 分支）→ 开发时通知以 Terminal 名义出现、点击只聚焦 Terminal。另有历史 issue（plugins-workspace#2143、tauri#4965）：dev 签名身份变化时 macOS 可能静默丢弃通知，workaround 是 系统设置→通知 重新启用对应条目。release 构建（正式签名/安装）下归属 `com.nextdo.desktop`，正常。
7. **点击通知拉起 app（app 进程不存在时）**：**macOS release 可以**（UNUserNotificationCenter 通知绑定 bundle ID，点击时 Launch Services 拉起 app——但插件不暴露任何点击回调/payload，app 只是「被打开到默认屏」，无法知道点了哪条提醒）；**Windows 安装版大概率可以**（toast 设了 AUMID，点击激活 app；dev 版不设 AUMID，官方文档明示 dev 下显示 powershell 名/图标）；**Linux 不行**（libnotify 无激活语义）。→ D2 的「点通知→聚焦/启动 app」在桌面端**部分成立**：能拉起/聚焦，但**做不到落到被提醒的行动**（无 payload、无点击事件）。

---

## 1. 版本号（与 Tauri 2.11 配套）

查证方式：crates.io API + npm registry（2026-09-30）。

| 包 | 候选版本 | 依赖要求 | 与 app 现状（tauri 2.11.6 / api 2.11.1 / cli 2.11.5） |
| --- | --- | --- | --- |
| Rust `tauri-plugin-notification` | **2.4.0**（2026-08-31） | `tauri ^2.10`、`tauri-plugin ^2.5`、MSRV rust 1.77.2 | ✅ 兼容 |
| Rust `tauri-plugin-notification` | 2.5.0（2026-09-26，最新稳定） | `tauri ^2.12`、MSRV rust 1.90 | ❌ 需升级 core 到 2.12+ |
| JS `@tauri-apps/plugin-notification` | **2.4.0** | `@tauri-apps/api ^2.11.0` | ✅ 兼容 2.11.1 |
| JS `@tauri-apps/plugin-notification` | 2.5.0（latest） | `@tauri-apps/api ^2.12.0` | ❌ 需升级 api |

- 参考锚点：app 现有 `tauri-plugin-stronghold` Rust 2.3.2 / JS 2.3.2 也是 Rust/JS 同版本配对（changelog 2.2.0 节明示「From now, the versions for the Rust and JavaScript packages of each plugin will be in sync」）。
- 若将来 app 升级 tauri core 到 2.12+，可平滑换 2.5.0（本研究发现 2.5.0 的 JS 对桌面行为无实质变化，见 §2 备注）。
- 安装：`pnpm --filter @nextdo/desktop add @tauri-apps/plugin-notification@2.4.0` + `cargo add tauri-plugin-notification@2.4.0`（或直接编辑 Cargo.toml）。注意 JS 包需能进入 **web bundle 的依赖图**——本 app 的 JS 代码在 `apps/mobile` + `packages/*`，桌面壳 `apps/desktop` 只加载其 web build，所以这个 import 应落在共享投递层（`packages/*`）并按平台懒加载/feature-detect（`@tauri-apps/api` 的 `isTauri()` 或 `window.__TAURI_INTERNALS__`），避免纯 web 环境引入无意义的 IPC 代码。

## 2. 能否调度到未来时间点？——**三平台桌面端都不行（源码确认）**

### 2.1 源码证据（2.4.0 crate，crates.io 源码包）

**命令面**（`src/lib.rs`）——全平台（含桌面）只注册 3 个 invoke 命令：

```rust
Builder::new("notification")
    .invoke_handler(tauri::generate_handler![
        commands::notify,
        commands::request_permission,
        commands::is_permission_granted
    ])
    .js_init_script(include_str!("init-iife.js")...)
```

没有 schedule/get_pending/cancel 等命令的桌面注册（`src/commands.rs` 全文也只有这 3 个）。

**桌面投递路径**（`src/desktop.rs`，`imp::Notification::show()`）：

```rust
let mut notification = notify_rust::Notification::new();
// 只读 4 个字段：
if let Some(body) ... notification.body(&body);
if let Some(title) ... notification.summary(&title);
if let Some(icon) ... notification.icon(&icon);
if let Some(sound) ... notification.sound_name(&sound);
// (windows: 安装版才设 AUMID; macos: dev 设 com.apple.Terminal)
tauri::async_runtime::spawn(async move { let _ = notification.show(); });
```

`grep schedule` 于 desktop.rs：**零命中**。`NotificationData.schedule: Option<Schedule>`（`src/models.rs`）会被 JS→Rust 反序列化（JS 端 `Schedule.at/interval/every` 构造器存在，`Options.schedule` 字段存在），但**桌面端从不读取**——传了就是被忽略。

### 2.2 分平台结论

| OS | 底层 | OS 本身是否支持定时 | 插件是否暴露 | 结论 |
| --- | --- | --- | --- | --- |
| macOS | `notify-rust 4.11` → `mac-notification-sys 0.6` → **UNUserNotificationCenter** | ✅ 支持（UNCalendar/UNTimeInterval trigger；notify-rust 甚至有 `schedule_notification(delivery_date)` API） | ❌ 插件桌面路径只调 `show()`（立即），不用 schedule | **不能**，只能立即弹 |
| Windows | `notify-rust 4.11` → `tauri-winrt-notification`（fork）→ WinRT **Toast** | ❌ toast API 只有自动消失时长，无定时投递 | ❌ | **不能** |
| Linux | `notify-rust` → libnotify（D-Bus `org.freedesktop.Notifications`） | ❌ 无定时语义 | ❌ | **不能** |

→ **明确结论：桌面端不支持原生调度。桌面端只能靠 app 运行期间自己的 JS 定时器（如 setInterval/到点检查 loop）到点调 `sendNotification`。app 进程不存在时，桌面端该提醒不会响**（与 iOS/Android 的 OS 级持久化形成平台差异，这是 D1 决策下桌面端的固有限制，需在 PRD 里写明：桌面提醒 = 「app 开着才响」）。

备注：3.0.0-alpha（v2 分支）把桌面 send 改成走 `window.Notification` Web API 的注释明确写着「Scheduling is only implemented on mobile; the desktop implementation delivers the notification immediately and ignores the schedule」，与 2.4.0 源码行为一致——不是本版本特有行为。

## 3. JS API 面（2.4.0，`dist-js/index.d.ts` + 编译产物核对）

导出：`sendNotification, requestPermission, isPermissionGranted, registerActionTypes, pending, cancel, cancelAll, active, removeActive, removeAllActive, createChannel, removeChannel, channels, onNotificationReceived, onAction, Schedule, ScheduleEvery, Importance, Visibility`。

- **`isPermissionGranted(): Promise<boolean>`**：JS 实现先查 `window.Notification.permission`（init 脚本已同步），非 default 直接返回，否则 invoke `is_permission_granted`。桌面 Rust：`permission_state()` 恒 `Granted`（desktop.rs：「Desktop applications do not need to ask for this permission, so this always resolves to Granted without prompting the user」）。
  - 平台差异：macOS 无请求弹窗（授权模型 = 系统设置→通知 里按 app 开关；首次弹出通知时系统自动记为已授权，用户可事后关）；Windows 恒授权；Linux 无权限概念。→ **桌面端不需要（也无法做）请求弹窗流程**；`isPermissionGranted` 恒 true 不代表用户没在系统设置里关掉通知（macOS 关了系统开关后 JS 仍报 granted，通知只是不显示——无法检测）。
- **`requestPermission(): Promise<NotificationPermission>`**：桌面 = `window.Notification.requestPermission()`（init 脚本已替换为 invoke 版，恒 resolved `'granted'`）。
- **`sendNotification(options | string): void`**（同步，无 Promise）：最终经 init 脚本替换的 `window.Notification` 构造器 invoke `notify` → Rust `notify` 命令 → 桌面 notify-rust 立即弹。
- **payload 透传（`extra`）**：`Options.extra: Record<string, unknown>`（「Extra payload to store in the notification」）→ `NotificationData.extra`。**桌面端 show() 不读 extra，且没有任何读回通道**（桌面无 `pending()`/`active()` 命令注册——JS 调 `pending()`/`active()`/`channels()`/`createChannel()` 等在桌面会 invoke 未注册命令直接 reject「command not found」；这些命令在移动端由 Kotlin/Swift 原生模块注册，2.3.3 crate 的 `android/src/main/java/NotificationPlugin.kt` 可见 `@Command` 方法）。→ **桌面端 payload 实际不可用**；别把 reminder 行 ID 塞进 extra 指望读回。
- **点击回调**：**2.x 没有 `onNotificationClick` 函数**（各版本 d.ts 均无）。最接近的是：
  - `onNotificationReceived(cb): Promise<PluginListener>` —— 文档「Only emitted on mobile」；
  - `onAction(cb): Promise<PluginListener>` —— 文档「Only emitted on mobile, for notifications that reference an action type」；事件从移动端原生代码发出（Android `NotificationPlugin.kt: trigger("actionPerformed", dataJson)`；iOS Swift 侧对应 emit）。桌面 `desktop.rs` **零 emit** → 桌面端收不到任何通知事件（点击、展示、动作全无）。
  - → **桌面端无法得知「通知被点了」，更拿不到 payload**。D2 的「点通知→deep-link 到具体行动」在桌面端不可实现，只能退化为「拉起/聚焦 app」（§6）。
- **`Options` 桌面端实际生效字段**：`title`、`body`、`icon`、`sound`（其余：schedule/channelId/largeBody/inboxLines/group/attachments/autoCancel/ongoing/number/visibility 均被忽略）。`sound` 文档（v2 分支 d.ts，2.4.0 同）：macOS 用系统声音名（"Ping"/"Blow"）或 bundle 内文件；Windows 用 .wav 文件路径；Linux 用 XDG 主题音名或路径。→ **强度映射在桌面端只有「声音」一个维度**（normal/important/alarm 可映射不同 sound 文件），无振动、无渠道、无 importance。

## 4. Rust 集成步骤（对照本 app 现状）

**现状**（已读文件）：`apps/desktop/src-tauri/Cargo.toml` 依赖 `tauri 2.11.6` + `tauri-plugin-stronghold 2.3.2`；`src/lib.rs` 的 `run()` 里 Builder 链在 `setup` 内注册 stronghold 插件；`capabilities/default.json` = `core:default` + `stronghold:default` + `stronghold:allow-remove-store-record`，windows: `["main"]`。

**要改 3 处**：

1. `apps/desktop/src-tauri/Cargo.toml` `[dependencies]` 加：
   ```toml
   tauri-plugin-notification = "2.4.0"
   ```
2. `apps/desktop/src-tauri/src/lib.rs` 的 `tauri::Builder::default()` 链加（与 stronghold 同链，位置无严格要求；插件在 run 时初始化，`setup` 前后皆可，惯例放 `manage` 之后、`setup` 之前）：
   ```rust
   .plugin(tauri_plugin_notification::init())
   ```
   （`init()` 内部完成命令注册 + init 脚本注入，无需额外 setup 代码；Rust 侧主动发通知可用 `app.notification().builder().title(..).body(..).show()`，本任务用 JS 侧即可。）
3. `apps/desktop/src-tauri/capabilities/default.json` `permissions` 数组加 `"notification:default"`（默认权限集 = 全部通知命令，2.4.0 `permissions/default.toml` 确认包含 `allow-notify`/`allow-is-permission-granted`/`allow-request-permission` 等）。最小化也可只加 `notification:allow-notify` + `notification:allow-is-permission-granted`（+ 若调 requestPermission 则加 `notification:allow-request-permission`）。

`tauri.conf.json` **无需改动**（通知插件无 config 段；macOS 本地通知无需 entitlement；bundle 配置不动）。`main.rs` 不动（`run()` 在 lib.rs）。

## 5. macOS dev 模式注意事项

**源码行为（2.4.0 `desktop.rs`）**：

```rust
#[cfg(target_os = "macos")]
{
    let _ = notify_rust::set_application(if tauri::is_dev() {
        "com.apple.Terminal"        // dev 模式：把通知归属到 Terminal
    } else {
        &self.identifier            // release：com.nextdo.desktop（tauri.conf.json identifier）
    });
}
```

- `mac-notification-sys 0.6`（notify-rust 的 macOS 后端）通过 **hook `NSBundle.mainBundle` 伪造 bundle ID** 把 UNUserNotificationCenter 通知挂到指定 app 名下；伪造的 ID 必须能被 `LSCopyApplicationURLsForBundleIdentifier` 解析到真实已安装 app（`objc/notify.m`）。`com.apple.Terminal` 永远解析成功 → 所以 dev 模式通知能显示，但**署名是 Terminal**（图标/名字都是 Terminal 的）。
- 已知 issue：
  - `tauri-apps/plugins-workspace#2143`（v1 时代，症状同 v2）：macOS dev 下通知完全不显示。根因是 dev 二进制的 ad-hoc/开发签名身份每次构建可能变化，而 macOS 通知授权按「app 身份」记账——身份一变，之前授予的通知权限失效，系统静默丢弃。
  - `tauri-apps/tauri#4965`：同类「macOS dev 通知不响」。
- workaround（按推荐顺序）：
  1. **接受 dev 模式的 Terminal 署名**（插件已内置此 hack，通常 dev 下直接能弹）；验收通知行为用 release 构建（`pnpm --filter @nextdo/desktop build` 出的 .app）；
  2. 若 dev 下仍静默丢弃：系统设置→通知与专注模式→通知，找到对应条目（可能显示为 app 名或旧身份）打开开关；清掉旧身份后重新 `tauri dev`；
  3. 用稳定的开发签名身份（Xcode 里给 dev 构建配一致的 Team/Signing）可避免每次重建后授权失效；
  4. 注意 `set_application` 对同一 ID 二次调用会报错（`tests/application.rs` 证实），插件已 `let _ =` 忽略，无碍。
- Windows dev：官方平台表明示「Only works for installed apps. **Shows powershell name & icon in development**」——dev 下 toast 显示 powershell 名/图标，且**不设 AUMID**（desktop.rs：exe 路径以 `target\debug|release` 结尾时跳过 `app_id`），dev 下点击行为与安装版不同。

## 6. app 已关闭时点通知：能否拉起 app？

| OS | 行为 | 出处/依据 |
| --- | --- | --- |
| **macOS（release，已安装）** | ✅ **能拉起**。通知经 UNUserNotificationCenter 以 bundle ID `com.nextdo.desktop` 投递（fake-NSBundle hook），该 ID 对应已安装 app；macOS 对「点击一条属于某 app 的通知、而 app 未运行」的既定行为是 Launch Services 拉起该 app（Apple UserNotifications 文档：点击通知会启动未运行的 app）。**但插件不暴露点击事件与 payload**（§3）→ app 被拉起后只停在默认屏，不知道点了哪条提醒，做不到 deep-link 到具体行动 | desktop.rs `set_application(&self.identifier)`；mac-notification-sys `objc/notify.m`（ID 必须可被 Launch Services 解析，即 app 需已安装/注册）；Apple UNUserNotificationCenter 文档 |
| **macOS（dev）** | ❌ 拉起的是 **Terminal**（dev 下 ID 被强制为 com.apple.Terminal） | desktop.rs `tauri::is_dev()` 分支 |
| **Windows（安装版）** | ⚠️ 大概率能：安装版才设 AUMID（`System.AppUserModel.ID = com.nextdo.desktop`，desktop.rs 路径判断），WinRT toast 绑定有效 AUMID 时点击会激活（打开/聚焦）对应 app（Windows toast activation 文档行为）。**无点击回调/payload**，且 dev 版（无 AUMID）点击不拉起 app | desktop.rs `#[cfg(windows)]` 块；官方文档平台表「Only works for installed apps」 |
| **Windows（dev）** | ❌ 不设 AUMID，点击不拉起 app | 同上 |
| **Linux** | ❌ libnotify/D-Bus 通知无「点击激活 app」语义，点击=无操作 | notify-rust xdg 实现 |

**对 D2 的含义**：桌面端「点通知→聚焦/启动 app」**部分成立**——macOS release 与 Windows 安装版能做到「拉起/聚焦到 app」，但**没有任何机制把「点的是哪条提醒」传给 app**（无 onNotificationClick、无 payload 读回）。因此桌面端 deep-link 的落点只能是「app 默认屏（Now 屏）」，与移动端「data.url 路由」在体验上对齐（D2 本就说落 Now 屏），但实现上是「系统拉起 app」而非「JS 收到事件后 router.push」。若未来要桌面端精确定位被提醒项，需自写 Rust 侧方案（macOS 监听 `UNUserNotificationCenterDelegate.didReceiveResponse` 或自定义 command），超出本任务范围，列 follow-up。

## 7. 对本任务设计的直接影响（实现备注）

1. **桌面投递 = app 内 JS 定时器**：桌面分支的「调度」= 消费 reminders 表后，对每个 `fires_at` 建 JS 侧到点任务（`setTimeout`/轮询），到点调 `sendNotification({ title, body, sound? })`；app 重启/同步新行时重建定时器；`fires_at` 已过且未 fired 的行直接补弹（或跳过，实现时定）。**不要**给桌面分支传 `schedule` 字段（会被忽略，纯噪音）。
2. **桌面分支 API 白名单**：只用 `isPermissionGranted` / `sendNotification`（+ 可选 `requestPermission`，恒 granted）。**不要**调 `pending/cancel/active/channels/onNotificationReceived/onAction`——桌面端命令未注册，invoke 会 reject。
3. **平台分派**（R1）：投递层按 `isTauri()`（@tauri-apps/api）区分 Tauri 桌面 vs 纯 web（no-op）vs 原生（expo-notifications）；同一份 bundle 三端跑，import 用动态 `import('@tauri-apps/plugin-notification')` 或平台条件，避免纯 web dev 环境无谓依赖。
4. **强度映射**：桌面只有 `sound` 维度（macOS 系统音名/bundle wav、Windows wav 路径、Linux XDG 音名）；normal→默认（不传 sound）、important/alarm→不同 wav 文件（需随 bundle 资源打包）。无振动/importance 概念。
5. **版本锁定**：Rust `tauri-plugin-notification = "2.4.0"` + JS `@tauri-apps/plugin-notification@2.4.0`（理由见 §1）；capabilities 加 `notification:default`。
6. **验收注意**：桌面通知行为验收用 release 构建（dev 模式 macOS 署名 Terminal、Windows 显示 powershell 图标，见 §5）。

## 出处

- **crates.io 源码包 tauri-plugin-notification 2.4.0**（本次下载核对，本地 /tmp/tauri-notif）：
  - `src/lib.rs`：`init()` 仅注册 `notify`/`request_permission`/`is_permission_granted` 3 命令 + init 脚本注入；
  - `src/commands.rs`：3 命令定义；
  - `src/desktop.rs`：`show()` 仅读 title/body/icon/sound → `notify_rust::Notification::show()`（async spawn，立即）；`request_permission`/`permission_state` 恒 Granted；macOS dev `set_application("com.apple.Terminal")`；Windows 仅安装版设 AUMID；
  - `src/models.rs`：`NotificationData.schedule/extra` 字段存在但桌面路径不消费；
  - `permissions/default.toml`：`notification:default` 权限集内容。
- **npm tarball @tauri-apps/plugin-notification 2.3.3 / 2.4.0 / 2.5.0**：`dist-js/index.d.ts` + `index.js`（send/permission 走 `window.Notification`；导出面；无 onNotificationClick）；2.4.0 package.json 依赖 `@tauri-apps/api ^2.11.0`。
- **plugins-workspace v2 分支**（github tauri-apps/plugins-workspace，`plugins/notification/`）：guest-js/index.ts（`Schedule` 注释「Scheduling is only implemented on mobile; the desktop implementation delivers the notification immediately and ignores the schedule」；`onNotificationReceived`/`onAction`「Only emitted on mobile」）；guest-js/init.ts（window.Notification 替换机制、Windows 权限短路）。
- **crates.io 源码包 notify-rust 4.11.0**：`src/macos.rs`（mac-notification-sys 后端，存在未被插件使用的 `schedule_notification(delivery_date)`）；`src/windows.rs`（`winrt_notification::Toast`，依赖 `tauri-winrt-notification`）；Cargo.toml（mac-notification-sys ^0.6、winrt-notification）。
- **crates.io 源码包 mac-notification-sys 0.6.0**：`objc/notify.m`（NSBundle hook 伪造 bundle ID、`LSCopyApplicationURLsForBundleIdentifier` 校验）；`tests/application.rs`（set_application 同 ID 二次调用报错）。
- **官方文档**：v2.tauri.app/plugin/notification（平台表：Windows "Only works for installed apps. Shows powershell name & icon in development"；默认权限集/权限表）；Apple UNUserNotificationCenter（scheduled 通知与点击激活行为）、WinRT toast activation。
- **GitHub issues**：tauri-apps/plugins-workspace#2143、tauri-apps/tauri#4965（macOS dev 通知不显示）。
- **本 app 现状文件**：`apps/desktop/package.json`（api 2.11.1 / cli 2.11.5）、`apps/desktop/src-tauri/Cargo.toml` + `Cargo.lock`（tauri 2.11.6）、`src/lib.rs`（Builder 链）、`tauri.conf.json`（identifier com.nextdo.desktop）、`capabilities/default.json`（现有权限）。

---

## 8. 附录（2026-10-01 补充）：`sendNotification` 的 JS 包装层是「静默失败」陷阱 —— 桌面改用直接 invoke

**现象**：release 包桌面提醒不弹、jsonl 无 `send` 记录、`sendNotification` 也不报错。

**根因（源码级，2.4.0）**：`@tauri-apps/plugin-notification` 的 JS `sendNotification` **不直接 invoke IPC**，而是 `new window.Notification(options.title, options)`。它依赖插件 **init 脚本**（crate `src/init-iife.js`，`init()` 注入）把 `window.Notification` 构造器**替换**成一个内部 fire-and-forget 调 `invoke('plugin:notification|notify', { options })` 的 IIFE。关键缺陷：

```js
// init-iife.js（压缩后还原）
window.Notification = function (title, options) {
  const o = Object.assign(options || {}, { title });
  (async (n) => {                       // ← 立即执行、不 return
    await window.__TAURI_INTERNALS__.invoke('plugin:notification|notify', { options: n });
  })(o);                                //   → 构造器同步返回 undefined
};
```

- `sendNotification` 是同步函数、返回 undefined；那个 `async IIFE` 的 Promise **从不被 return**，因此 `await sendNotification(...)` **永远 resolve、永不 reject** → 适配器「确认发送才 `rememberFired`」的重试契约是死代码：IPC 失败（权限被系统关闭、command 缺失等）被吞掉，提醒直接丢失、无日志、无重试。
- 若 init 脚本未注入（或 webview 里 `window.Notification` 为 undefined），`new window.Notification(...)` 抛**同步 TypeError** → 被 catch 记一条失败，但仍每 tick 重试到 grace 耗尽，始终弹不出。
- 权限侧同源：`isPermissionGranted()` 也先读 `window.Notification.permission`（init 脚本已置 granted），非 default 直接返回、否则才 invoke —— 桌面恒 granted，行为无害，保留用插件 JS 版即可。

**修复（已实现，见 design §4.2 / prd R3）**：适配器**绕过插件 JS 包装**，经 Tauri 注入的裸桥接 `window.__TAURI_INTERNALS__.invoke('plugin:notification|notify', { options: { title, body } })` 直调 Rust `notify` 命令（`src/commands.rs` 已确认该命令 + 参数形 `{ options: NotificationData }`；capabilities `notification:default` 含 `allow-notify`）。这是 init 脚本内部**调的同一个命令**，但拿到真实 Promise：成功 = 命令已受理 → 记 fired；失败 → 进 catch → grace 窗口内下 tick 重试 + jsonl 错误可见。裸桥接访问与 `packages/db` 的 stronghold 命令同款（不引入 `@tauri-apps/api` 依赖，不污染 native bundle —— metro 仍把整个 `@tauri-apps/plugin-notification` stub 掉）。

**对「桌面不响」排查的含义**：本修复保证 **JS→Rust** 一跳有真实错误反馈；若重建 release 后仍不弹，问题必在 **Rust→macOS** 一跳（notify-rust / UNUserNotificationCenter：系统设置里 com.nextdo.desktop 的通知开关、dev 签名身份漂移、DND/专注模式）—— 用 lib.rs 的 `NEXTDO_NOTIFY_PROBE=1` 自检通知 + `NEXTDO_NOTIFY_DEBUG=1` 的 jsonl 二分定位（probe 弹 = macOS 层 OK，问题在 JS；probe 不弹 = macOS 权限/归属问题）。
