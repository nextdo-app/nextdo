# #45 简化通知设置，由应用统一请求移动端通知权限

## Goal

https://github.com/nextdo-app/nextdo/issues/45 —— 移除不必要的手动通知选项，由应用在合适时机请求权限；拒绝后给说明与系统设置入口；未授权不显示为已开启

## Requirements

- **R1 移除启动期引导弹窗**：删除 `components/notification-optin-dialog.tsx`（含根布局挂载与 `optInPromptSeen` 偏好字段）——不再在启动时用「开启通知 / 暂不」打断用户。
- **R2 移除 native 设置页的手动申请按钮**：未授权分支只给状态说明（「首次需要提醒时，Nextdo 会请求系统权限」），不再要求用户手动点。
- **R3 应用统一请求（移动端）**：把「按需请求」做成唯一路径 —— 首次真正需要通知的业务动作触发 `maybeRequestNotificationPermission()`（现有：稍后成功、日历行动提交；**补齐**习惯提醒的创建/修改路径），仅 native + `undetermined`，fire-and-forget、被拒不阻塞业务。
- **R4 Web 例外（机制所限）**：浏览器要求用户手势，保留一个明确的「开启浏览器通知」入口；iOS Safari 的「添加到主屏幕」提示保留。
- **R5 有效状态口径**：设置卡片先陈述**有效状态**（应用内开关 ∧ 系统授权），系统未授权时不得显示为「已开启」；应用内总开关保留并标注「应用内偏好，与系统权限相互独立」。
- **R6 拒绝后的路径**：`denied` → 清晰说明 + 系统设置入口（iOS 按钮 / Android 文案引导），应用不再重复请求、不再自动弹窗。
- **R7 平台一致**：同一套文案骨架；按各平台权限机制决定「自动请求 vs 手势入口」的差异，并把差异写进规范。

## Non-goals

- 不改总开关语义（#24 R2/R4 保留：默认 ON、关闭即撤销已排通知）。
- 不改习惯提醒功能本身（`习惯打卡提醒` 开关 + `全天提醒时刻` 保留）。
- 不加 Android 通知设置深链（`expo-notifications` 57 无对应 API，沿用文案引导）。
- 不改投递层（reconcile / adapters / 排程）。

## Acceptance Criteria

- [ ] AC-1 启动不再出现授权引导弹窗；`optInPromptSeen` 及存储字段删除（含 `scripts/capture-verify-screenshots.mjs` 的预置值）。
- [ ] AC-2 native 设置页未授权分支无「开启通知」按钮，只有说明；granted / denied 分支文案清晰且不误导。
- [ ] AC-3 首次真正需要通知的业务动作（稍后 / 日历行动 / 习惯提醒）在 native + `undetermined` 时由应用发起系统请求（单测覆盖三个调用点）。
- [ ] AC-4 `denied` 时应用不重复请求；提供系统设置入口说明（iOS 按钮 / Android 文案）。
- [ ] AC-5 未授权时设置页不显示为「已开启」（有效状态口径：单测 + 截图双证据）。
- [ ] AC-6 web：唯一入口是手势按钮；文案与 native 骨架一致。
- [ ] AC-7 门禁全绿 + `.verify/notification-app-permission/` 截图与 `evidence.md` 覆盖 AC-1/2/5。

## Notes

- 「手动选项」的解读：本任务按**权限申请的手动入口**（启动弹窗 + native 按钮）执行；若你指的是习惯提醒那两项配置，说一声我再扩范围。
- 现状清单（文件/行号/调用点/平台机制）：`research/notification-permission-surface.md`。
