# Design — 简化云同步连接

## 边界

三个改动面，彼此独立但有依赖顺序：

| 面 | 包 | 职责 |
|---|---|---|
| 协议 | `server/app` | `/credentials` 下发 `endpoint` |
| 存储 / 推导 | `packages/db` | `deriveSyncConfig` 纯函数 + `fetchCredentialsOnce` 解析 `endpoint` |
| UI / 输入 | `apps/mobile` | 单地址输入、高级折叠区、连接串解析、deep link 路由 |

`server/deploy` 只是 compose / `.env.example` / README 的透传与说明。

## 协议变更

### `/credentials` 响应

```
GET /credentials  Authorization: Bearer <owner token>
200 { "token": "<15min PowerSync JWT>", "endpoint": "https://your.domain/sync" }
```

`endpoint` 来自 `NEXTDO_SYNC_ENDPOINT`，**必填**，缺失时 `index.ts` 拒绝启动（与 `NEXTDO_OWNER_TOKEN` 同一套 env 校验风格，复用 `owner-token.ts` 的错误文案模式）。

**为什么服务端下发是安全的**：`endpoint` 不参与任何鉴权——客户端持有该 URL 得不到任何权限，PowerSync 服务自己校验 JWT。把「路径该长什么样」这个知识放在部署者一侧（配一次 `.env`），而不是让每个设备用户猜一次。

### 向后兼容矩阵

| 服务端 | 客户端 | 行为 |
|---|---|---|
| 旧（无 `endpoint`） | 新 | 回落本地推导值 → 可用 |
| 新 | 新 | 用服务端下发值 → 目标路径 |
| 新 | 旧 | 旧客户端忽略多余字段 → 用本地推导值 → 可用（降级可用） |
| 旧 | 旧 | 现状 |

四个格子全部可用，没有破坏性组合。

## 客户端存储形状

**不变**。仍是 `StoredBackendConfig { backendUrl, endpoint }`，两个 key 不变，stronghold 的双 key 契约不变。旧设备的存量数据零迁移。

变化的是**怎么填**：
- 旧：用户手填两个 URL
- 新：用户填一个基础地址，`deriveSyncConfig` 补全；或服务端下发覆盖

## 关键设计决策

### D1 `deriveSyncConfig` 放 `packages/db` 而不是 `apps/mobile`

它是「同步配置如何从用户输入推导」的领域规则，`setStoredBackendConfig` 的校验就在隔壁，放一起避免规则分裂。`apps/mobile` 只做调用与展示。

后缀剥离规则（容忍用户粘贴完整地址）：

```
输入 https://x.example.com        → { base: 'https://x.example.com' }
输入 https://x.example.com/       → 同上（剥尾部 /）
输入 https://x.example.com/api    → base 剥掉 /api → 同上
输入 https://x.example.com/sync   → base 剥掉 /sync → 同上
输出: { backendUrl: base + '/api', endpoint: base + '/sync' }
```

实现上用一次 `new URL()` + 路径段处理，不用正则（正则处理不了 query/fragment 等边界）。

### D2 高级设置以「填了即生效」为准，不加开关

折叠区里两个输入框只要非空就用它们，不再加一个「我用的是高级模式」的单选。少一个状态、少一个可能不同步的开关。空的高级字段回落推导值——这也是「高级区默认折叠 + 预填已有 config」的组合能成立的原因：已有 config 会被预填进高级区，所以重连用户看到的和现在一致。

### D3 `fetchCredentialsOnce` 的 `endpoint` 是可选且「非法即回落」

```ts
type FetchCredentialsOnceResult =
  | { ok: true; token: string; endpoint?: string }   // endpoint 存在 = 服务端下发的、已校验过的
  | { ok: false; kind: 'rejected'; status: number }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'network'; detail?: string };
```

`token` 非法仍然是 `invalid`（握手失败），但 `endpoint` 非法**不**升级为 `invalid`——它是可选增强字段，坏了就当没下发。这两个字段的失败语义不同，是刻意的。

### D4 连接器用响应里的 endpoint，而非本地 config

