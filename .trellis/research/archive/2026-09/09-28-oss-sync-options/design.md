# 设计 — 开源化云同步（默认本地 + 服务器自选）

## 架构与边界

同步链路分三层，本任务只动「配置来源」这一层，机制层零改动：

```
[ 配置来源（本任务改动）              [ 同步机制（零改动）                  [ 服务器（零改动）
apps/mobile/lib/env.ts          →    packages/db                          server/app (R7 已交付)
  - 移除 BACKEND 常量                - createPowerSyncConnector(config)      server/deploy (R1 已交付)
    getBackendConfig /             - fetchCredentialsOnce(config, token)
    configureBackend（零调用）       - NextdoPowerSyncConfig 类型
apps/mobile/lib/存储接入（新增）    →
  - getStoredBackendConfig          packages/db/src/owner-token.ts（扩展）
    setStoredBackendConfig          - 同一按平台 KV store（secure-store /
    （读 packages/db 存储 API）         stronghold / 内存）
                                    - 新 key: nextdo.sync.config (JSON)
app 接线（改动）                     - 既有 key: nextdo.auth.owner-token
  - hooks/use-cloud-sync.ts        - subscribeToOwnerTokenChange（不改名）
  - app/_layout.tsx provider +
    启动预校验
```

**扩展接缝现状（D2）**：机制层早已只依赖 `NextdoPowerSyncConfig` 显式传参（`powersync.ts:252`），凭证与机制分离（owner token → `/credentials` 换 JWT）。未来 P2P 等同步方式 = 新的 config 形状 + 新机制模块，复用同一套「设置页配置区块 + 按平台存储 + poke 通知」外壳。本任务不新增抽象接口（YAGNI——第二种实现出现前不造 seam 接口）。

## 数据流

### 连接（设置页）

```
用户填 [后端地址][同步流地址][token] → 提交
  1. trim；客户端校验：
     token 空 → 内联「token 不能为空」
     地址空   → 内联「请先填写服务器地址」
     地址非 http(s) 绝对 URL → 内联「地址无效，应以 http:// 或 https:// 开头」
     （此阶段零网络请求）
  2. fetchCredentialsOnce({backendUrl, endpoint}, token)
     - 200 → 3；401 → 内联「token 不正确」；网络/5xx → 内联「连不上服务器，请稍后重试」
  3. await setStoredBackendConfig(config)   ← 先写地址
     await setOwnerToken(token)             ← 后写 token（触发唯一一次 poke）
  4. poke → provider 重读 [token, config] 皆在 → powersync.connect(createPowerSyncConnector(config))
     poke → 设置页 hook 重读 → 切「已连接」视图（展示地址 + 断开按钮）
```

写顺序 config→token 是刻意的：poke 只由 token 变更触发，先写 config 保证 poke 触发时两者俱在；token 写失败则 config 多存一份（无 token 不连接，无害，下次覆盖）。

### 断开

```
断开连接 → clearOwnerToken()（本地数据不动）→ poke →
  provider 重读：token=null → powersync.disconnect()（纯本地）
  设置页切「未连接」视图；地址输入从存储预填
```

### 启动（后台，不阻塞渲染）

```
init → subscribeAppStream → 读 [token, config]
  任一 null → 不连接（现状 R6 行为）
  皆在 → fetchCredentialsOnce(config, token)
    401 → clearOwnerToken()（config 保留；防 SDK 401 死循环 + 设置页状态诚实）
    200 / 网络错 → 不动（离线优先）
```

## 契约

### packages/db 存储 API（owner-token.ts 内新增段）

```ts
export const SYNC_CONFIG_KEY = 'nextdo.sync.config';
export type StoredBackendConfig = NextdoPowerSyncConfig; // { backendUrl, endpoint }

export async function getStoredBackendConfig(): Promise<StoredBackendConfig | null>;
export async function setStoredBackendConfig(config: StoredBackendConfig): Promise<void>;
export async function clearStoredBackendConfig(): Promise<void>;
```

