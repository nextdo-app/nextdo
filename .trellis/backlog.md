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
3. **核心对象展示/管理入口：Waiting For 事项跟进**（10-08 用户明确裁决：References 属于外部知识库软件范畴，Nextdo 不做专屏；专注于 Waiting For）
   - **2026-11-19 改判**：资料库改为可选启用功能，用户可关闭或不启用；10-08 的「不做资料库」不再是当前规则。2026-11-20 已实现二级列表入口（issue #90，见 `.trellis/research/reference-library.md`）。
   - 现状：Clarify 流程能把事项落进 Waiting For，且底层已有表和数据（`waiting_for_items`），但前端缺乏日常查看、修改和跟进的统一管理页面。
   - 形态：独立二级页面（`app/waiting.tsx`）+ 收件箱入口导航，支持列表展示（等待对象、到期时间、状态）、快捷新建、更新与软删除（标记完成/清除）。
   - 依据：用户指令「references 不需要，这是知识库软件的功能，不属于本软件，可以写一个 waiting for」；Proposal MVP 核心对象列表。

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
11. 商店素材与版本细节：splash 屏（`app.json` 无 splash 配置）、EAS `submit` 配置为空、版本号不齐（mobile 0.1.2 / desktop 0.1.1 / 根 0.1.1）（09-30 新增）

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

## 备注

- 09-23 会话另观察到一次工作区改动（删除 `apps/mobile/expo-env.d.ts` + 精简 `apps/mobile/tsconfig.json` include）会破坏 typecheck（TS2882：`global.css` 模块声明经 `expo-env.d.ts` → `expo/types/global.d.ts` 引入），已还原。若后续有意移除 `expo-env.d.ts`，需先补本地 CSS 模块声明。