`powersync.ts:268` 现在返回 `{ endpoint: config.endpoint, token }`。改为优先用 `result.endpoint ?? config.endpoint`。

意义：PowerSync SDK 每 15 分钟刷新一次凭证，如果部署者改了 `NEXTDO_SYNC_ENDPOINT`，客户端在凭证刷新时就会跟上，不需要重新连接。这是把 endpoint 交给服务端下发换来的额外好处。

### D5 连接串两种形态、一个解析器

```
deep link : nextdo://sync?s=<encodeURIComponent(base)>&t=<encodeURIComponent(token)>
纯文本   : <base>|<token>
```

竖线分隔的纯文本形态选它是因为从终端复制最不容易出错（base64 的 `+/=` 视觉混淆多），且用户可能已经把 token 单独存好了。

解析器 `parseConnectionString(input)` 返回 `{ serverAddress, token } | null`：
- 含 `|` → 按竖线切
- 以 `nextdo://` 开头 → 解析 URL 的 `s` / `t` 查询参数
- 其他 → 不是连接串（调用方回落到「这是裸 token」的现有行为）

**放 `apps/mobile/lib/`**：纯函数、无平台依赖、可直接单测，与 `snooze-options.ts` 同级。

### D6 deep link 路由复用同一个 connect 流程

`app/sync.tsx` 是个薄路由：读参数 → `useCloudSync().connect(...)` → 成功 `router.replace('/(tabs)/now')`，失败带错误跳设置页。

不新建第二条连接路径——两条路径意味着两套校验、两套错误文案，必然漂移。

`app.json` 已有 `"scheme": "nextdo"`，Expo Router 会把 `nextdo://sync?...` 路由到 `app/sync.tsx`。**Tauri 桌面端不参与 deep link**（没有注册系统协议），桌面走粘贴。

## 数据流（连接成功路径）

```
用户在设置页填「服务器地址」= https://x.example.com
  → （可选）高级区两个自定义 URL 优先
  → deriveSyncConfig → { backendUrl: .../api, endpoint: .../sync }
  → connect(): 客户端三项校验（空地址 / 非 http(s) / 空 token）—— 零网络
  → fetchCredentialsOnce(config, token)
       GET {backendUrl}/credentials  Bearer token
       200 { token: <JWT>, endpoint: 'https://custom/stream' }
  → 合并 config：endpoint 存在且合法则覆盖，否则保留推导值
  → setStoredBackendConfig(finalConfig)   ← 先
  → setOwnerToken(token)                  ← 后（这次 poke 驱动 provider connect）
  → provider 收到 poke → 重读 token + config → powersync.connect(connector)
```

写序不变（config → token）是既有的关键约束，代码注释已说明原因（poke 触发时两者必须俱在），本次改动不触碰。

## 测试策略

| 层 | 手段 |
|---|---|
| `deriveSyncConfig` | `packages/db` 单测：各种输入形态 → 期望 config；非法输入 → `sync.invalid-backend-url` |
| `fetchCredentialsOnce` | 改写现有「ignores extra fields」用例；新增 endpoint 存在 / 缺失 / 非法三态 |
| `useCloudSync` | mock `fetchCredentialsOnce` + 存储后端，断言落盘的最终 config |
| 设置页 | 扩展 `settings-screen.test.tsx`：单地址连接、高级优先、深链参数解析 |
| `app/sync.tsx` | 渲染测试：合法参数 → connect 被调用 + 重定向；401 → 跳设置页 |
| `server/app` | 现有 `app.request()` 风格：env 缺失 → 启动被拒；200 体含 endpoint |
| 全链路 | `node e2e/sync-roundtrip.ts`（需补 `NEXTDO_SYNC_ENDPOINT`） |

## 兼容性风险点

`NEXTDO_SYNC_ENDPOINT` 变成必填会让**现有部署升级后启动失败**。这是本设计唯一的破坏性变更。缓解写进 README 的 Operations 段落，明确升级前先补该变量。

替代方案（可选 + 自动推导回落）被用户否决（D4）：宁可启动失败也不要静默推导出错误路径——一个连到错误路径但「看起来成功」的同步比一次明确的启动失败更难排查。
