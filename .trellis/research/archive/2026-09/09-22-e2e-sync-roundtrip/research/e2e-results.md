# E2E sync round-trip — 真实运行结果

**最终状态：7/7 PASS，总耗时 14s，exit 0。** 真实链路（客户端 ↔ server/app ↔ Postgres ↔
PowerSync Service ↔ 客户端）全部打通，读路径 / 写路径 / 跨客户端 / append-only 2xx 协议均验证通过。
产品代码（packages/*、server/app）未发现 bug；发现并修复 3 个 scaffold 配置 bug + 2 个 E2E 工具自身 bug（见 §5）。

- 运行时间：2026-09-22 16:24 (UTC+8)，run id `e2e-20260922082401-374002`
- 环境：macOS (darwin/arm64, OrbStack docker 29.4.0)、Node 26.8.2、pnpm 12.5.1
- 镜像：postgres:16-alpine、journeyapps/powersync-service:1.26.1（首次运行已 pull）

## 1. 复跑命令（未来开发者直接执行）

```sh
node e2e/sync-roundtrip.ts        # 单命令：bootstrap → 7 步断言 → cleanup；任一步失败 exit 非零
node e2e/sync-roundtrip.ts down   # 仅停 docker 栈
```

前置：Docker daemon 运行中（端口 5432/8080 空闲或已被本栈占用）、Node ≥ 23.6（type stripping）。
无需 `npm install`：runner 直接 import `packages/db` / `packages/core` 源码
（`e2e/hooks/resolve-ts.mjs` 解析无扩展名 TS import），`@powersync/node` SDK 经
`packages/db` 现有 node_modules 解析（无新增依赖）。

## 2. 最终 green run 完整输出（verbatim，run id e2e-20260922082401-374002）

```
== E2E sync round-trip (e2e-20260922082401-374002) ==
   repo:      /Users/printsdf/Research/projects/Nextdo
   work dir:  /var/folders/.../T/nextdo-e2e-e2e-20260922082401-374002-uPALOP
[STEP 1/7] bootstrap (docker stack + server/app) ... PASS (9.6s)
    docker stack: postgres healthy, powersync service running (journeyapps/powersync-service:1.26.1)
    secrets: fresh base64url JWT_SECRET + random NEXTDO_OWNER_TOKEN written to server/powersync/.env and server/app/.env (gitignored)
    server/app: built via pnpm --filter @nextdo/server build, running on :8787 against real Postgres (log: server-app.log in work dir)
[STEP 2/7] auth negatives: /credentials + /upload × (missing, wrong) token ... PASS (0.0s)
    GET /credentials, no token -> 401
    GET /credentials, wrong token -> 401
    POST /upload, no token -> 401
    POST /upload, wrong token -> 401
[STEP 3/7] JWT accepted: client A connects + subscribes stream "all" ... PASS (0.2s)
    GET /credentials with owner token -> 200 {token} (the connector's fetchCredentials)
    client A: connect() ok, status "connected" — the PowerSync Service accepted the minted 15-min JWT (kid nextdo-dev, aud nextdo)
    client A: subscribed to stream "all"
    client A status: {"connected":true,"connecting":false,"hasSynced":false,"lastSyncedAt":null,"downloading":true,"uploading":false}
[STEP 4/7] read path: row seeded directly in Postgres reaches client A ... PASS (0.6s)
    Postgres: INSERT next_actions id=RZDZ43E7VE5BYGSAR7ZRQTR2YQ title="E2E seeded e2e-20260922082401-374002"
    client A local kysely query sees it: title/status/est_minutes/value all match (Postgres -> PowerSync Service -> client A local SQLite)
[STEP 5/7] write path: local INSERT -> /upload -> Postgres (+ append-only PATCH 2xx) ... PASS (3.1s)
    client A local INSERT next_actions id=S1SZ43E8E8N8XBKYENH9M7JK2Q -> SDK ps_crud queue -> uploadData -> POST /upload -> Postgres (title/status/est_minutes/value/category all match)
    append-only: local PUT review_records id=S1SZ43E8E8DFXCVXBYKVZRDF47 landed in Postgres; local PATCH was rejected at the endpoint but answered 2xx (queue drained) and the Postgres snapshot is unchanged
[STEP 6/7] cross-client: fresh client B sees the step 4 + 5 rows ... PASS (0.6s)
    client B (fresh DB file .../nextdo-b.db, same owner token) connected + subscribed
    client B local: both next_actions rows present — seeded (RZDZ43E7VE5BYGSAR7ZRQTR2YQ) and uploaded (S1SZ43E8E8N8XBKYENH9M7JK2Q)
    client B local: review_records row also present (append-only PUT replicated)
[STEP 7/7] cleanup (clients disconnected, server/app stopped) ... PASS (0.0s)
    client A + B closed; server/app process stopped (port :8787 free again)
    docker stack LEFT RUNNING (postgres :5432, powersync :8080) — tear down with: node e2e/sync-roundtrip.ts down
    work dir removed: /var/folders/.../T/nextdo-e2e-e2e-20260922082401-374002-uPALOP
    server/app log tail:
[nextdo-server] listening on :8787

================ E2E SUMMARY ================
  PASS  [1/7] bootstrap (docker stack + server/app) (9.6s)
  PASS  [2/7] auth negatives: /credentials + /upload × (missing, wrong) token (0.0s)
  PASS  [3/7] JWT accepted: client A connects + subscribes stream "all" (0.2s)
  PASS  [4/7] read path: row seeded directly in Postgres reaches client A (0.6s)
  PASS  [5/7] write path: local INSERT -> /upload -> Postgres (+ append-only PATCH 2xx) (3.1s)
  PASS  [6/7] cross-client: fresh client B sees the step 4 + 5 rows (0.6s)
  PASS  [7/7] cleanup (clients disconnected, server/app stopped) (0.0s)

  7/7 steps passed; total 14s
===========================================
EXIT_CODE=0
```

AC 映射：AC1=step1，AC2=step3，AC3=step2，AC4=step4，AC5=step5（含 append-only 2xx），
AC6=step6，AC7=本次即第 5 次幂等重跑（唯一行 id，旧 Postgres 卷残留不影响），AC8=见 §5，
AC9=见 §6。

## 3. 运行史（失败 → 根因 → 修复）

| # | run id / 时间 (UTC) | 结果 | 根因 |
|---|---|---|---|
| 1 | 07:23 | step 1 FAIL（等 service ready 超时 120s） | powersync 容器 exit(150) 循环：compose 未设 `POWERSYNC_CONFIG_PATH`，服务找不到配置直接退出（bug B1）；同因 `wal_level=replica` 阻塞 WAL 复制（bug B2） |
| 2 | e2e-20260922072925-89ca31, 07:29 | steps 1–3 PASS，step 4 FAIL：`PSYNC_S2302 "No sync config available"`（/sync/stream 500） | 服务在缺少 `POWERSYNC_CONFIG_PATH` 的状态下“运行中”，sync config 未加载（bug B1 的表象）。修复 B1/B2 并重建容器后，`sync-config.yaml` **原样**即可被 1.26.1 正确解析（edition 3 的 `queries` 用纯 SQL 字符串是对的，无需改为对象） |
| 3 | e2e-20260922074758-a1308b, 07:47（孤儿运行，无输出捕获） | steps 1–6 按服务端日志成立（07:56 同步流正常推进、write checkpoint 逐次 ack），进程随后以 exit 13 退出 | teardown 中 `awaitWithTimeout` 的 unref 定时器 bug（bug B5）；该 run 的 `docker compose up -d` 同时使 postgres（07:54:19，拾取 B3 的 init DDL）与 powersync（07:55:59，最终版 compose）生效 |
| 4 | e2e-20260922082018-cc869e, 08:20 | steps 1–6 PASS（含修复后的 `crudQueueDepth`），step 7 挂起，`Detected unsettled top-level await`，exit 13 | bug B5（unref 定时器）复现确认 |
| 5 | e2e-20260922082401-374002, 08:24 | **7/7 PASS，exit 0**（§2） | B5 修复后一次通过 |

另：bug B4（`crudQueueDepth` 查不存在的 `ps_crud.table_name` 列）在 run 2 时尚未触发
（step 4 先失败），在 run 4 的 step 5 首次执行到该查询——修复后 step 5 的
“queue drained”断言一次通过。

## 4. 环境 / 生命周期说明

- **docker 栈运行中保留**（脚本成功时的既定行为）：`nextdo-powersync-postgres-1`
  (healthy)、`nextdo-powersync-powersync-1`。停栈：`node e2e/sync-roundtrip.ts down`。
- `server/app` 由脚本 step 1 启动、step 7 停止（:8787 已释放，已验证）。
- `server/powersync/.env` 与 `server/app/.env` 每次运行重新生成（fresh JWT_SECRET +
  NEXTDO_OWNER_TOKEN），均被 `.gitignore:19 (.env)` 覆盖（`git check-ignore` 验证）。
- 客户端库文件 / server 日志在 `os.tmpdir()/nextdo-e2e-*` 每 run 独立目录，成功时由
  cleanup 删除（本次已删；历史失败 run 的残留目录已手工清理）。
- Postgres 卷中有历次 run 的种子/上传测试行（唯一 ULID id，互不冲突；AC7 设计即为
  “重复跑前清库或换唯一行 id”，本脚本选后者）。
- 已验证的 live 状态：`wal_level=logical`、publication `powersync` 存在、服务日志
  checkpoint 正常推进、write checkpoint 逐次 ack。

## 5. 发现的 bug + 修复（全部已修复并复跑确认）

### Scaffold 配置 bug（server/powersync/，scaffold 任务只跑 `docker compose config`
### 静态校验、从不真正启动服务，故未暴露）

- **B1 — docker-compose.yml 缺 `POWERSYNC_CONFIG_PATH`**：镜像 entry 找不到配置，
  服务 exit(150)；即使“运行中”也会因 sync config 未加载导致所有 /sync/stream
  返回 `PSYNC_S2302 "No sync config available"`。
  修复：`server/powersync/docker-compose.yml` powersync 服务增加
  `POWERSYNC_CONFIG_PATH: /config/service.yaml` 及注释（说明 `sync_config.path` 相对
  配置文件目录解析、勿加 working_dir）。
- **B2 — postgres 默认 `wal_level=replica`**：PowerSync 的 WAL 逻辑复制要求
  `logical`，否则启动即报 “wal_level must be set to 'logical'”。
  修复：compose postgres 服务增加 `command: ['postgres', '-c', 'wal_level=logical']`
  （postmaster 参数，-c 对既有卷亦生效，无需重建数据卷）。
- **B3 — init DDL 缺 `CREATE PUBLICATION powersync FOR ALL TABLES;`**：逻辑复制依赖
  名为 `powersync` 的 publication，缺失时每次复制尝试报 `PSYNC_S1141 "Publication
  'powersync' does not exist"`。
  修复：`server/powersync/init/02-nextdo-schema.sql` 末尾追加该语句（FOR ALL TABLES
  覆盖 14 张表及 v1 后续加表；官方 self-host-demo 同样在 init 脚本创建）。
  注意：init 脚本仅在容器**创建**时执行——既有 postgres 容器需 recreate 或手工执行。

回归测试：以上均为 Docker/Postgres 层配置，单测无法覆盖（scaffold 单测本就全 mock
pg）；**本 E2E 套件即其回归测试**——B1/B2/B3 任一回归都会在 step 1–4 失败。

### E2E 工具自身 bug（e2e/，非产品代码）

- **B4 — `crudQueueDepth` 查了不存在的列**：PowerSync v2 的 `ps_crud` 只有
  `id, data, tx_id` 三列，操作（含目标表名）序列化在 `data` JSON 里，表名在 `$.type`
  （`{"op":"PUT","id":"...","type":"next_actions","data":{...}}`；在安装的
  @powersync/web dist 与真实入队行双重确认）。原 SQL `WHERE table_name = ...` 会
  直接 “no such column”。
  修复：`e2e/run.ts` 改为 `WHERE json_extract(data, '$.type') = '<table>'`；
  以一次性探针验证（入队 1×PUT next_actions + 1×PUT/1×PATCH review_records →
  计数 1/2/3 全部符合预期，探针用后已删）。
- **B5 — `awaitWithTimeout` 的超时定时器被 `.unref()`**：若被包装的 promise 永不
  settle（本例为 PowerSync SDK `close({disconnect:true})` 在 teardown 期间挂起），
  事件循环上唯一剩余的定时器是 unref 的 → 循环排空 → Node 直接
  “Detected unsettled top-level await” 退出（exit 13），超时永远没机会触发；
  工作目录也因此残留。讽刺的是 SDK 的 close() 本身没有问题——循环保持存活时它
  <10ms 即 settle（修复后 step 7 实测 0.0s）。
  修复：`e2e/run.ts` 的定时器改为 ref（能保活并触发），并在 race settle 后于
  `finally` 中 `clearTimeout`（获胜一方不留残留 handle）。

### 产品代码（packages/*、server/app）

**未发现 bug**：`createPowerSyncConnector`、`/credentials` JWT 签发（kid
nextdo-dev / aud nextdo，15min）、owner-token 存储、`subscribeAppStream`、
`/upload`（含 append-only 表的 INSTEAD-OF trigger 拒 PATCH 但回 2xx 的协议）在真实
链路上全部按设计工作。因此无需产品回归测试。

## 6. 根门状态（最终代码状态下重跑）

```
pnpm lint       → exit 0（eslint .；e2e/ 经 eslint.config.mjs 显式排除）
pnpm typecheck  → 全部 Done（packages/core、packages/db、packages/ui、server/app、apps/mobile）
pnpm test       → exit 0（core 9 suites、server/app 3、db 11 suites/127 tests、mobile 1/4 tests，全过）
```

`git status`（刻意不提交，留给父会话 review）：
`M eslint.config.mjs`、`M server/powersync/docker-compose.yml`、
`M server/powersync/init/02-nextdo-schema.sql`、`?? e2e/`、
`?? .trellis/research/archive/2026-09/09-22-e2e-sync-roundtrip`。无 .env / 本地库文件入库（§4 已验证）。

## 7. PRD 偏差 / 缺口（报告 §f 同步）

- **客户端 SDK**：PRD 指定 `@powersync/web` + `{ opened: DBAdapter }` hook
  （packages/db 测试 harness 模式）。该路径在纯 Node 上不可用：web SDK 自动检测 SSR
  （无 `window`）并安装 no-op 的 SSR 同步实现（connect/triggerCrudUpload/
  requestCheckpoint 均为 no-op）。改用一方 `@powersync/node` SDK——本就是
  packages/db 的 devDependency（零新增依赖），同一 PowerSync C 扩展 + node:sqlite
  机制、同一共享协议代码、真实 fetch/WebSocket。产品侧代码（connector/schema/
  stream/token）完全未动，仍是被测对象。已在 e2e/README.md 与 run.ts 头部记录。
- 其余步骤与 PRD 协议 1:1 对应，无其他偏差。
