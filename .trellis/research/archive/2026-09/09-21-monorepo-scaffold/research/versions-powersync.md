# PowerSync 版本与接线方式（2026-09-21 核实）

> ⚠️ **PowerSync 在 2026-07 做了 SDK v2 大改版 + 包改名，v1 时代的多个包名已失效（npm 404）。** 任何基于旧文档（`@powersync/client`、`powersync-jwt`、`syncs/app.yaml`）的假设都需要按下文修正。
>
> 核实方式：npm registry 元数据 + docs.powersync.com 官方文档（.md 端点）+ Docker Hub tags API。

## 结论速查

| 项 | 锁定值 | 状态 |
|---|---|---|
| RN 客户端 SDK | `@powersync/react-native@2.2.1`（2026-09-10） | v2 稳定线 |
| RN SQLite 适配器 | `@op-engineering/op-sqlite@18.2.5` | peer 要求 `>=17.1.0 <19.0.0`；必须显式安装（autolinking 只认直接依赖） |
| Web 客户端 SDK | `@powersync/web@2.3.1`（2026-09-10） | **新命名**（v1 时代的 `@powersync/client` 已 404） |
| React hooks | `@powersync/react@2.0.1` | useQuery / useStatus / useSyncStream |
| Kysely 适配 | `@powersync/kysely-driver@2.0.1`（2026-08-03） | **独立包**（不再是 `@powersync/client/kysely` 子路径） |
| Kysely | `kysely@0.29.6` | driver 要求 `^0.28.0 \|\| ^0.29.0`；0.30.0-beta.2 不要碰 |
| 公共类型 | `@powersync/common@2.2.1` | react-native SDK 的固定 dep，自动带入 |
| JWT 签发库 | `jose@6.2.12` | 官方文档当前推荐；**旧 `powersync-jwt` 包已 404** |
| PowerSync Service 镜像 | `journeyapps/powersync-service:1.26.1` | Docker Hub `latest`；tags API + digest 证实存在（见 §4） |
| Expo Go 场景 | `@powersync/adapter-sql-js@0.0.23` | 可选；原生 op-sqlite 在 Expo Go 沙箱不可用 |
| 本地 dev CLI | `powersync@0.10.1` + `@powersync/cli-plugin-docker@0.10.1` | 2026-09-15 发布的新 CLI（可替代手写 docker-compose，可选） |

## 1. 已废弃 / 改名的包（重要）

| 旧包名 | 现状 | 替代 |
|---|---|---|
| `@powersync/client` | npm 404 | `@powersync/web`（纯 Web）/ `@powersync/react-native`（RN） |
| `@powersync/axios` | npm 404 | 已移除；v2 默认用 fetch + HTTP streaming（Expo 上用 `expo/fetch`），非 Expo RN 用 WebSocket 回退 |
| `powersync-jwt` | npm 404 | 用 `jose` 直接签发（见 §5） |
| `@powersync/client/kysely`（子路径导出） | 不再存在 | 独立包 `@powersync/kysely-driver` |

其他可用包：`@powersync/node@1.0.1`（Node.js SDK）、`@powersync/tauri-plugin@0.0.6`（Tauri SDK，**alpha**；本项目桌面端走 Expo Web 构建，不需要它）。

## 2. 客户端 Schema 声明格式（v2：`Schema` + `Table`，不再是 `ClientSchema{tables,queries}`）

```ts
// packages/db/src/schema.ts
import { column, Schema, Table } from '@powersync/react-native';

const lists = new Table({
  created_at: column.text,
  name: column.text,
  owner_id: column.text,
});

const todos = new Table(
  {
    id_local: column.text,      // 示例列
    list_id: column.text,
    completed: column.integer,
  },
  { indexes: { list: ['list_id'] } },
);

export const AppSchema = new Schema({ todos, lists });

// 类型导出（Kysely 包装用）
export type Database = (typeof AppSchema)['types'];
```

要点（来源：docs.powersync.com/client-sdks/reference/react-native-and-expo）：

- 列类型只有 `column.text` / `column.integer` / `column.real`，需与 Sync Streams 输出一致。
- **不要声明 `id` 列**——SDK 自动创建 text 主键。
- 无客户端迁移：SDK 同步 schemaless 数据并用 SQLite view 套上 schema。
- v1 的 `queries`（client 侧 named queries）**已移除**，被服务端的 **Sync Streams** 取代（见 §4）。

