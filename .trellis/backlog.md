# Backlog — 下一任务候选池

> 用途：记录尚未排期的候选任务，供下次会话选任务时参考。
> 选定某项后直接进入实现；需要记录决策时用 mini-trellis remember。完成后从本文件移除（旧任务的 design 与调研已归档在 `.trellis/research/archive/`）。
> 本文件按当前推荐优先级排序；用户可随时重排。
> 09-30 会话按「上线前必须 / 上线前建议 / 长期候选」重排（对照 Proposal MVP 表逐项核查）。

## 当前推荐（P0 — 公开发布前必须关闭）

2. **iOS 分发**（09-30 新增）
   - 现状：`.github/workflows/release.yml` 覆盖桌面三平台 + Android 按 ABI 拆 APK（EAS）；iOS 被明确排除在流水线外（需 Apple 签名凭证）。主力机是 iPhone 的话这是发布阻断项。
   - 形态：EAS iOS 构建（App Store Connect / 至少 TestFlight），接入 release 流水线。
   - 依据：release.yml 注释「iOS is NOT part of this pipeline」；09-30 核查。
3. **Web/PWA 后台提醒：Web Push 订阅与发送（issue #93）**
   - 现状：Web/PWA 前台普通任务提醒已接通（#92）；`public/sw.js` 有 push 接收器，但没有 `pushManager.subscribe`、无 VAPID、服务端无 Web Push 发送。
   - 依据：GitHub issue #93。

## 上线前建议（P1）

5. **回收站（软删除的恢复 / 硬删入口）**（journal-1 session 10 Next Steps）
   - 现状：恢复入口已实现（`apps/mobile/app/trash.tsx`，设置 → 数据管理 → 回收站；`restoreTrashedItem` 在事务里清 `deleted_at`）。行动删除已加二次确认。父项目 / 父习惯仍删除时拒绝恢复子项并提示先恢复父项；并发恢复由事务守住。硬删（彻底删除）尚未实现。
6. **同步服务器产品定位（决策项）**（09-30 新增）
   - 现状：用户自行部署 Postgres + PowerSync 栈，在设置页填两地址 + token（09-28 任务拍板「用户自选」）。自用可行；公开发布门槛过高。
   - 需拍板：v1 同步定位 = 个人服务器模式 + 文档说明，还是官方公共同步服务器（后者此前定为 post-MVP）。
7. **外部日历双向同步与 CalDAV（issue #100 未完成部分）**（11-21 新增）
   - 现状：已交付系统日历只读导入 —— 定时忙碌事件作为引擎硬日程约束（`.trellis/research/external-calendar-import.md`）。
   - 缺口：CalDAV / Google Calendar / Apple Calendar 账号导入；把应用内日程写回外部日历；双向同步的冲突规则与用户确认流程。
   - 依据：issue #100「先做只读导入，再做双向」；README 路线图。
8. **通知动作的后台事务（issue #99 未完成部分）**（11-21 新增）
   - 现状：issue #99 的前台路径已交付 —— 三个按钮保持 `opensAppToForeground: true`，系统打开应用后执行 `completeAction` / `snoozeAction` / `skipAction`。应用被杀死或处于后台时不是纯后台执行。
   - 缺口：Android 可用 `expo-task-manager` + `Notifications.registerTaskAsync` 在通知动作的后台任务中执行事务，需新增原生依赖、在后台上下文初始化本地数据库，并用真实设备验证；iOS 终止态不支持通知动作的后台 JS 任务。
   - 依据：issue #99「操作在后台完成对应事务」；`.trellis/research/notification-inline-actions.md`「未完成」。

## 候选（长期）

9. Clarify 进阶字段（时间窗口、场景绑定）（原候选 #4）
10. CalendarAction 支持 projectId（journal-1 session 10 Next Steps）
11. 商店素材与版本细节：splash 已配置（`apps/mobile/app.json:8`）、三端版本号已对齐（0.1.9-beta.32）；剩下 EAS `submit.production` 仍为空（`apps/mobile/eas.json`）。
12. 跨平台全局快捷捕获（#102）：桌面端全局快捷键 + 捕获窗口；方案与默认快捷键待确认。
13. 自然语言捕获解析增强（#101 剩余）：重复规则、项目/标签识别。当前只解析日期/时间并做预览与 Clarify 预填（见 `.trellis/research/natural-language-capture.md`）。

## 09-30 清理的过时条目

- ~~Owner token 录入 UI~~（原 #1）：已由 09-28-oss-sync-options 交付 —— 设置页已有「后端地址 + 同步流地址 + token」三输入 + 连接/断开（`apps/mobile/app/(tabs)/settings.tsx`）。
- ~~图标资源（scaffold 为纯文字 tab bar）~~（原 #6）：已由 09-29-mobile-ui-optimization 交付（tab bar 矢量图标 R5）+ app 图标为真实设计稿（`apps/mobile/assets/icon.png`）。
- ~~Now 屏矮视口布局打磨~~（原 #7）：已由 09-29-mobile-ui-optimization 交付（NowScreen 改 ScrollView，R2）。

## 10-03 清理的过时条目

- ~~习惯创建表单（含 21 天挑战启动）~~（原 P1 #4）：已由 10-02-habit-create-challenge 交付 —— 独立路由 `apps/mobile/app/habits.tsx`（创建表单 + 第 N/21 天进度列表 + 删除），提交走 `startHabit` 原子事务，入口在设置页与 Now 屏习惯条（空态引导 / 非空「管理」）。

## 10-08 清理的过时条目

- ~~PR 级 CI 质量门~~（原候选 #9）：已由 10-08-ci-quality-gate 交付 —— 增加 `.github/workflows/ci.yml`，在 push 与 pull_request 到 main 时自动并行执行 lint、typecheck、test，并通过 Quality Gate 聚合兜底。

## 11-20 清理的过时条目

- ~~引擎上下文的 settings 表化（进同步面）~~（原候选 #8）：已由 issue #97 交付 —— 新增同步 `settings` 表；主题、专注时长与 Now 可用时间跨设备同步，通知 / 日历 / 更新设置保留本机（见 `.trellis/research/settings-sync.md`）。

## 11-21 清理的过时条目

- ~~提醒通知投递~~（原 P0 #1）：09-30-reminder-notification-delivery 已交付 expo-notifications 本地调度、三档强度、权限与点击路由；剩余的通知内联「完成 / 推迟 / 跳过」由 issue #99 交付（`.trellis/research/notification-inline-actions.md`）。

## 11-22 清理的过时条目

- ~~Waiting For 编辑与日期字段~~（#94）：已交付编辑标题 / 等待对象、预期日期与跟进时间，回顾读侧同步更新（见 `.trellis/research/waiting-for-fields.md`）。
- ~~资料库查看 / 编辑入口~~（#90）：已交付 `/references` 列表、编辑、搜索与可选启用开关（见 `.trellis/research/reference-library.md`）。
- ~~Web/PWA 前台提醒投递断链~~（#92）：已交付前台通知调度与失败可见提示；后台 Web Push 仍由 #93 跟踪（见 `.trellis/research/web-reminder-delivery.md`）。

## 备注

- 09-23 会话另观察到一次工作区改动（删除 `apps/mobile/expo-env.d.ts` + 精简 `apps/mobile/tsconfig.json` include）会破坏 typecheck（TS2882：`global.css` 模块声明经 `expo-env.d.ts` → `expo/types/global.d.ts` 引入），已还原。若后续有意移除 `expo-env.d.ts`，需先补本地 CSS 模块声明。
