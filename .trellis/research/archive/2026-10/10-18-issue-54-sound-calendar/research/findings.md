# Research findings: 提示音与系统日历（#54）

## 1. Expo SDK 57 原生能力

| 需求 | 选型 | 版本 | 结论 |
| --- | --- | --- | --- |
| 前台播放音效 | `expo-audio` | `~57.0.5` | 官方推荐的 `expo-av` 后继；`createAudioPlayer` + `setAudioModeAsync({ playsInSilentMode: true })` 支持静音键下播放 |
| 系统日历 | `expo-calendar` | `~57.0.5` | iOS / Android 均支持创建自定义日历、事件与 `alarms`（`relativeOffset` 分钟） |
| 映射持久化 | `expo-file-system/legacy` | 随 SDK | 原生端写 `documentDirectory/calendar-sync.json`；Web 用内存 Map（`Platform.OS === 'web'` 直接跳过） |

两者都是原生模块：**必须懒加载**（`require` 延迟到首次调用），否则 Web 构建与 jest 渲染会因缺少原生实现而崩溃。

## 2. 通知声音（OS 层）

`expo-notifications` 插件通过 `sounds` 引用打包资源；Android 8+ 频道不可变更，声音与优先级只能在首次创建频道时确定。因此：

- 音色只映射到三个打包文件（`gentle.wav` / `important.wav` / `alarm.wav`），由插件清单声明；
- 音量不进入应用设置（跟随系统音量），前台播放与 OS 通知的音量都由系统控制；音色点击即试听；
- 已有 `scripts/gen-notification-sounds.mjs` 生成 PCM WAV，新增 `gentle` 音色沿用同一脚本。

## 3. 对账策略（避免重复事件）

行动 → 日历事件的同步不是「每次全量重写」，而是：

1. 读取所有未完成、未删除且 `startsAt != null` 的 `calendar` 类行动；
2. 对每个行动计算签名 `title|startsAt|estMinutes`；
3. 与持久映射比较：无映射 → 创建；签名变化 → 更新；映射存在但行动消失/完成/开关关闭 → 删除；
4. 映射在事件成功写入后落盘，失败时保留旧映射等下次重试。

触发点：`calendar_actions` 表变化（PowerSync watch）+ AppState 回到前台。无定时轮询。

## 4. 平台降级结论

- Web：`expo-calendar` 不可用 → `supported === false`，设置页只展示说明；音效仍可播（HTMLAudioElement 路径由 `expo-audio` 处理）。
- 桌面（Tauri WebView）：无日历插件 → 同样降级说明；提醒走 tauri 通知插件，声音由 `@tauri-apps/plugin-notification` 或 in-app Audio。
- 未授权：设置页开关先请求权限，`denied` 时展示「去系统设置开启日历」并跳转 `Linking.openSettings()`。

## 5. 测试环境注意

- Jest 下 `.wav` 资源需 mock（`test/audio-mock.js`），否则 `expo-audio` 的 `require('*.wav')` 会抛错；
- `reconcile.ts` 保持纯函数（不 import 原生模块），单元测试直接覆盖创建/更新/删除/幂等四种路径。
