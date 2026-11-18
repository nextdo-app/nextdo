# 研究：expo-notifications（Expo SDK 57）

> 任务：09-30-reminder-notification-delivery · 研究日期 2026-09-30
> 结论均给出出处；「源码」指 expo/expo 仓库 `sdk-57` 分支（本地未装包，从 GitHub raw + npm registry 查证）。
> 产品约束（见 prd.md Decisions）：仅 deep-link 无按钮；每台设备各投一次；reconcile 按 reminder 行 ID。

## 0. 结论速览

1. **版本**：SDK 57 配套 `expo-notifications@57.0.21`（npm dist-tag `sdk-57` = `latest`，2026-09-24 发布）。装法 `npx expo install expo-notifications`。
2. **OS 层持久化**：iOS 与 Android 的 scheduled 本地通知都持久化在 OS 层，**app 被强杀后仍会到点响**。iOS 走 `UNUserNotificationCenter`；Android 走 `AlarmManager`（RTC_WAKEUP）+ SharedPreferences 存储，且有 BOOT_COMPLETED 接收器重启后补排程。
3. **列举/取消**：`getAllScheduledNotificationsAsync()`（⚠️ 旧名 `getScheduledNotificationsAsync` 已改名）返回 `NotificationRequest[]`，每项含 `identifier` + `content.data`（完整 payload）+ `trigger`——**可以拿到 pending 通知的 data payload**，支持按 reminder 行 ID 做 reconcile。取消按 identifier 字符串：`cancelScheduledNotificationAsync(id)` / `cancelAllScheduledNotificationsAsync()`。`scheduleNotificationAsync` 接受自定义 `identifier`（`NotificationRequestInput.identifier` 可选）——**直接把 reminder 行 ID 当通知 identifier 即可**。
4. **Android 渠道**：不必先建渠道（不指定 channelId 时自动落回 fallback 渠道 "Miscellaneous"），但强烈建议自建；Android 13 上至少先建一个渠道，系统通知权限弹窗才会出现。渠道**创建后 importance 不可改**（Android OS 限制，只能改 name/description）。
5. **权限**：`getPermissionsAsync()`/`requestPermissionsAsync()` 返回 `{ status: 'granted'|'denied'|'undetermined', granted, canAskAgain, expires, ios?: {status: IosAuthorizationStatus...} }`。识别「已拒绝」：Android 看根 `status === 'denied'`；**iOS 必须看 `ios.status === Notifications.IosAuthorizationStatus.DENIED`**（iOS 粒度更细：PROVISIONAL/EPHEMERAL 也算可用）。`canAskAgain === false` 时不要再弹，引导去系统设置。
6. **deep-link**：点击通知 → `addNotificationResponseReceivedListener` 收到 `response`，payload 在 `response.notification.request.content.data`。**terminated 冷启动**：JS 起来后在 root layout 用同步的 `getLastNotificationResponse()`（或 `getLastNotificationResponseAsync()`）拿到上次点击的 response，再 `router.push` 进 expo-router（官方文档有现成 expo-router 示例）。
7. **强度映射**：iOS 支持 per-notification 自定义声音（`content.sound = 'mySound.wav'`，文件必须列进 app.json 插件 `sounds` 数组；Apple 要求 WAV、≤30s）+ per-notification `interruptionLevel`（`'timeSensitive'` 可打破通知专注控制，适合 alarm 档）。**Android 8.0+ 声音只能渠道级**（per-notification sound 仅 API <26 生效）——做法是建 normal/important/alarm 三个渠道（不同 importance/sound/vibration），调度时用 `trigger.channelId` 选渠道。
8. **app.json 插件配置**：全部可选项，不加也能跑（本地通知用默认图标/声音）。`icon`/`color`/`defaultChannel` 仅 Android；`sounds` 两平台通用（本地路径数组，.wav 推荐）；`enableBackgroundRemoteNotifications` 仅 iOS（本任务不做 push，不需要）。

---

## 1. 版本号（SDK 57）

- npm registry `expo-notifications` dist-tags（2026-09-30 查证）：`sdk-57 → 57.0.21`，`latest → 57.0.21`，`sdk-56 → 56.0.26`，`sdk-55 → 55.0.27`。自 SDK 55 起包版本与 SDK 版本对齐（55.0.x/56.0.x/57.0.x），不再是旧的 0.3x 系列。
- `57.0.21` 依赖：`expo-constants ~57.0.19`、`expo-application ~57.0.3`、`@expo/image-utils ^0.11.5`、`badgin`；peer：`expo/react/react-native` 均为 `*`。与 app 现有 `expo 57.0.24` / `expo-secure-store 57.0.4` / `expo-router 57.0.22` 同代，无冲突。
- 注意：当前 `apps/mobile/package.json` **未安装** expo-notifications（本次研究前已 grep 确认），`app.json` 无 `plugins` 段。

