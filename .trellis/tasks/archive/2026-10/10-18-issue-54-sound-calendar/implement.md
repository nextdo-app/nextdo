# Implementation Plan: 专注与提醒提示音、系统日历同步（#54）

## 1. 实施步骤

- [x] 1. 依赖：`apps/mobile/package.json` 增加 `expo-audio@~57.0.5`、`expo-calendar@~57.0.5`；`app.json` 声明 `expo-calendar` 插件（日历权限文案、`remindersPermission: false`）与新增音色 `gentle.wav`。
- [x] 2. 偏好：`lib/notification-settings.ts` 扩展 `focusSoundEnabled` / `reminderSoundEnabled` / `soundTone` / `calendarEnabled`（含默认值与旧数据迁移），并在 `hooks/use-notification-settings.ts` 暴露 `update(patch)`。
- [x] 3. 提示音：
  - `scripts/gen-notification-sounds.mjs` 生成 `gentle.wav`（与既有 `important.wav` / `alarm.wav` 同规格）；
  - `lib/notification-sound.ts`：音色 → 资源映射、懒加载 `expo-audio`、unity gain（音量完全跟随系统）、`playFocusCompletionSound()`；
  - `app/focus/[id].tsx`：`timeUp` 上升沿按 `sessionId` 去重播放；
  - `lib/reminders/adapters/{native,tauri}.ts`：提醒投递时按 `reminderSoundEnabled` 播放。
- [x] 4. 系统日历：
  - `lib/calendar-sync/device.ts`：`expo-calendar` 懒加载封装（权限 / 建「Nextdo」日历 / 增删改事件 / 闹钟）；
  - `lib/calendar-sync/store.ts`：行动 id → 事件映射持久化（原生文件 / web 内存）；
  - `lib/calendar-sync/reconcile.ts`：纯函数对账计划（创建 / 更新 / 删除，签名幂等）；
  - `hooks/use-calendar-permission.ts`、`hooks/use-calendar-sync.ts`：权限与根布局挂载的对账循环；
  - `app/_layout.tsx` 挂载。
- [x] 5. 设置页 `app/(tabs)/settings.tsx`：新增「声音与日历」区块（提醒音效 / 专注结束音效 / 音色三选（点击即试听）/ 无应用内音量（跟随系统）/ 写入系统日历 + 未授权引导 + Web/桌面降级说明）。
- [x] 6. 测试：
  - `lib/calendar-sync/reconcile.test.ts`（对账纯函数）、`lib/notification-settings.test.ts` 迁移用例；
  - `jest.config.js` 增加 `.wav` mock（`test/audio-mock.js`）；
  - 既有 44 个套件、640 个用例全绿。

## 2. 验证命令与结果

```bash
cd apps/mobile && npx tsc --noEmit        # ✅ 通过
cd apps/mobile && npx jest                # ✅ 44 suites / 640 tests passed
cd apps/mobile && npx jest settings-screen # ✅ 设置页全部用例通过（含新增校准 assertions）
```

## 3. 备注

- `expo-calendar` 为原生模块，Web / jest 下 `supported === false`，设置页显示降级说明，不渲染开关。
- 应用内不提供音量档位：播放保持 unity gain，音量完全跟随系统音量（系统静音键同样生效）；音色点击即试听。
- `pnpm-lock.yaml` 由 `pnpm install` 同步更新（新增 `expo-audio` / `expo-calendar` 快照，清理旧 React 19.3 快照）。
