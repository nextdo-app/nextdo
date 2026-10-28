# Journal - printsdfu (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-10-25

---



## Session 64: 外部提醒通道（飞书 / 个人微信）
<!-- trellis-session: v=2 fp=d59388d1c7eae9a5 -->

**Date**: 2026-10-25
**Task**: 外部提醒通道（飞书 / 个人微信）
**Branch**: `main`

### Summary

为有 DDL 的任务增加 IM 提醒投递通道：Cloudflare Workers Cron 每分钟扫描到点提醒，推送到飞书自定义机器人或个人微信（经 Server 酱 Turbo 中转），与 app / 日历通道叠加

### Main Changes

- 新增 `server/app/src/channels.ts`：飞书（含可选签名）与 Server 酱适配器，纯函数、凭证仅从环境变量读取
- 新增 `server/app/src/reminder-dispatcher.ts`：到期提醒扫描 → 先占位后投递的去重（`reminder_deliveries`）→ 重试上限与失败落库
- `worker.ts` 增加 `scheduled` handler，`wrangler.jsonc` 增加每分钟 `triggers.crons`，`schema-init.ts` 新增 `reminder_deliveries` 表
- 重新打包 `server/deploy/worker.js`（328.75 KiB），并在 `FREE_CLOUD_DEPLOY.md` 补充 secret 配置与开通步骤

### Git Commits

| Hash | Message |
|------|---------|
| `658ae40` | feat(reminder): 支持飞书与 Server 酱外部提醒通道 |
| `51fa56a` | chore(task): archive 10-24-external-reminder-channels |

### Testing

- [OK] [OK] server/app 单测 116/116，含一条走真实 fetch + loopback HTTP 服务器的端到端投递用例
- [OK] [OK] pnpm typecheck 与 pnpm lint 干净；pnpm verify:web 四道门通过（以 4180 端口 200 探针取证）
- [OK] [ ] 未完成：真实飞书 / 微信收消息验收，需用户凭证与一次 wrangler deploy

### Status

[OK] **Completed**

### Next Steps

- 在 Cloudflare 写入 NEXTDO_FEISHU_WEBHOOK / NEXTDO_SERVERCHAN_SENDKEY 并部署后，完成一次真实通道验收


## Session 65: 行动提醒时间支持多选
<!-- trellis-session: v=2 fp=1e67c6d8250e1da3 -->

**Date**: 2026-10-26
**Task**: 行动提醒时间支持多选
**Branch**: `main`

### Summary

把行动表单的「提醒时间」从单值改为可增删的多时刻列表，写入层按时刻集合对齐 reminders 表

### Main Changes

- core 新增 deadlineReminderSpecs：升序、分钟粒度去重、丢弃已过去时刻
- db 的 reconcileReminder 改为集合对齐，仍被选中的时刻保留原行 id，只取消被移除的、只插入新增的
- listScheduledReminderFor 改为返回全部时刻的 listScheduledRemindersFor
- snoozeAction 传单元素数组，推迟保持单点语义
- mobile 新增 reminder-times-field 组件并接入项目详情页与编辑弹窗

### Git Commits

| Hash | Message |
|------|---------|
| `c2be7f5` | feat(reminder): 行动提醒时间支持多选，按时刻集合对齐待发提醒 |

### Testing

- [OK] pnpm lint 通过
- [OK] pnpm typecheck 五包通过
- [OK] core 268 / db 333 / mobile 713 测试全绿

### Status

[OK] **Completed**

### Next Steps

- 未在真机验证多提醒的实际通知投递与日历事件生成
- 如需保留多选集合，推迟语义需产品确认


## Session 66: 多选提醒时间与 Google / iCloud 日历目标选择
<!-- trellis-session: v=2 fp=21a43f6b76fc4f05 -->

**Date**: 2026-10-26
**Task**: 多选提醒时间与 Google / iCloud 日历目标选择
**Branch**: `main`

### Summary

行动提醒时间改为可多选（core 的 deadlineReminderSpecs、db 的 reconcileReminder 集合对齐、新增 reminder-times-field 组件、编辑/添加表单接入），snooze 保持单点语义（重新选一个时间提醒即可，已在 PR 与 spec 中确认）。新增系统日历目标选择：device 层 listCalendars / findCalendar、store 增加设备本地的 preferredCalendarId、新增 use-calendar-target hook 与设置页「写入哪个日历」选择器；修复选择器被权限条件挡住导致入口不可见的问题，未授权时直接给「授权并读取日历列表」按钮。两个 PR 已合并（#72、#73），发布 0.1.9-beta.14 / .15 / .16。

### Git Commits

| Hash | Message |
|------|---------|
| `c2be7f5` | feat(reminder): 行动提醒时间支持多选，按时刻集合对齐待发提醒 |
| `a495f27` | fix(calendar): 日历选择器不再被权限挡住，未授权时直接给授权入口 |

### Status

[OK] **Completed**


## Session 67: 提醒只发一次 + 专注结束写入日历
<!-- trellis-session: v=2 fp=1a59f8c7631165d0 -->

**Date**: 2026-10-27
**Task**: 提醒只发一次 + 专注结束写入日历
**Branch**: `feat/single-reminder-and-focus-calendar`

### Summary

提醒收敛为单次投递；专注结束自动生成无闹铃的日历记录

### Main Changes

- 客户端「提醒方式」去掉「两者都发」，旧值归一为系统日历；同一分钟的行动事件与提醒事件只保留前者
- 服务端 Cron 按通道顺序择一发送，首个成功即停，并跳过已 sent 的提醒
- 新增 focus-event 计划器：每条已完成专注会话写入「正在完成【行动标题】」事件，无闹钟，受同样日历开关与 focusRecordSince 约束

### Git Commits

| Hash | Message |
|------|---------|
| `84c5275` | fix(reminder): 同一条提醒只送达一次 |
| `3b6b125` | feat(calendar): 专注结束自动写入日历记录 |

### Testing

- [OK] pnpm verify:web --no-serve 全绿（lint / typecheck / 126+268+333+732 测试 / build:web）
- [OK] cargo check（desktop）通过
- [OK] apps/mobile jest lib/calendar-sync 通过（含新增 focus-event 与 reminder-plan 用例）
- [OK] 浏览器实测 01-04 截图 + evidence.md 存于 .verify/10-27-single-reminder-and-focus-calendar/

### Status

[OK] **Completed**

### Next Steps

- 原生端手测：专注结束后日历出现无闹铃的「正在完成【…】」事件，关闭开关后事件被撤回


## Session 68: 提醒同一时刻重复推送：派发按任务+时刻去重
<!-- trellis-session: v=2 fp=7cbe49b496d52e1f -->

**Date**: 2026-10-28
**Task**: 提醒同一时刻重复推送：派发按任务+时刻去重
**Branch**: `main`

### Summary

线上 Worker 先补齐单次投递修复，再按（任务类型+任务 id+触发时刻）去重；交付门禁全绿并已生产部署

### Main Changes

- 派发去重由单行探针改为组级（deliveredForMoment）

### Git Commits

| Hash | Message |
|------|---------|
| `2f9c685` | fix(server): send one message per reminder moment |
| `e6b24d5` | chore(task): archive reminder-moment-dedupe |

### Testing

- [OK] pnpm verify:web --no-serve 全绿；server/app 10 suites / 127 tests

### Status

[OK] **Completed**

### Next Steps

- 观察下一次微信推送是否只到一条