## 2. 调度 API 与 OS 层持久化（关键问题）

### 2.1 API 形态

`scheduleNotificationAsync(request: NotificationRequestInput) → Promise<string>`（返回 notification identifier）。

```ts
NotificationRequestInput = {
  identifier?: string,              // 可自定义（reconcile 用 reminder 行 ID）
  content: NotificationContentInput, // title/body/data?/sound?/badge?/vibrate?(Android) ...
  trigger: NotificationTriggerInput  // null = 立即弹出
}
```

`SchedulableNotificationTriggerInput`（传 number/Date 即视为 DATE 触发）：
- `DateTriggerInput`：`{ type: 'date', date: Date|number, channelId? }` —— 一次性，到点触发（`repeats` 被忽略）；
- `TimeIntervalTriggerInput`：`{ type: 'timeInterval', seconds, repeats?, channelId? }`（iOS repeats 时 ≥60s）；
- 日历/重复类：iOS `CalendarTriggerInput`（UNCalendarNotificationTrigger 语义，含 weekday/weekdayOrdinal/weekOfYear/timezone…）；Android `daily/weekly/monthly/yearly`（hour/minute/weekday/day/month）。

提醒场景用 `DateTriggerInput`（`fires_at` → Date）即可。

### 2.2 OS 层持久化：app 被强杀后还响吗？——**iOS 响，Android 响**

**iOS**：源码 `ios/ExpoNotifications/Notifications/Scheduling/SchedulerModule.swift`（sdk-57）：调度 = 构造 `UNNotificationRequest(identifier:content:trigger:)`，trigger 为 `UNCalendarNotificationTrigger`/`UNTimeIntervalNotificationTrigger` 等原生 trigger，交给 `UNUserNotificationCenter`；取消 = `removePendingNotificationRequests(withIdentifiers:)` / `removeAllPendingNotificationRequests()`。pending 本地通知由 **OS 持久化**（与 app 进程生命周期无关，杀进程、甚至重启设备都不丢）——这是 Apple UserNotifications 的既定行为（Apple 文档：scheduled local notifications are delivered by the system, independent of app execution）。

**Android**：源码 `android/.../service/delegates/ExpoSchedulingDelegate.kt`（sdk-57）：

```kotlin
store.saveNotificationRequest(request)          // SharedPreferences 存储（进程外持久）
setupAlarm(nextTriggerDate.time, createNotificationTrigger(context, identifier))

private fun setupAlarm(triggerAtMillis: Long, operation: PendingIntent) {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()) {
    AlarmManagerCompat.setExactAndAllowWhileIdle(alarmManager, RTC_WAKEUP, triggerAtMillis, operation)
  } else {
    AlarmManagerCompat.setAndAllowWhileIdle(alarmManager, RTC_WAKEUP, triggerAtMillis, operation) // 非精确
  }
}
```

- 闹钟注册在 **AlarmManager（OS 服务）**，`PendingIntent` 指向 app 的 `NotificationsService` receiver——app 进程被杀不影响闹钟到点；到点后系统拉起 service 收 `NOTIFICATION_EVENT`，从 SharedPreferences 读回 request 再弹通知（`triggerNotification`）。
- 库自带 `AndroidManifest.xml`（sdk-57）自动合并：`RECEIVE_BOOT_COMPLETED` + `POST_NOTIFICATIONS`，且 receiver 监听 `BOOT_COMPLETED/REBOOT/QUICKBOOT_POWERON/MY_PACKAGE_REPLACED`；`setupScheduledNotifications()` 启动时遍历存储补排全部闹钟（重启后自愈）。
- ⚠️ **Android 12+ 精确闹钟**：`SCHEDULE_EXACT_ALARM` **不在**库 manifest 里，app 需自行在 AndroidManifest 加 `<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>`（官方 Permissions 章节明确写了）。不加的后果由上面源码可见：**静默降级为 inexact alarm**（`setAndAllowWhileIdle`），提醒时刻会漂移（Doze 合批，分钟级偏差）。对「到点响」的提醒功能这是必配项。实现方式：app.json 里加一个 config plugin 改 manifest（或 bare workflow 下直接改 AndroidManifest.xml）。
- 残余风险（两平台共有，属 OS 行为不是库缺陷）：Android 厂商 ROM 的后台省电策略可能延迟/杀 service（到点时拉不起 JS 无关，因为弹通知不依赖 JS 运行——service 是原生代码，直接发通知），一般仍会响；iOS 无此类问题（系统级投递）。

