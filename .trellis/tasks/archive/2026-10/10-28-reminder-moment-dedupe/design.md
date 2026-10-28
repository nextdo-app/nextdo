# 技术设计

## 现象与证据

| 证据 | 结论 |
| :--- | :--- |
| 用户：微信（PushPlus）三条，内容完全相同、同一任务同一时刻 | 同一条提醒被派发三次 |
| `wrangler deployments list`：线上最新为 `2026-10-25T11:48:42Z` | 线上不含 10-27 的单次投递修复 |
| `wrangler secret list`：只有 `NEXTDO_PUSHPLUS_TOKEN`、`NEXTDO_SYNC_ENDPOINT` | 外部通道只有一个，三条不可能来自「多通道各发一次」 |
| `reminder_deliveries` 有 `UNIQUE (reminder_id, channel)`，派发先 claim 再 send | 单条 reminder 行不会重复发送 |

三条同刻相同消息、单通道、单行不可重复 ⇒ 存在三条 `reminders` 行，各自 claim、各自发送。

## 根因

`reminders` 表没有 `(action_kind, action_id, fires_at)` 唯一约束（`server/app/src/schema-init.ts`），
而 `reconcileReminder`（`packages/db/src/queries/actions.ts`）在**本地** SQLite 上按 action 查
`state='scheduled'` 的行再插入。多端各自在同步到位前执行 reconcile，就会各插入一行；PowerSync
按行合并，三行都落到服务端。派发的去重原先只问「这条 reminder 行是否已 sent」，看不到兄弟行。

## 决策

1. **服务端按时刻去重**：把每行 probe 换成 `deliveredForMoment`——JOIN `reminders`，按
   `(action_kind, action_id, fires_at)` 问「这个时刻是否已有 `sent` 投递」。串行循环保证同刻的
   第二行看到第一行的 `sent` 后跳过，不再 claim、不再 send；`alreadyDelivered` 的「同一行」
   语义被该查询包含。
2. **不加数据库唯一约束**：约束会让客户端上传的重复行在 Postgres 报错，PowerSync 会把它当成
   永久同步失败，代价远高于一次跳过。
3. **客户端保持现状**：`reconcileReminder` 已按 `fires_at` 保留一行、其余置 `cancelled`，下次
   编辑即自愈；本次不再扩大改动面。
4. **部署**：先把 main 的派发逻辑部署到生产（`pnpm deploy:worker`），再部署本次去重改动。

## 契约

- 一个 `(action_kind, action_id, fires_at)` 最多一条外部消息；「通道成功即 break、失败回退」不变。
- `deliveredForMoment` 为只读查询，不写入额外行；未发送的兄弟行每分钟被跳过，不产生流量之外的副作用。
- 去重范围是「时刻」而非「任务」：同一任务的不同提醒时刻照常各发一条。