## 3. 实例化 + 接线（fetchCredentials / uploadData，v2 connector 形状）

```ts
// packages/db/src/powersync.ts
import { PowerSyncDatabase } from '@powersync/react-native';
import { AppSchema } from './schema';

export const powersync = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: 'nextdo.db' },
});
```

```ts
// packages/db/src/connector.ts
import type { PowerSyncBackendConnector, CommonPowerSyncDatabase } from '@powersync/react-native';
import { getOwnerToken } from './owner-token'; // per-platform 存储（SecureStore / stronghold / in-memory）

export class Connector implements PowerSyncBackendConnector {
  /** 返回 { endpoint, token }：endpoint = PowerSync 实例 URL（或自托管地址），token = 短时效 JWT */
  async fetchCredentials(): Promise<{ endpoint: string; token: string }> {
    const res = await fetch(import.meta.env.NEXTDO_API + '/credentials', {
      headers: { Authorization: `Bearer ${await getOwnerToken()}` }, // 两个端点都要求 owner token（运行时取得，非 app session）
    });
    if (!res.ok) throw new Error(`/credentials failed: ${res.status}`); // 非 2xx（含 401）→ 抛错，由 SDK 重试路径处理
    const data = (await res.json()) as { token: string };
    return { endpoint: import.meta.env.NEXTDO_POWERSYNC_URL!, token: data.token };
  }

  /** SDK 自动循环调用；一次处理一个 transaction，仅在 2xx 后 await complete() */
  async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const ops = transaction.crud.map((op) => ({ op: op.op, id: op.id, data: op.opData }));
    const res = await fetch(import.meta.env.NEXTDO_API + '/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getOwnerToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(ops),
    });
    if (!res.ok) throw new Error(`/upload failed: ${res.status}`);
    // 关键：fetch 对 4xx/5xx 不抛错——非 2xx 必须先抛错（官方行为：SDK 按
    // retryDelayMs 默认 5s 无限重试，队列保持阻塞；后端对校验级拒绝也返回
    // 2xx，见 spec）。只有 2xx 才能 complete()。反方向同样致命：成功返回
    // 却漏掉 complete()，SDK 会判定 stuck 并抛内部错误。
    await transaction.complete();
  }
}

// 启动
powersync.connect(connector, { crudUploadThrottleMs: 1000 }); // throttle 默认 1000ms
```

v2 行为要点（来源：docs.powersync.com/configuration/app-backend/client-side-integration）：

- **`fetchCredentials()` 返回 `{ endpoint, token }`** —— v1 的 `stream` / `parameters` / `expire_at` 字段已不存在。SDK 内部缓存凭据；在首次连接、token 剩余 ≤30s、token 过期、401 时重新调用（1h TTL 约每小时一次）。
- **`uploadData(database)` 由 SDK 自动调用**（本地写入后 / 重连后 / keepalive / 失败重试），**永不直接调用**。SDK 以循环方式调用直到队列为空；实现每次只需处理一个 batch/transaction。
- `transaction.crud` 里每条 op：`op.op` ∈ `UpdateType.PUT | PATCH | DELETE`，`op.id`、`op.opData`。处理完 `await transaction.complete()`。
- **上传路径是客户端 → 你的后端（server/app 的 `/upload`）直连，不经过 PowerSync Service**。Service 只负责 server→client 读路径 + JWT 校验。
- 上传端点必须**同步落库**（不能异步入队），否则 checkpoint 机制会丢用户改动；校验冲突返回 `2xx`（错误信息走同步表回传），只有瞬时故障才返回 `5xx`（SDK 按 `retryDelayMs` 默认 5s 重试，4xx 会阻塞队列）。
- 连接方式：Expo 上默认 HTTP streaming（`expo/fetch`），非 Expo RN 走 WebSocket/RSocket；可用 `connectionMethod` 覆盖。

## 4. PowerSync Service 自托管（Docker + 配置格式）