## 3. 列举 / 取消（reconcile 依据）

- `getAllScheduledNotificationsAsync() → Promise<NotificationRequest[]>`（SDK 57 文档名；旧 SDK 叫 `getScheduledNotificationsAsync`，升级代码时注意改名）。
  - `NotificationRequest = { identifier: string, content: NotificationContent, trigger: NotificationTrigger }`；`NotificationContent.data?: Record<string, unknown>` —— **pending 通知的 data payload 完整可读**（Android 源码 `getAllScheduledNotifications` 从 SharedPreferences 读完整 `NotificationRequest` 序列化回 JS；iOS 从 `UNUserNotificationCenter` pending requests 反序列化）。
  - 用途：app 启动/同步后，对比 `reminders` 表 `state='scheduled'` 行集 vs 本地 pending identifier 集——多的 `cancelScheduledNotificationAsync`，缺的补 `scheduleNotificationAsync`。
- `cancelScheduledNotificationAsync(identifier: string) → Promise<void>`：按 identifier 取消单个；不存在时静默 resolve（不 throw）。
- `cancelAllScheduledNotificationsAsync() → Promise<void>`：全清（reconcile 的兜底策略可用「全清+重排」，但会丢同一渠道下其他来源的通知，优先用按 ID 对齐）。
- 辅助：`getNextTriggerDateAsync(trigger) → number|null`（Unix ms；仅对 schedulable/calendar 类 trigger 有效，否则 reject——DATE 在 Android 侧属于 SchedulableNotificationTrigger，可用）。
- 注意：`getAllScheduledNotificationsAsync` 只列**本地 scheduled**，不含「已触发、还在通知中心」的（那个是 `getPresentedNotificationsAsync`，仅 Android/iOS 通知托盘内已展示的）。

## 4. Android 渠道

- 建/改渠道：`setNotificationChannelAsync(channelId, channel)`（旧名 `createNotificationChannelAsync`/`updateNotificationChannelAsync`，SDK 57 文档统一为 set 语义：「creating it if need be」）；`getNotificationChannel(sAsync)`、`deleteNotificationChannelAsync`。
- **是否必须先建渠道才能调度**：不是硬性要求——不指定 `channelId` 时 expo-notifications 自动创建 fallback 渠道 **"Miscellaneous"**（文档 Handling notification channels 节）。但建议自建命名渠道。
- **渠道 importance 能否改**：**不能**。文档原文：「After a channel has been created, you can modify only its name and description. This limitation is imposed by the Android OS.」→ 渠道参数要一次定对；要换 importance 只能删旧建新（用户已保存的渠道设置会丢）+ 重新调度。
- **Android 13+ 权限弹窗时序**（文档 Permissions/Android 节）：系统 POST_NOTIFICATIONS 弹窗**只在至少一个渠道存在后**才会出现；`setNotificationChannelAsync` 需在 `getDevicePushTokenAsync`/`getExpoPushTokenAsync` 之前调用。本任务只做本地通知（不取 push token），但权限申请流程仍应「先建渠道 → 再 requestPermissionsAsync」。
- `NotificationChannelInput` 可用字段：name/description/importance(AndroidImportance NONE..MAX)/vibration/vibrationPattern/lightSettings/sound(文件名，需放 res/raw 或经插件)/audioAttributes 等。

## 5. 权限

`getPermissionsAsync()` 与 `requestPermissionsAsync(permissions?)` 均返回 `NotificationPermissionsStatus`（extends `PermissionResponse`）：

```ts
{
  status: 'granted' | 'denied' | 'undetermined',
  granted: boolean,            // 便捷布尔
  canAskAgain: boolean,        // false = 用户已明确拒绝且不能再弹，应引导去系统设置
  expires: 'never' | Date | null,
  android?: { importance: number, interruptionFilter: number },
  ios?: {
    status: IosAuthorizationStatus,  // NOT_DETERMINED | DENIED | AUTHORIZED | PROVISIONAL | EPHEMERAL
    allowsAlert/allowsBadge/allowsSound/...: boolean | null,
    alertStyle/allowsPreviews/providesAppNotificationSettings: ...
  }
}
```

