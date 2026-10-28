# 实施计划

## Step 1 — 先让线上与 main 一致（R1）

- `server/app`：`pnpm deploy:worker`（wrangler 部署 `nextdo-server`，cron `* * * * *`）。
- 核验：`wrangler deployments list` 出现晚于 10-27 修复提交的新记录。

## Step 2 — 派发按时刻去重（R2/R3）

- `server/app/src/reminder-dispatcher.ts`
  - 模块头补充：claim 是「按行」的，看不到同一时刻的重复行，需组级判断。
  - `alreadyDelivered(pool, reminderId)` → `deliveredForMoment(pool, reminder)`：
    `reminder_deliveries d JOIN reminders r ON r.id = d.reminder_id WHERE d.status='sent'
    AND r.action_kind=$1 AND r.action_id=$2 AND r.fires_at=$3 LIMIT 1`。
  - 调用点改为传入整行 `reminder`。
- 不新增数据库约束（见 design.md D2）。

## Step 3 — 测试（R2/R4）

- `server/app/test/reminder-channels.test.ts`
  - `createFakePool` 的 `alreadyDelivered` 支持函数形式（按调用返回），以模拟「首条发送后才出现命中」。
  - 新增用例「sends one message when two rows describe the same moment」：两行同刻 → `due: 2`、
    `sent: 1`、`skipped: 1`，`INSERT INTO reminder_deliveries` 仅一次。

## Step 4 — 验证（R5/AC）

```bash
pnpm --filter @nextdo/server typecheck
cd server/app && pnpm test
pnpm deploy:worker
pnpm verify:web
```

- 证据沉淀在 `.verify/10-28-reminder-moment-dedupe/evidence.md`。

## 实施结果

| 项 | 结果 |
| :--- | :--- |
| 线上部署（Step 1） | `2026-10-28T03:42:56.700Z`，version `a05b2848-9a17-4b56-b51b-8b3f327848f3`（此前线上停留在 `2026-10-25T11:48:42.441Z`） |
| 去重改动部署（Step 2） | `2026-10-28T03:49:46.387Z`，version `76a462e5-5e24-4c4b-82f2-a7d823fef067`；收尾确认部署 `2026-10-28T04:18:02.351Z`，version `a300a6a4-3001-499a-a035-b37644f7ff40` |
| `/health` | `{"status":"ok"}`，HTTP 200 |
| `pnpm typecheck`（全部 workspace，含 `server/app`） | 通过 |
| `server/app` 全量 jest | 10 suites / 127 tests 通过，含新增「两行同刻只发一条」用例 |
| `pnpm verify:web --no-serve` | 全绿：lint → typecheck → test（93 suites / 1466 tests）→ build:web，`EXIT=0` |
| web 回归截图 | `.verify/10-28-reminder-moment-dedupe/` 下 01–02 两张，控制台零报错 |
