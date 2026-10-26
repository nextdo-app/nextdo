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
