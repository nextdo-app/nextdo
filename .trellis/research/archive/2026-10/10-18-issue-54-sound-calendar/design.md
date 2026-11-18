# Design: 专注与提醒提示音、系统日历同步（#54）

## 1. 目标与边界

在移动端（Expo 原生）补齐两件事，桌面端 / Web 优雅降级：

1. **提示音**：专注计时归零、提醒触发时播放提示音；设置中可开关（提醒 / 专注分别控制）、选音色（3 种，点击即试听）；音量完全跟随系统。
2. **系统日历提醒**：把有明确起止时间的 `CalendarAction` 写入系统日历，由系统原生提醒；行动时间变化 / 删除时同步更新或删除；未授权时给出明确引导。

不在范围内：后台常驻闹钟、桌面端伪造日历集成（Tauri 无日历插件）、iOS 打包。

## 2. 现状与复用

已有的基础设施（本任务在其上扩展，不重造）：

- `lib/notification-settings.ts`：偏好存储（`nextdo.settings.notifications`）+ 默认值 + 迁移。
- `lib/reminder-scheduler.ts` + `lib/reminders/adapters/*`：提醒投递适配层（native / tauri / web 三态）。
- `lib/notification-sound.ts`：音色 → 打包 WAV 的唯一映射与播放入口。
- `hooks/use-reminder-delivery.ts`：根布局挂载一次的投递引擎。

## 3. 关键设计决策

### 3.1 提示音：前台 in-app 音效与 OS 通知声音分离

| 场景 | 由谁负责 |
| --- | --- |
| 专注计时归零 | 前台 in-app 音效 `playFocusCompletionSound()`（`app/focus/[id].tsx`，`timeUp` 上升沿，按 sessionId 去重） |
| 提醒触发（前台投递） | 投递适配层 `playReminderSound()`（tauri / native 各自在投递点调用） |
| 提醒触发（后台 / 后台通知） | OS 通知自带声音（打包 `gentle.wav` / `important.wav` / `alarm.wav`，`expo-notifications` 插件 `sounds` 声明） |

应用内不提供音量档位：前台播放保持 unity gain，音量完全跟随系统音量（系统静音键同样生效）；音色选择点击即试听。

### 3.2 偏好契约（`NotificationSettings` 扩展）

```ts
interface NotificationSettings {
  masterEnabled: boolean;
  focusSoundEnabled: boolean; // 默认 true
  reminderSoundEnabled: boolean; // 默认 true
  soundTone: 'gentle' | 'important' | 'alarm'; // 默认 gentle
  calendarEnabled: boolean; // 默认 false（需授权）
}
```

读取走 `useNotificationSettings()`（返回 `settings` + `update(patch)`），写入与既有总开关同一条存储路径。

### 3.3 系统日历同步：三态适配 + 幂等对账

- `lib/calendar-sync/device.ts`：`expo-calendar` 的唯一接触面，**懒加载**（`require` 延迟到首次使用），Web / 不支持平台上 `supported === false`，绝不顶层 import 原生模块。
- `lib/calendar-sync/store.ts`：行动 id → `{ eventId, signature }` 的持久映射（AsyncStorage）。
- `lib/calendar-sync/reconcile.ts`：**纯函数** `buildCalendarSyncPlan(actions, mappings, now)` → `{ toCreate, toUpdate, toDelete }`。签名由 `title|startsAt|estMinutes` 组成，签名不变则不重写事件（幂等）；行动软删除 / 完成 / 关闭日历开关 → 删除已写事件。
  - 事件：`title` = 行动标题，`startDate = startsAt`，`endDate = startsAt + max(estMinutes, 1)`，`alarms: [{ relativeOffset: 0 }]`（开始时提醒）。
- `hooks/use-calendar-sync.ts`：根布局挂载；监听 `calendar_actions` 变化 + AppState 回前台时对账；`calendarEnabled === false` 时直接把全部映射删掉。
- `hooks/use-calendar-permission.ts`：权限读取 / 请求 / 打开系统设置（`Linking.openSettings()`）。

### 3.4 未授权不静默失败

设置页「写入系统日历」开关在 `denied` 时展示说明 + 「去系统设置开启日历」按钮；开启开关先 `requestAccess()`，`granted` 才写入偏好。

## 4. 平台矩阵

| 能力 | iOS / Android | Web | 桌面（Tauri） |
| --- | --- | --- | --- |
| 前台提示音 | ✓ （`expo-audio`） | ✓ | ✓（`Audio` + tauri 通知声音） |
| OS 通知声音 | ✓ | —（无通知） | ✓ |
| 系统日历 | ✓ （`expo-calendar`） | 明确说明不支持 | 说明不支持（无插件） |

## 5. 风险与对策

- **原生模块进入 web bundle**：`device.ts` 懒加载 + `Platform.OS` 分支；`lib/notification-sound.ts` 内 `expo-audio` 同理。Web 构建与 jest 均不受影响（jest 侧 `.wav` 走 `test/audio-mock.js`）。
- **事件重复 / 孤儿事件**：以持久映射为准，只按签名差异更新；关闭开关 / 行动消失即清理映射与事件。
- **对账频率**：只在表变化与回前台触发，不轮询。
