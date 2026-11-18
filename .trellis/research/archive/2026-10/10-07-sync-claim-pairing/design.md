# Technical Design: 服务端首次认领与一键配对

## 1. 架构总览

```
[ 新部署服务器 ] ──(启动，无环境变量)──> [ Unclaimed 状态 ]
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
         客户端 A（首台设备）                           客户端 B（第二台设备）
    1. 输入服务地址，Token 留空                     1. 扫码客户端 A 的二维码
    2. 检查 /claim/status -> false                 2. 自动获得 <server>|<token>
    3. 调用 /claim -> 获得随机 Token                3. 一键完成同步连接
    4. 自动持久化并连接成功
    5. 服务端进入 Claimed 状态，锁定通道
```

## 2. 服务端设计（`server/app`）

### 2.1 状态管理与存储
- **存储表**：`system_settings`
  ```sql
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  ```
- **启动判定**：
  1. 若 `process.env.NEXTDO_OWNER_TOKEN` 存在且非空：固定模式，不可认领，`claimed = true`；
  2. 若未配置：查询 `system_settings WHERE key = 'owner_token'`；
     - 存在：读取该值并生效，不可认领，`claimed = true`；
     - 不存在：未认领状态，`claimed = false`。

### 2.2 API 端点
- `GET /claim/status` -> `200 { claimed: boolean }`
- `POST /claim` ->
  - 若已认领（内存标志或 DB 已存在）：`409 { error: "already_claimed", code: "claim.already_claimed" }`
  - 若未认领：
    - 生成 64 字符十六进制安全随机串：`crypto.randomBytes(32).toString('hex')`；
    - 执行原子插入：
      ```sql
      INSERT INTO system_settings (key, value, created_at)
      VALUES ('owner_token', $1, $2)
      ON CONFLICT DO NOTHING
      RETURNING key;
      ```
    - 若竞争失败（返回 0 行）：响应 409；
    - 成功：更新内存凭证，返回 `200 { ok: true, ownerToken: $1 }`。

### 2.3 鉴权中间件升级
- 鉴权中间件改为动态读取当前有效的 `ownerToken`（支持运行时从 `null` 过渡到已认领状态）。
- 在未认领状态下，由于无有效密钥，任何未认证请求均拒绝为 401。

## 3. 客户端设计（`packages/db` 与 `apps/mobile`）

### 3.1 协议层（`packages/db`）
- `fetchClaimStatus(backendUrl: string): Promise<{ ok: boolean; claimed?: boolean; error?: string }>`
- `claimServer(backendUrl: string, ownerToken?: string): Promise<{ ok: boolean; ownerToken?: string; error?: string }>`

### 3.2 交互层（`apps/mobile`）
- 用户在「服务器地址」输入有效 URL，Token 留空，点击「连接」：
  1. 调用 `fetchClaimStatus` 探测；
  2. 若 `claimed === false`：
     - 调用 `claimServer` 完成一键认领；
     - 获取返回的 `ownerToken`，自动注入并调用 `connect`；
     - 界面跳转至“已连接”状态，并提供“扫码配对”与“复制连接串”；
  3. 若 `claimed === true`：
     - 内联报错：“该服务已绑定设备。请使用已连接设备扫码配对，或在高级设置中输入 owner token”。
- 若用户已输入 Token 或使用连接串，保留原有直连流程。
