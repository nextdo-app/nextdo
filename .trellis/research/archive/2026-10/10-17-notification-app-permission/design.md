# 技术设计：#45 通知设置简化与统一请求

## 1. 结论先行

**删两处手动入口、补一条按需请求路径、重排设置卡片口径**；投递层与总开关语义不动。

| 动作 | 对象 |
| :--- | :--- |
| 删除 | 启动引导弹窗（`components/notification-optin-dialog.tsx` + 根布局挂载 + `optInPromptSeen`）、native 设置页「开启通知」按钮 |
| 保留 | 应用内总开关（语义不变）、`denied` 的「去系统设置」（iOS）/ 文案（Android）、web 的手势按钮（机制所限） |
| 新增 | 有效状态口径、习惯提醒创建路径的按需请求、设置卡片结构与文案重排 |

## 2. 删除面（逐文件）

1. `apps/mobile/components/notification-optin-dialog.tsx` —— 整文件删除。
2. `apps/mobile/app/_layout.tsx:58,445` —— 移除 `NotificationOptinNotifier` 的 import 与挂载。
3. `apps/mobile/lib/notification-settings.ts` —— `NotificationSettings` 去掉 `optInPromptSeen`（`parseNotificationSettings` 本就容忍多余键，老 blob 里的该字段被忽略，无需迁移）。
4. `apps/mobile/__tests__/notification-optin-dialog.test.tsx` —— 删除；`__tests__/reminder-delivery-tauri.test.ts:170,189` 的 memory store 去掉该字段。
5. `scripts/capture-verify-screenshots.mjs:73` —— 预置值改为 `{masterEnabled:true}`。

## 3. 设置卡片的新结构（`app/(tabs)/settings.tsx`）

自上而下三行，**有效状态永远先出现**：

1. **有效状态行**（由「应用内开关 ∧ 系统授权」推导，纯文案，不带开关）：
   | 应用开关 | 系统授权 | 文案 |
   | :--- | :--- | :--- |
   | ON | granted | 已开启 —— 稍后与日历提醒会按时通知。 |
   | ON | undetermined | 系统尚未授权 —— 首次需要提醒时，Nextdo 会请求通知权限。 |
   | ON | denied | 系统已拒绝 —— 提醒会照常记录，但不会按时送达。（+ iOS 去系统设置按钮 / Android 路径文案） |
   | OFF | granted | 已在应用内关闭 —— 已排入系统的提醒会被撤销。 |
   | OFF | 未授权 | 已在应用内关闭（系统同样未授权）。 |
   | — | web / tauri | 按平台既有分支改写，措辞与上表一致（web 手势按钮保留；tauri「跟随系统设置，应用关闭不提醒」保留）。 |
2. **应用内开关**：label 「应用内提醒」，副文案「应用内偏好，与系统权限相互独立；关掉后已排入系统的提醒会立即撤销。」默认 ON（#24 R4 不变）。
3. **平台动作**：iOS denied → 「去系统设置」；Android denied → 路径文案；web undetermined → 「开启浏览器通知」（唯一手势入口）；其余情况无动作。

## 4. 统一请求路径（应用主动）

- `lib/reminders/permission.ts` 的 `maybeRequestNotificationPermission()` 语义不变（native + `undetermined`，fire-and-forget）。
- 调用点核对并补齐（每处都是「刚刚真的排了通知」的时机）：
  1. `hooks/use-snooze-action.ts:43`（已有）；
  2. `components/clarify-wizard.tsx:345`（日历行动提交，已有）；
  3. **习惯提醒的创建/修改路径（新增）** —— 在 `hooks/use-habit-reminders`（具体文件以实施时核对为准）每次成功写入提醒偏好之后调用。
- 结果：native 上「第一次真的需要通知」时由应用弹系统框；用户拒绝后系统不会再弹，应用也不再请求。

## 5. Web 为什么保留按钮

浏览器强制要求用户手势；没有手势就没有任何自动路径。因此 web 的「开启浏览器通知」不是「多余的手动选项」，而是**该平台唯一的可行入口**；文案与 native 有效状态口径一致。

## 6. 验证

1. 单测（mobile）：删除弹窗测试；`settings-screen.test.tsx` 重写通知块断言 —— 各（开关 × 权限）组合的有效状态文案、native undetermined 无按钮、iOS denied 有「去系统设置」、web undetermined 有手势按钮、「已开启」不出现在未授权组合。
2. 单测：三个请求调用点的触发条件（native+undetermined 才调用；已被拒/已授权不调用）。
3. 存储：`parseNotificationSettings` 对含旧 `optInPromptSeen` 的 blob 兼容（读出不迁移、不报错）。
4. 浏览器实测：`.verify/notification-app-permission/`（web 的 undetermined 分支截图「未授权不显示为已开启」）。
5. 规范：`app/component-guidelines.md:207` 的弹窗契约改为「按需请求 + 有效状态口径」。

## 7. 决策点（复核时可否决）

- **A. 「手动选项」= 权限申请的手动入口**（启动弹窗 + native 按钮）；习惯提醒的两项配置保留。
- **B. web 保留按钮**（机制所限），native 全自动 —— 平台差异写进规范。
- **C. 有效状态行在前、开关在后**：开关仍拥有 #24 的语义，但不再单独承担「通知是否开着」的表述。