- **镜像：`journeyapps/powersync-service`**（注意：不是 `powersync/service`，那个 repo 不存在）。Docker Hub 最新 tag：**`1.26.1`**（2026-09-21 经 Docker Hub tags API 复核：tag 存在，amd64 digest `sha256:eeb83b378545d243b427a5557e41efce80d067a4b0cac2652fbf97900ff002c4`，last_pushed 2026-09-11；官方发布公告页目前只到 v1.26.0，1.26.1 公告未发布）；另有 `1` / `1.26` 滚动 tag 和 `-next` 变体。
- 主配置文件 **`service.yaml`**（YAML 或 JSON；可挂载卷、base64 环境变量或 CLI 参数传入）。核心段：

```yaml
# server/powersync/service.yaml
replication:
  connections:
    - type: postgresql
      uri: postgresql://postgres:mypassword@pg-db:5432/nextdo
      sslmode: disable          # 仅内网可用；公网必须 verify-full/verify-ca
storage:
  type: mongodb                 # 或 postgresql（bucket 存储独立于源库）
  uri: mongodb://mongo:27017/nextdo_powersync
port: 8080
sync_config:
  path: sync-config.yaml        # 也可 content: | 内联
client_auth:
  jwks:
    keys:
      - kty: oct
        alg: HS256
        kid: nextdo-dev
        k: '<base64url 共享密钥>'   # 开发用 HS256；生产推荐非对称 JWKS
  audience: [nextdo-dev, nextdo]
api:
  tokens: [nextdo-admin-token]  # admin API / CLI 用
system:
  logging: { level: info, format: json }
```

- ⚠️ **命名变更**：spec 里写的 `syncs/app.yaml` 是旧格式。当前顶层键是 **`sync_config`**（`path` 或 `content`），旧 `sync_rules` 顶层键是 deprecated alias。stream 定义文件 **`sync-config.yaml`**：

```yaml
# server/powersync/sync-config.yaml
config:
  edition: 3

streams:
  lists:
    auto_subscribe: true
    query: SELECT * FROM lists WHERE owner_id = auth.user_id()
  todos:
    auto_subscribe: true
    queries:                     # 多查询合并为一个 stream（更省订阅数）
      - SELECT * FROM todos WHERE owner_id = auth.user_id()
      - SELECT * FROM next_actions WHERE owner_id = auth.user_id()
```

  可用选项：`query`（单条）/ `queries`（数组）/ `with`（CTE）/ `auto_subscribe`（默认 false）/ `priority`（数字越小越先同步）/ `accept_potentially_dangerous_queries`（用客户端可控参数时才需要显式开启）。
- 环境变量替换：`!env PS_XXX`（仅 `PS_` 前缀变量），`::number` / `::boolean` 强转。
- 配置 JSON Schema：`@powersync/service-schema`（1.26.1），YAML 头加 `# yaml-language-server: $schema=https://unpkg.com/@powersync/service-schema@latest/json-schema/powersync-config.json` 获得校验。
- storage version 4（**两处官方资料不一致，原样记录**）：v1.26.0 发布记录称 v3→v4 已 "marking the format as stable"（含 S3 兼容对象存储；sync config 里 `config.storage_version: 4` 显式开启，触发存量数据重处理）；但当前 self-host 配置参考仍把 v4 标为 **Beta**，且 `storage.default_storage_version` 默认值为 **2**（不是 3）。另注意：配置参考明确 **Postgres bucket storage 尚不支持 v4**（v4 目前仅 MongoDB storage）。scaffold 不显式设置 storage_version（用默认），也不开 object_storage。
- 本地 dev 备选：新 **`powersync` CLI（npm 0.10.1）+ `@powersync/cli-plugin-docker`** 可一键起 docker-compose 栈；官方完整示例见 https://github.com/powersync-ja/self-host-demo（`demos/nodejs/` 即 Postgres + Node 后端，含 service.yaml 与 docker-compose）。
- 参考：storage（bucket）库支持 MongoDB 或 Postgres；Postgres 源库与 storage 在 PG <14 时必须分开两个实例。

## 5. JWT 签发（服务端，server/app）

- 官方当前推荐库：**`jose`（latest 6.2.12）**。旧 `powersync-jwt` 包已下架。
- JWT 硬性要求（docs.powersync.com/configuration/auth/custom）：
  - `sub` = 用户 ID；`aud` ∈ `client_auth.audience`；`kid` 必须匹配密钥；
  - `iat` 与 `exp` 必须存在，`exp - iat ≤ 24h`，**推荐 5–60 分钟**（本 spec 的 15 分钟符合推荐区间）；
  - 生产推荐非对称（RS256/EdDSA/ECDSA + JWKS，`jwks_uri` 或内联 `jwks.keys`）；HS256 共享密钥仅建议开发用。
