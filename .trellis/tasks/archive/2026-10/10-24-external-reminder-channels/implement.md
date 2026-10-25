# 外部提醒通道：执行计划

## 前置

- [ ] 服务端已按 `FREE_CLOUD_DEPLOY.md` 部署到 Cloudflare，且 Worker 能访问 Postgres；
- [ ] 飞书建群 + 自定义机器人，取得 webhook URL（可选签名 secret）；
- [ ] 注册 Server 酱，取得 SendKey。

## 实施步骤

1. [x] 迁移：新增 `reminder_deliveries` 表（唯一迁移脚本 `server/app/src/schema-init.ts`，由 Worker 首次请求时幂等建表）；
2. [x] 通道适配器：`feishu`（含可选签名）、`serverchan`，纯函数 + 单测（`server/app/src/channels.ts`）；
3. [x] 调度用例：查询到点提醒 → 渲染消息 → 投递 → 记录（含重试上限）（`server/app/src/reminder-dispatcher.ts`）；
4. [x] Worker 接入：`wrangler.jsonc` 加 `triggers.crons`，`worker.ts` 加 `scheduled` handler 与 secret 读取；
5. [x] 观测：投递失败写入 `last_error` 并输出结构化日志（`observability` 已开启）；
6. [x] 文档：`FREE_CLOUD_DEPLOY.md` 补充 secret 配置与飞书 / Server 酱开通步骤。

> 与计划的一处偏差：步骤 1 原写「`packages/db` schema」，实际只动了服务端建表。原因是这张表是**投递去重状态**、纯服务端所有物，客户端永不读写它：`sync-config.yaml` 是逐表显式 SELECT 的规则集，没有 `reminder_deliveries` 条目，因此它虽在 `CREATE PUBLICATION powersync FOR ALL TABLES` 的广播范围内，也不会下发给任何客户端。放进 `packages/db/src/schema.ts` 只会让客户端多背一张空表。`packages/db` 未改动。

## 验证

- [x] 单元测试：签名计算、消息渲染、去重逻辑（`server/app/test/reminder-channels.test.ts`，含一条走真实 `fetch` + loopback HTTP 服务器的端到端投递用例）；
- [x] `pnpm verify:web` 门禁通过；
- [ ] 实测：构造一条 1 分钟后到点的提醒，观察飞书群与微信收到消息；重复触发 cron 不产生重复投递 —— **待用户在真实凭证与已部署 Worker 上执行**；
- [x] 证据存于 `.verify/10-24-external-reminder-channels/evidence.md`（无截图：本次改动不含客户端界面，说明见该文件第 2 节）。

## 风险文件与回滚点

- `server/app/src/worker.ts`（新增 `scheduled`，不改 `fetch`）；
- `server/app/src/wrangler.jsonc`（新增 `triggers`）；
- `server/deploy/worker.js`（重新构建产物）；
- `packages/db/src/schema.ts` —— 最终**未改动**（理由见上方偏差说明）。

## 启动前检查

- [x] `python3 ./.trellis/scripts/task.py validate 10-24-external-reminder-channels`；
- [ ] `implement.jsonl` / `check.jsonl` 填入真实 spec 条目。
