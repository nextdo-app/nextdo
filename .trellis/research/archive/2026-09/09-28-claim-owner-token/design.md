# 设计 — owner token 首连自动申领（claim）

## 架构与边界

```
[ 客户端（改动）                      [ packages/db（改动）                [ server/app（改动）
settings.tsx：token 输入可选           claimOwnerTokenOnce(config)         POST /claim（新路由，无鉴权）
use-cloud-sync.connect：               = POST {backendUrl}/claim           resolveOwnerToken：第三分支
  token 空 → 走 claim                    200/409/网络 三态                   改「unclaimed」（不生成不打印）
  token 有 → 原 fetchCredentialsOnce    （同 fetchCredentialsOnce 风格）   createApp：ownerToken 闭包可变
                                                                           未申领态 /credentials、/upload 401
```

机制层（PowerSync 流、JWT、auth 401 矩阵形状）零改动。claim 是**引导路径**，不引入新鉴权模型。

## 数据流

### 首台设备（未申领服务器）

```
设置页填 [后端地址][同步流地址]，token 留空 → 提交
  1. 客户端校验地址（空/非法 → 内联错误，零网络）
  2. POST {backendUrl}/claim（空 body）
     - 200 { token }  → 3
     - 409 { code: 'owner-token.claimed', reason } → 内联「服务器已有 token，请手动输入」（token 输入保留焦点态，用户手填后重提交走原路径）
     - 网络/5xx/畸形 200 → 内联「连不上服务器，请稍后重试」
  3. setStoredBackendConfig(config) → setOwnerToken(claimed)（写顺序与现有 poke 机制不变）
     → provider 重读双全 → connect（与现有已连接流程完全合流）
```

### 服务端 claim

```
POST /claim
  env 显式 token 存在          → 409 { reason: 'explicit' }   （env token 永不服务）
  data/owner-token 非空        → 409 { reason: 'file' }       （已申领/重启后）
  否则 generate(64-hex) → persist 文件 → 更新内存闭包 → 日志（无 token）→ 200 { token }
```

### 启动语义（R7 第三分支变更）

```
resolveOwnerToken：env > 文件 > { token: null, source: 'unclaimed' }
  - 不写文件、不打印横幅（token 从此不出现在任何日志）
  - index.ts 记一行：「owner token unclaimed — first device to POST /claim mints it」
  - createApp 接收 ownerToken: null → requireOwnerToken(null) → /credentials、/upload 一律 401
    （响应形状/码不变，fail-closed）
  - claim 成功后内存闭包更新 → 同进程内 /credentials 立即可用（重启后由文件恢复）
```

`createApp` 内部用**闭包变量**持有当前 token（初始值 = 构造参数）：claim handler 成功后更新闭包，`requireOwnerToken` 每请求读闭包。构造签名保持 `ownerToken: string | null`（测试兼容），另传 `ownerTokenSource` 供 409 reason 与日志。

## 契约

### server

```ts
// owner-token.ts
export interface OwnerTokenResolution {
  token: string | null;                 // unclaimed → null
  source: 'env' | 'file' | 'unclaimed';
}
export type ClaimResult =
  | { claimed: true; token: string }
  | { claimed: false; reason: 'file' | 'explicit' };
export async function claimOwnerToken(env: OwnerTokenEnv = process.env): Promise<ClaimResult>;
// 单写者假设沿用 R7（一 api 每栈，无锁）；成功后持久化，重启即 file 分支
```

路由：`POST /claim`（CORS 现有中间件覆盖，含 preflight）：
- `200 { token }` — 仅未申领态一次
- `409 { error: 'owner-token.claimed', code: 'owner-token.claimed', reason }`

### packages/db

```ts
export type ClaimOutcome =
  | { ok: true; token: string }
  | { ok: false; kind: 'claimed'; reason: 'file' | 'explicit' }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'invalid' };
export function claimOwnerTokenOnce(config: NextdoPowerSyncConfig): Promise<ClaimOutcome>;
// POST {backendUrl}/claim；200 body 的 token 必须是非空 string 否则 'invalid'；
// 409 → 'claimed'（reason 取 body，缺省 'file'）；其余 → 'network'
```

### 客户端 connect 流程变化（use-cloud-sync）

- 「token 不能为空」分支**删除**（空 token = 触发 claim）；
- 地址校验不变（空 → 「请先填写服务器地址」；非法 → 「地址无效，应以 http:// 或 https:// 开头」）；
- claim 三态文案：409 → 「服务器已有 token，请手动输入」；network → 「连不上服务器，请稍后重试」；
- token 非空路径（fetchCredentialsOnce + 三态）**零改动**。

## 安全权衡（记录）

- **申领窗口**（未申领 → 首次 claim）：可被抢先申领；一次性 + 日志可见（无 token）+ 可恢复（删文件重启）。自托管信任域内接受；显式 env 路径完全无此窗口。
- **横幅移除**：比 R7 更安全（日志不再含密钥）；代价：忘记「首连即申领」的用户看不到提示——靠启动日志一行 + README。
- 不引入 claim 限流/时间锁（YAGNI；单用户自托管，且窗口一次性）。

## 兼容与迁移

- **显式 env 部署**（用户现有生产服务器）：行为不变（claim 恒 409）；想用新流程 = `.env` 清空 `NEXTDO_OWNER_TOKEN` + `rm data/owner-token`（如存在）+ `docker compose up -d api`（注意：服务器要先部署含本任务的代码）。
- **已连接设备**：token 不变则无感；重置服务器走新流程后，所有设备需重新走一次「首连申领/手动输入」。
- **e2e**：显式 env → 零改动。

## 回滚

独立提交组；revert 即恢复 R7 语义（横幅 + 启动自动生成）。数据面：claim 写的是同一 `data/owner-token` 文件，与 R7 兼容（R7 代码读到该文件 = file 分支静默复用）。