- **已拒绝识别**：Android → 根 `status === 'denied'`；iOS → `ios.status === Notifications.IosAuthorizationStatus.DENIED`（文档明确要求 iOS 用 `ios.status` 而非根 `status`）。`PROVISIONAL`（静默投递到通知中心）与 `EPHEMERAL` 视为「可用」，官方示例：`settings.granted || settings.ios?.status === PROVISIONAL`。
- `requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })`；Android 侧无额外选项（系统弹窗由 OS 触发）。
- iOS 无需 Info.plist usage description（文档 Permissions/iOS 节）。
- 本 app 的情境式申请时机（brainstorm Open Question 3）API 上无约束，任意时机可调；被拒后只能 `canAskAgain` 检查 + 引导设置。

## 6. deep-link（点击 → expo-router）

- payload 注入：`content.data: Record<string, unknown>`（「Data associated with the notification, not displayed」，两平台都支持，且**会随 pending 通知持久化**，见 §3）。
- 前台/后台点击：`addNotificationResponseReceivedListener(cb)`，`response: NotificationResponse = { actionIdentifier, notification, userText? }`；`actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER` 即普通点击（非按钮动作）。
- **terminated 冷启动**（app 被杀后点通知拉起）：
  - iOS：系统先拉起 app，JS 就绪后点击事件仍在——用 `getLastNotificationResponse()`（同步，或 `getLastNotificationResponseAsync()`）在 root layout 的 effect 里拿；
  - Android：点通知经 `NotificationForwarderActivity`（库 manifest 自带）拉起 app 后同样走 lastResponse 路径；
  - 处理完记得 `clearLastNotificationResponse()`（否则 app 正常热启动后可能重复路由）。
- **expo-router 官方示例**（SDK 57 文档 "Handle push notifications with navigation → Expo Router" 节，本地通知同样适用，读的是同一个 data）：

```tsx
// app/_layout.tsx
function useNotificationObserver() {
  useEffect(() => {
    function redirect(notification: Notifications.Notification) {
      const url = notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url);
    }
    const last = Notifications.getLastNotificationResponse(); // 冷启动（terminated）场景
    if (last?.notification) redirect(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener(r =>
      r.notification && redirect(r.notification));
    return () => sub.remove();
  }, []);
}
```

  对 Nextdo：`data` 里放 reminder 行 ID / 路由目标（如 `{ url: '/now', reminderId }`），点通知落 Now 屏（D2 决策），路由即 `router.push`。
- ⚠️ 前提：要收到「通知到点时」的 foreground 事件并决定展示，需 `setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) })`——**默认 handler 不设置时前台收到的通知不展示**（文档 setNotificationHandler 节）。
- 纯 web 平台（dev）：expo-notifications 在 web 是 no-op（本任务 D1 决策里纯 web 即 no-op，Tauri 走另一条路，见 tauri-plugin-notification.md）。

## 7. 强度映射（normal / important / alarm）

**iOS —— 支持 per-notification 声音与打断级别：**
- `content.sound`：`boolean | 'default' | 'defaultCritical' | 'defaultRingtone' | string(自定义文件名，含扩展名)`。自定义文件**必须**先列进 app.json 插件 `sounds` 数组（构建期拷进 bundle；iOS 侧运行时会校验 `customSoundExists()` 并打 error 日志——`SchedulerModule.swift` 源码）。
- 文件要求（Apple `UNNotificationSound` 文档 + Expo 文档）：**WAV 推荐**（.wav），**≤30 秒**，放 app bundle；静音模式/专注模式下不响（`defaultCritical` 需 critical alerts 特权，普通 app 拿不到，不用考虑）。
- `content.interruptionLevel`（iOS only）：`'active'`（默认弹横幅）/ `'timeSensitive'`（立即弹、点亮屏幕、可打破部分专注控制）/ `'passive'` / `'critical'`(需特权)。alarm 档可映射 `timeSensitive` + 自定义铃声。
- 建议映射：normal→默认声+active；important→自定义提示音（或默认声）+active；alarm→自定义铃声+timeSensitive。

**Android —— 8.0+（API 26+）声音/振动只能渠道级：**
- 文档 NotificationContentInput.sound 原文：「On Android version 8 and later, control the sounds via notification channels.」`content.sound` 的自定义文件名只在 API <26 生效（`setNotificationChannelAsync` 注里也给了 <8 设 notification、≥8 设 channel 的双写示例）。
- 因此三档强度 = **三个渠道**：
  - `reminders/normal`：importance LOW/DEFAULT、默认声、无振动；
  - `reminders/important`：importance HIGH、自定义音（res/raw 或插件 sounds 文件名）、短振动；
  - `reminders/alarm`：importance MAX、响铃音 + 长振动模式（vibrationPattern）；
  - 调度时 `trigger.channelId` 选渠道（`DateTriggerInput.channelId`）。
