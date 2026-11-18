# Technical Design: P0 核心缺陷修复

## 1. 架构与边界说明

本次修改涉及三个模块：
- `packages/core`：核心推荐硬过滤模块 (`filters.ts`)
- `server/app`：服务端应用网关与认证模块 (`app.ts`, `claim.ts`)
- `packages/db`：客户端 PowerSync 连接器与上传同步模块 (`powersync.ts`)

---

## 2. 详细设计

### 2.1 packages/core: 场景过滤逻辑调整
文件：`packages/core/src/engine/filters.ts`

**现有代码**：
```typescript
if (
  action.contextIds.length > 0 &&
  !action.contextIds.some((id) => input.context.contextIds.includes(id))
) {
  return 'context-mismatch';
}
```

**调整后代码**：
```typescript
if (
  input.context.contextIds.length > 0 &&
  action.contextIds.length > 0 &&
  !action.contextIds.some((id) => input.context.contextIds.includes(id))
) {
  return 'context-mismatch';
}
```
**说明**：
- 当 `input.context.contextIds.length === 0` 时，代表“任意场景 / 未指定场景”，不执行场景互斥判断，所有 action 不会因场景被判为 `context-mismatch`。
- 当 `input.context.contextIds.length > 0` 且 `action.contextIds.length === 0` 时，action 属于通用的（无场景要求），通过。
- 当 `input.context.contextIds.length > 0` 且 `action.contextIds.length > 0` 时，必须存在交集。

---

### 2.2 server/app: 首次绑定安全防护机制
文件：`server/app/src/claim.ts` 与 `server/app/src/app.ts`

**机制设计**：
在 `ServerConfig` 中增加可选的 `claimSecret?: string | null`（来自环境变量 `NEXTDO_CLAIM_SECRET`）。
- 若服务端设置了 `NEXTDO_OWNER_TOKEN`，服务初始化时即视为已被认领，`isClaimed()` 为 true，所有 `/claim` 请求一律返回 409。
- 若服务端未设置 `NEXTDO_OWNER_TOKEN`，但配置了 `claimSecret`：
  - 在 `POST /claim` 处理中：
    - 读取 Header `x-claim-secret` 或 request payload `{ claimSecret?: string }`。
    - 比对传入的 secret 是否与配置的 `claimSecret` 一致（常量时间比对 timingSafeEqual 避免时序攻击）。
    - 若不匹配或未提供，返回 403 Forbidden `{ error: 'forbidden', code: 'claim.invalid-secret' }`。
- 若既无 `NEXTDO_OWNER_TOKEN` 亦无 `claimSecret`：
  - 维持现有首次调用免密认领逻辑（单机/内网极简部署兼容），并在 `/claim/status` 中提示未受保护警告。

---

### 2.3 packages/db: 同步上传拒绝记录与死信排查机制
文件：`packages/db/src/powersync.ts`

**现有逻辑**：
```typescript
if (!res.ok) {
  throw new SyncNextdoError('upload.rejected', `POST /upload failed with status ${res.status}`);
}
await transaction.complete();
```

**问题**：
服务端遇到 validation error 返回 200，并在 body 里返回 `{ applied: number, rejected: RejectedOp[] }`。客户端未读取 body，无法得知操作被拒绝。

**设计**：
1. 客户端在 `res.ok` 后解析 JSON：
   ```typescript
   const outcome = (await res.json().catch(() => null)) as {
     applied?: unknown;
     rejected?: unknown;
   } | null;
   ```
2. 校验 `outcome?.rejected` 是否为数组且长度大于 0。
3. 若存在 rejected 操作：
   - 结构化记录 `logger.error`：包括 table, id, code, message 等详情。
   - 调用专用的失败记录回调或本地通知机制（如写入本地 dead-letter 存储或触发 `onUploadRejected` 事件），便于设置页面和诊断日志展示。
4. 完成 `await transaction.complete()`，避免重试死循环阻塞本地待上传队列。

---

## 3. 向后兼容性
- 所有的修改完全向后兼容现有的协议和接口；
- 未设置 `NEXTDO_CLAIM_SECRET` 的环境保持零门槛体验，设置后则杜绝匿名公网抢占；
- 场景筛选修复使“任意场景”回归原本设计意图。
