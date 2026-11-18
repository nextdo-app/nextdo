# Design — deploy-owned owner token（移除 /claim）

## 1. 启动数据流（server）

```
.env NEXTDO_OWNER_TOKEN（必填）
  → resolveOwnerToken(env)            owner-token.ts
      trim 后非空 → string
      缺失/空    → throw（消息含 `openssl rand -hex 32` + .env 位置）
  → index.ts main()：失败走 main().catch → logger.error + exit 1
  → logger.info('owner token source: env')   （一行确认，不含 token 值）
  → createApp({ pool, ownerToken: string, jwtSecret })   app.ts
      requireOwnerToken(ownerToken)      auth.ts（静态，无闭包）
  → serve
```

- `ownerTokenSource`（`'env' | 'file' | 'unclaimed'`）整体删除——唯一来源是 env。
- `currentToken` 闭包删除：token 启动后不可变（没有 /claim 更新它），`requireOwnerToken(config.ownerToken)` 直接静态引用。
- `requireOwnerToken(expectedToken: string)`：删 `expectedToken === null` 分支；其余 401 矩阵（missing / non-Bearer / 空 / 不匹配）与 timing-safe（先 SHA-256 再 `timingSafeEqual`）零改动。
- `resolveOwnerToken` 保持「注入 env 的纯函数」测试缝（默认 `process.env`）；从 async 变 sync 可以（不再读文件）——保持 sync。

## 2. 客户端连接流（mobile）

```
connect({ backendUrl, endpoint, token })            use-cloud-sync.ts
  trim ×3
  地址空  → 「请先填写服务器地址」          （零网络，现状不变）
  地址非法 → 「地址无效，应以 http:// 或 https:// 开头」（零网络，现状不变）
  token 空 → 「请先输入 owner token」        （新增，零网络）
  fetchCredentialsOnce(config, token)
    ok        → setStoredBackendConfig → setOwnerToken（poke，顺序不变）→ ok
    401       → 「token 不正确」
    网络/5xx/坏体 → 「连不上服务器，请稍后重试」
```

- 删除：`claimOwnerTokenOnce` import、claim 三分支（200 自动存 / 409「服务器已有 token，请手动输入」/ network）。
- 按钮禁用逻辑（只看两地址非空）不变——token 必填与「地址合法」同模式：由 `connect()` 内联报错，不由按钮禁用承担（与既有「地址无效」先例一致，见 component-guidelines）。
- 存储层（`packages/db/src/owner-token.ts`）零改动：token 仍存 `OWNER_TOKEN_KEY`（Keychain/stronghold/内存矩阵），与 sync config 同一 store——用户说的「和 用户 id 保存在一起」即此现状（v1 单用户：token 本身即身份凭证），无需新 key。
- `_layout.tsx` 启动预检（读 token + config 决定 connected/disconnected）零改动。

## 3. packages/db 协议面

- 删除 `claimOwnerTokenOnce` + `ClaimOutcome` + 文件头 bullet（`/claim` wire protocol 条目）。
- `fetchCredentialsOnce`、`createPowerSyncConnector`、`SYNC_STREAM_NAME` 零改动——`/credentials`、`/upload` 线协议不变，e2e（显式 env token）零改动。

## 4. 部署面（server/deploy）

- compose：`NEXTDO_OWNER_TOKEN: ${NEXTDO_OWNER_TOKEN:?set NEXTDO_OWNER_TOKEN in .env (openssl rand -hex 32)}`——与 `JWT_SECRET` 的 `:?` 必填先例同模式；删 `./data:/app/data` 卷（无其他消费者）；`volumes:` 只剩 `pgdata`。
- `.env.example`：`NEXTDO_OWNER_TOKEN=` → 注释改必填 + 生成命令 + 「所有设备在设置页填入同一值」+ 泄漏语义（与 POSTGRES_PASSWORD/JWT_SECRET 同级）。
- README：单路 token 节；「Connect a device」删 first/second device 差异（所有设备同一流程：两地址 + token）；Operations 迁移节（见 PRD R4）。

## 5. 不变量核对（全部保持）

| 不变量 | 状态 |
| --- | --- |
| token 不入日志（无横幅、无 echo） | 保持（唯一新增日志行 `owner token source: env` 不含值；启动失败消息只含生成命令） |
| config → token 写顺序、单 poke | 保持（connect 唯一写路径未动） |
| timing-safe 401 矩阵、fail-closed | 保持（只删 null 分支） |
| 单写者服务器假设 | 保持（更简单：无 claim 竞争面） |
| e2e 显式 env | 零改动 |
| `@nextdo/server` 不 import 单仓其他包 | 保持 |

## 6. 提交拆分（绿色中间态，parent 提交，implement 子代理不提交）

1. `feat(server): require NEXTDO_OWNER_TOKEN at boot; drop /claim + file persistence`（owner-token.ts/index.ts/app.ts/auth.ts + 测试）
2. `feat(db): remove claimOwnerTokenOnce (claim endpoint retired)`（powersync.ts + 删测试）
3. `feat(mobile): owner token input required again (drop claim bootstrap)`（use-cloud-sync.ts/settings.tsx + 测试）
4. `chore(deploy): NEXTDO_OWNER_TOKEN required; drop data volume + claim docs`（compose/.env.example/README）
5. `docs(trellis): spec sync for deploy-owned owner token`（spec 三处）