- 渠道 importance 创建后不可改（§4），三档参数一次定死。
- `content.vibrate: number[]`（per-notification 振动 pattern，Android only）同理在 8+ 被渠道设置覆盖——按渠道配。

## 8. app.json 插件配置（是否必需）

`expo-notifications` 是 config plugin（CNG/prebuild 生效），**所有配置项均可选**，不写 plugin 段本地通知也能用（默认图标/声音）：

| 项 | 默认 | 平台 | 说明 |
| --- | --- | --- | --- |
| `icon` | - | Android | 本地路径，96x96 全白透明 png（通知小图标） |
| `color` | `#ffffff` | Android | 通知小图标 tint |
| `defaultChannel` | - | Android | FCM 推送默认渠道（本任务不用 push，可省） |
| `sounds` | - | 双平台 | 本地声音文件路径数组（.wav 推荐），构建后可在 `content.sound`/渠道 sound 里按文件名引用 |
| `enableBackgroundRemoteNotifications` | `false` | iOS | Info.plist 加 `UIBackgroundModes: remote-notification`（headless 推送用，本任务不需要） |

对 Nextdo 的最小配置：若 alarm 档要自定义铃声（iOS per-notification 必需）→ 加 `sounds: ["./assets/sounds/alarm.wav", ...]`；Android 渠道声音走 `setNotificationChannelAsync` 的 sound 字段（文件同样需进 bundle——用 `sounds` 数组最稳）。`icon`/`color` 可选，想要品牌化通知图标再加。当前 `apps/mobile/app.json` 无 `plugins` 段，需新增。

---

## 对本任务设计的直接影响（实现备注）

1. **reconcile 主键**：`scheduleNotificationAsync({ identifier: <reminder 行 ID>, ... })` + `getAllScheduledNotificationsAsync()` 按 `identifier` 对齐——两条 API 都确认可行（§3）。`fires_at` 用 `DateTriggerInput`。
2. **必配项**：Android `SCHEDULE_EXACT_ALARM`（否则 12+ 上提醒时刻漂移，§2.2）；`setNotificationHandler` 前台展示配置（§6）；先建三渠道再申请权限（§4/§5）。
3. **deep-link payload**：`content.data = { url: '/now', reminderId: <id> }`；root layout 用 `getLastNotificationResponse()` + `addNotificationResponseReceivedListener`（§6 官方示例可直接套）。
4. **强度映射**：iOS per-notification sound+interruptionLevel；Android 三渠道（§7）。
5. 多设备（D3）：OS 层持久化 + 每台设备各自 reconcile 天然满足「每台各投一次」；reminders 行经 PowerSync 同步后各设备看到同一批 scheduled 行，各自调度互不冲突（identifier 同为行 ID 无害，作用域是设备本地）。
6. 版本锁定：`expo-notifications@57.0.21`（`npx expo install` 自动选 SDK 57 配套版）。

## 出处

- npm registry（2026-09-30 抓取）：`https://registry.npmjs.org/expo-notifications` dist-tags `sdk-57`/`latest` = 57.0.21；57.0.21 的 deps/peer。
- Expo SDK 57 文档：`https://docs.expo.dev/versions/latest/sdk/notifications/`（Reference v57.0.0；全文 117KB 已下载核对，含 scheduleNotificationAsync / getAllScheduledNotificationsAsync / cancel* / setNotificationChannelAsync / getPermissionsAsync / requestPermissionsAsync / NotificationContent(Input)/NotificationRequest/NotificationPermissionsStatus 类型表、Android 渠道与声音章节、expo-router 深链示例、app.json 插件配置表）。
- expo/expo 源码（`sdk-57` 分支，GitHub raw）：
  - `packages/expo-notifications/android/src/main/java/expo/modules/notifications/service/delegates/ExpoSchedulingDelegate.kt`（AlarmManager 精确/非精确、SharedPreferences 存储、boot 补排）
  - `packages/expo-notifications/android/src/main/AndroidManifest.xml`（RECEIVE_BOOT_COMPLETED/POST_NOTIFICATIONS 自动合并；无 SCHEDULE_EXACT_ALARM）
  - `packages/expo-notifications/android/.../notifications/scheduling/NotificationScheduler.kt`（JS 桥：trigger 解析、getAllScheduledNotificationsAsync 序列化）
  - `packages/expo-notifications/ios/ExpoNotifications/Notifications/Scheduling/SchedulerModule.swift`（UNNotificationRequest/UNCalendar & UNTimeInterval trigger、removePending*、customSoundExists 校验）
- Apple 文档：`UNNotificationSound`（自定义声音 ≤30s、WAV）、UserNotifications（scheduled local notification 由系统投递，独立于 app 运行）。