- 官方示例（HS256，jose v6 API）：

```ts
import * as jose from 'jose';
const token = await new jose.SignJWT({ owner_id: userId })
  .setProtectedHeader({ alg: 'HS256', kid: 'nextdo-dev' })
  .setSubject(userId)
  .setAudience('nextdo-dev')
  .setIssuedAt()
  .setExpirationTime('15m')
  .sign(new TextEncoder().encode(base64urlSecret)); // 或 Buffer.from(secret,'base64url')
```

- 开发捷径：Service 提供 development token 机制（docs.powersync.com/configuration/auth/development-tokens），scaffold 联调期可用。

## 6. Kysely 集成

```ts
import { wrapPowerSyncWithKysely } from '@powersync/kysely-driver';
export const db = wrapPowerSyncWithKysely<Database>(powersync); // Database 来自 schema.ts
```

- watch query 用 wrapper 的 `db.watch(kyselyQuery, { onResult })`。
- kysely pin **0.29.6**（driver 2.0.1 的 dep 是 `^0.28.0 || ^0.29.0`）。

## 来源 URL

- https://www.npmjs.com/package/@powersync/react-native （2.2.1，deps/peers）
- https://www.npmjs.com/package/@powersync/web （2.3.1）
- https://www.npmjs.com/package/@powersync/kysely-driver （2.0.1）
- https://www.npmjs.com/package/@op-engineering/op-sqlite （18.2.5）
- https://www.npmjs.com/package/jose （6.2.12）
- https://hub.docker.com/r/journeyapps/powersync-service/tags （tags API 2026-09-21：1.26.1 = latest，amd64 digest sha256:eeb83b37…002c4）
- https://releases.powersync.com/announcements/powersync-service （v1.26.0 发布记录：storage v4 转 stable；最新公告为 v1.26.0）
- https://docs.powersync.com/client-sdks/frameworks/react-native-web-support （RN-Web 支持：beta；双 SDK + worker 资产 + Metro 配置）
- https://docs.powersync.com/client-sdks/frameworks/react （`PowerSyncContext`/`PowerSyncContext.Provider` + usePowerSync / useQuery / useStatus / useSuspenseQuery / useWatchedQuerySubscription；无 `PowerSyncProvider` 导出）
- https://docs.powersync.com/configuration/app-backend/client-side-integration （connector 行为、complete()、throttle、重试）
- https://docs.powersync.com/client-sdks/reference/react-native-and-expo （Schema/Table、Connector 示例、安装、连接方式）
- https://docs.powersync.com/configuration/powersync-service/self-hosted-instances （service.yaml 全量字段）
- https://docs.powersync.com/sync/streams/overview （sync-config.yaml streams 格式）
- https://docs.powersync.com/configuration/auth/custom （JWT 要求、jose 示例）
- https://docs.powersync.com/handling-writes/writing-client-changes （/upload 端点同步落库要求）
- https://github.com/powersync-ja/self-host-demo （可运行参考实现）

## unverified 清单

- `@powersync/react-native 2.x` 对 **Expo SDK 57 / RN 0.86** 的官方兼容性声明：文档未逐 SDK 列版本矩阵，按 peer 范围（react */react-native *）推断兼容；scaffold 时需实际构建验证。
- **已核实（2026-09-21，官方 "React Native Web Support" 页）**：桌面端（Tauri + Expo Web 输出）走 `@powersync/web`（实例化 `PowerSyncDatabaseWeb` + DB/sync worker），**不是** RN SDK 的 web 路径；官方 RN-Web 支持目前为 **beta**，要求**同时安装** `@powersync/react-native` + `@powersync/web`，运行时按平台实例化；web worker 资产需拷贝到 `public/`（`npx @powersync/web copy-assets`，或从 `node_modules/@powersync/web/dist/worker` 手动拷贝）；Metro 配置需 `unstable_conditionsByPlatform.web.push('react-native-web')` + `resolveRequest` 将另一平台的 SDK 桩为空。剩余未验证：Expo 57 + Tauri WebView 下 worker/base-path 的实际构建验证（scaffold Step 4 验收门）。
