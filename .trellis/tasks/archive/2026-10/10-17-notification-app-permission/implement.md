# 执行计划：#45 通知设置简化与统一请求

> 复核门：本文件与 `prd.md` / `design.md` 经用户确认后才 `task.py start`，确认后再动代码。

## 步骤（按依赖顺序）

1. [ ] **删弹窗 + 存储字段**
   - 删 `components/notification-optin-dialog.tsx` 与 `_layout.tsx` 挂载；
   - `lib/notification-settings.ts` 去掉 `optInPromptSeen`；改 `scripts/capture-verify-screenshots.mjs`；
   - 删 `__tests__/notification-optin-dialog.test.tsx`；改 `reminder-delivery-tauri.test.ts`。
   - 门槛：`pnpm --filter @nextdo/mobile test notification`。
2. [ ] **设置卡片重排**：有效状态行（开关 × 权限矩阵）→ 应用内开关（改 label/副文案）→ 平台动作（iOS 去系统设置 / Android 文案 / web 手势按钮）；删除 native「开启通知」按钮。
   - 门槛：`settings-screen.test.tsx` 重写通知块断言通过。
3. [ ] **请求路径补齐**：核对 `maybeRequestNotificationPermission()` 的三个调用点（snooze / 日历行动 / 习惯提醒创建或修改），补单测。
4. [ ] **门禁 + 浏览器实测**：root 全量 `pnpm lint/typecheck/test`；`.verify/notification-app-permission/`（截图 + `evidence.md`，覆盖 AC-1/2/5）。
5. [ ] **规范更新（Phase 3.3）**：`app/component-guidelines.md` 的通知契约（弹窗 → 按需请求 + 有效状态口径 + web 手势例外）。
6. [ ] **Phase 3.4**：提交计划先发用户确认，然后进入 #46。

## 复核门（review gates）

- 有效状态矩阵的每一格都要有单测断言；「未授权 ≠ 已开启」是本次的硬验收。
- 三个请求调用点必须都有触发条件测试（native+undetermined 才请求；granted/denied 不请求）。
- 浏览器截图覆盖 web 的未授权分支（解释为什么 web 保留按钮）。

## 回滚点

- 三个动作彼此独立（删弹窗 / 重排卡片 / 补请求点），可单个 revert。
- 存储字段删除向后兼容（旧 blob 多余键被忽略）。
