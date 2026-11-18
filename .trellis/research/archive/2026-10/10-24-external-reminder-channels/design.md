# 外部提醒通道：技术设计

## 架构与边界

Nextdo 服务端（Cloudflare Worker）新增一个 Cron 调度入口，定期扫描 `reminders` 表中到点的提醒，按通道向外部 webhook 发送通知。客户端与同步 schema 的既有表不动。

组件：

1. **Cron Trigger** —— `server/app/src/wrangler.jsonc` 新增 `triggers.crons`，每分钟一次；
2. **`scheduled` handler** —— `server/app/src/worker.ts` 新增导出（现有 `fetch` 不变），调用调度用例；
3. **调度用例** —— 查询到点提醒 → 渲染消息 → 逐通道投递 → 记录结果；
4. **通道适配器** —— `feishu`（自定义机器人，可选签名）、`serverchan`（个人微信中转），纯函数 + 单测；
5. **投递去重** —— 新增表 `reminder_deliveries`（`reminder_id` + `channel` 唯一），保证同一提醒同一通道只投一次。

## 数据流

1. 客户端写入提醒（现有逻辑，`packages/db/src/queries/actions.ts` 的 snooze 事务）→ `reminders` 行 `state='scheduled'`；
2. Worker cron 触发 → 查询 `state='scheduled' AND fires_at <= now()`（带宽限窗口，如 5 分钟，避免因调度抖动漏投）；
3. 对每条提醒、每个已启用通道：若 `reminder_deliveries` 无记录 → 投递 → 写记录（成功/失败 + 错误码）；
4. 失败在下次 cron 重试，受最大重试次数约束。

## 契约

### 环境变量 / secret（`wrangler secret put`）

| 名称 | 含义 |
| --- | --- |
| `NEXTDO_FEISHU_WEBHOOK_URL` | 飞书自定义机器人完整 webhook URL（含 key） |
| `NEXTDO_FEISHU_SIGN_SECRET` | 可选；启用签名校验时必填 |
| `NEXTDO_SERVERCHAN_SENDKEY` | Server 酱 SendKey |
| `NEXTDO_EXTERNAL_CHANNELS` | 启用哪些通道，如 `feishu,serverchan` |

数据库连接沿用现有 Hyperdrive / 连接串配置。

### 新增表 `reminder_deliveries`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `reminder_id` | uuid | FK → `reminders.id` |
| `channel` | text | `feishu` / `serverchan` |
| `status` | text | `sent` / `failed` |
| `attempts` | int | 已尝试次数 |
| `last_error` | text, nullable | 最近一次错误（含平台错误码） |
| `sent_at` | timestamptz, nullable | 成功时间 |

唯一索引 `(reminder_id, channel)`。

### 消息内容

- 标题：行动标题；
- 正文：截止时间（本地时区渲染）+ 备注（经 `markdownToPlainText` 后截断）；
- 飞书：文本或飞书卡片；Server 酱：`title` + `desp`（Markdown）。

## 关键取舍

- **服务端调度而非客户端**：DDL 需要精确到点的 HTTP 请求，只有服务端能保证；代价是要求公网 Postgres + 部署 Worker，纯本地用户拿不到该通道。
- **服务端 secret 而非同步表**：密钥不进数据库，沿用 `NEXTDO_OWNER_TOKEN` 模式；代价是改配置要重新部署。
- **叠加而非互斥**：外部通道是额外保险；代价是可能重复打扰，以及 Server 酱免费版 5 条/天的容量约束。
- **轮询而非一次性定时**：Cron 每分钟扫描而非为每条提醒注册定时任务，实现简单且天然幂等；代价是分钟级精度。

## 兼容性与迁移

- 不动现有同步 schema 的既有表；新增表需要服务端侧迁移脚本；
- 现有 app / 日历通道代码路径不变；
- `server/deploy/worker.js` 是打包产物，部署前需重新构建。

## 风险与回滚

- Server 酱免费版 5 条/天：超出后投递失败，需在日志可见，启用时应提示用户；
- 飞书限流（100/分、5/秒）：个人用量远低于此，但需记录错误码；
- 回滚：移除 `triggers.crons` 即停止调度，`reminder_deliveries` 表可保留。
