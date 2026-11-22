# Backlog — 下一任务候选池

> 用途：记录尚未排期的候选任务，供下次会话选任务时参考。
> 选定某项后直接进入实现；需要记录决策时用 mini-trellis remember。完成后从本文件移除（旧任务的 design 与调研已归档在 `.trellis/research/archive/`）。
> 本文件按当前推荐优先级排序；用户可随时重排。
> 09-30 会话按「上线前必须 / 上线前建议 / 长期候选」重排（对照 Proposal MVP 表逐项核查）。

## 当前推荐（P0 — 公开发布前必须关闭）

1. **提醒通知内联操作**（#99；原生/桌面投递已交付，Web/PWA 链路仍未接通）
   - 现状：`expo-notifications` 已接入，原生/桌面提醒调度与权限申请已实现；通知里还不能直接「完成 / 推迟 / 跳过」。Web/PWA 前台投递断链（#92）与后台 Web Push（#93）尚未实现。
   - 形态：通知 action 映射到现有 snooze/complete/skip 事务（Proposal §8），并补通知回调在前后台的测试；Web/PWA 侧按 #92、#93 另行处理。
   - 依据：GitHub issue #99；Proposal MVP 表 Reminder 与 Snooze 均为「必须」。
2. **iOS 分发**（09-30 新增）
   - 现状：`.github/workflows/release.yml` 覆盖桌面三平台 + Android 按 ABI 拆 APK（EAS）；iOS 被明确排除在流水线外（需 Apple 签名凭证）。主力机是 iPhone 的话这是发布阻断项。
   - 形态：EAS iOS 构建（App Store Connect / 至少 TestFlight），接入 release 流水线。
   - 依据：release.yml 注释「iOS is NOT part of this pipeline」；09-30 核查。
3. **Waiting For：编辑与日期字段**（#94；列表与快捷新建已存在）
   - 现状：`apps/mobile/app/waiting.tsx` 已有列表、快捷新建、完成与删除；缺少编辑标题/等待对象、更新预期日期与跟进时间。
   - 形态：行内编辑或详情页，复用 `updateWaitingForItem`（若 db 尚未暴露则补），保留软删除与回顾读侧。
   - 依据：GitHub issue #94。

## 上线前建议（P1）

5. **回收站（软删除的恢复 / 硬删入口）**（journal-1 session 10 Next Steps）
   - 行动 / 项目删除均为软删除，无恢复入口，误删不可找回。
6. **同步服务器产品定位（决策项）**（09-30 新增）
   - 现状：用户自行部署 Postgres + PowerSync 栈，在设置页填两地址 + token（09-28 任务拍板「用户自选」）。自用可行；公开发布门槛过高。
   - 需拍板：v1 同步定位 = 个人服务器模式 + 文档说明，还是官方公共同步服务器（后者此前定为 post-MVP）。

## 候选（长期）

7. Clarify 进阶字段（时间窗口、场景绑定）（原候选 #4）
8. 引擎上下文的 settings 表化（进同步面）（原候选 #5）
9. CalendarAction 支持 projectId（journal-1 session 10 Next Steps）
10. 商店素材与版本细节：splash 已配置（`apps/mobile/app.json:8`）、三端版本号已对齐（0.1.9-beta.32）；剩下 EAS `submit.production` 仍为空（`apps/mobile/eas.json`）。
11. 跨平台全局快捷捕获（#102）：桌面端全局快捷键 + 捕获窗口；方案与默认快捷键待确认。
12. Web Push 后台提醒链路（#93）与 Web/PWA 前台提醒投递断链（#92）：README 已承诺后台提醒。
13. 资料库入口（#90）：只有写入，没有查看/编辑/搜索入口；是否启用由用户决定（见 `.trellis/research/reference-library.md`）。

## 09-30 清理的过时条目

- ~~Owner token 录入 UI~~（原 #1）：已由 09-28-oss-sync-options 交付 —— 设置页已有「后端地址 + 同步流地址 + token」三输入 + 连接/断开（`apps/mobile/app/(tabs)/settings.tsx`）。
- ~~图标资源（scaffold 为纯文字 tab bar）~~（原 #6）：已由 09-29-mobile-ui-optimization 交付（tab bar 矢量图标 R5）+ app 图标为真实设计稿（`apps/mobile/assets/icon.png`）。
- ~~Now 屏矮视口布局打磨~~（原 #7）：已由 09-29-mobile-ui-optimization 交付（NowScreen 改 ScrollView，R2）。

## 10-03 清理的过时条目

- ~~习惯创建表单（含 21 天挑战启动）~~（原 P1 #4）：已由 10-02-habit-create-challenge 交付 —— 独立路由 `apps/mobile/app/habits.tsx`（创建表单 + 第 N/21 天进度列表 + 删除），提交走 `startHabit` 原子事务，入口在设置页与 Now 屏习惯条（空态引导 / 非空「管理」）。

## 10-08 清理的过时条目

- ~~PR 级 CI 质量门~~（原候选 #9）：已由 10-08-ci-quality-gate 交付 —— 增加 `.github/workflows/ci.yml`，在 push 与 pull_request 到 main 时自动并行执行 lint、typecheck、test，并通过 Quality Gate 聚合兜底。

## 备注

- 09-23 会话另观察到一次工作区改动（删除 `apps/mobile/expo-env.d.ts` + 精简 `apps/mobile/tsconfig.json` include）会破坏 typecheck（TS2882：`global.css` 模块声明经 `expo-env.d.ts` → `expo/types/global.d.ts` 引入），已还原。若后续有意移除 `expo-env.d.ts`，需先补本地 CSS 模块声明。