- 值编码：`JSON.stringify({ backendUrl, endpoint })`；读取解析失败 → `null` + `logger.warn`（不抛，恢复路径 = 重填）。
- `setStoredBackendConfig` 校验（`ValidationNextdoError`，code 沿用现有风格如 `auth.invalid-token-shape` → 新 code `sync.invalid-backend-url`）：
  - 两字段 trim 后非空；
  - `new URL(value)` 可解析且 `protocol ∈ {http:, https:}`。
- 存储后端的 key 契约：
  - **stronghold**（`createStrongholdStore`）：允许 key 集合从 `{OWNER_TOKEN_KEY}` 扩为 `{OWNER_TOKEN_KEY, SYNC_CONFIG_KEY}`；其余 key 仍抛 `storage.multi-key`（错误消息更新为列两个 key）。
  - **secure-store / 内存**：本就是泛 KV，零改动。
- 通知：`setStoredBackendConfig` **不**触发 poke（见上，写顺序已保证一致性）；`clearStoredBackendConfig` v1 无 UI 调用方（断开只清 token），但 API 齐备（测试 + 未来「重置服务器」用）。

### app 层

- `lib/env.ts`：删除 `BACKEND` / `backend` 状态 / `getBackendConfig` / `configureBackend`；保留 `POWERSYNC_WEB_WORKER_PATH`；头注释更新（配置来源 = 设备存储，见 packages/db）。
- `use-cloud-sync`：
  - `connect(input: { backendUrl: string; endpoint: string; token: string })`（取代 `connect(token)`）；
  - 新增暴露 `storedConfig: StoredBackendConfig | null`（挂载读一次 + poke 重读，供输入预填与已连接态展示）；
  - `state` 语义不变（connected = token 已存；地址缺失但 token 在的异常态视同 connected——预校验会处理 401，地址错时 SDK 重试属既有行为）。
- `_layout.tsx` provider / 预校验：读 `[getOwnerToken(), getStoredBackendConfig()]`，逻辑同「数据流/启动」节。
- `settings.tsx`：三输入 + 预填 + 已连接态展示地址；`INPUT_CLASS` 复用；错误文案优先级：客户端校验 > 服务端三态。

## 兼容与迁移

- **旧客户端**（硬编码域名构建）：不受影响，继续连维护者服务器。
- **新客户端 + 旧设备存储**：stronghold 快照只有 token key → `getStoredBackendConfig` = null → 未连接态，用户补填地址（token 免重输）。无迁移代码。
- **测试迁移**：11 个 mock `@nextdo/db` 的测试文件需补 `getStoredBackendConfig`（默认 `async () => null`）——机械改动；settings-screen.test 的 mock 增加 `setStoredBackendConfig` / `clearStoredBackendConfig` + 断言面扩展。

## 权衡记录

- **config 存哪**：与 token 同 store（一个 JSON key）而非新增独立存储——同信任域、同平台矩阵、同测试接缝；地址非密钥，进 SecureStore/stronghold 只是「按设备配置」的复用，不是安全要求。
- **不改名订阅**：`subscribeToOwnerTokenChange` 保留原名——v1 中 config 写入必伴随 token 写入，poke 语义不变；改名将波及 14 个文件且无行为收益（未来出现「config 独立变更」场景时再演进）。
- **两字段而非单域派生**（D3）：布局是部署者自由度（README 单域前缀 vs 生产子域），客户端不假设。
- **不做 `SyncBackend` 抽象接口**：v1 唯一实现，显式参数传 config 已经是接缝；接口在第二种实现落地时再抽。

## 回滚

单任务独立提交；回滚 = revert 提交组。stronghold 快照中新 key 残留无副作用（旧代码只读 token key）。数据面：存储的 config 回滚后成孤儿 key，无害。
