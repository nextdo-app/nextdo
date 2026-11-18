# 技术设计：优化同步配对UI（连接串优先与多端导出配对）

## 1. 架构与改动范围

改动集中在 `apps/mobile`，涉及三个层次：
1. **工具函数层（`apps/mobile/lib/sync-connection.ts`）**：
   - 增加 `formatConnectionString(serverAddress: string, token: string): string`：输出 `<serverAddress>|<token>`。
   - 增加 `formatDeepLink(serverAddress: string, token: string): string`：输出 `nextdo://sync?s=<encoded>&t=<encoded>`。
   - 补充配套单测在 `apps/mobile/__tests__/sync-connection.test.tsx`。

2. **状态 Hook 层（`apps/mobile/hooks/use-cloud-sync.ts`）**：
   - 在已连接时，`getOwnerToken()` 获取到的 token 存入 hook 状态 `ownerToken: string | null` 中。
   - `useCloudSync()` 返回增加 `ownerToken`，以便 UI 生成导出连接串和配对二维码。

3. **二维码组件（`apps/mobile/components/qr-code.tsx`）**：
   - 使用 `qrcode` 的核心矩阵生成算法（`QRCode.create(value)`，纯 JS，无 Canvas/DOM 依赖）。
   - 将矩阵通过纯 React Native `<View>` 网格以行块合并优化（连续黑色模块合并为一个 View）进行渲染。
   - 零原生依赖，无额外体积袱，100% 兼容 iOS、Android、Web 及 Jest 单元测试环境。

4. **UI 交互层（`apps/mobile/app/(tabs)/settings.tsx`）**：
   - **未连接**：
     - 主区域展示单一连接串输入框（`connectionInput`），支持直接粘贴 `<base>|<token>` 或 `nextdo://sync?...`。
     - 「高级设置」手风琴中保留分离的服务器地址、Token 以及自定义后端/同步流地址输入。
   - **已连接**：
     - 增加「复制连接串」按钮，结合 `expo-clipboard`，提供 2 秒「已复制」反馈。
     - 增加「扫码配对」折叠/切换按钮，展开展示 `QRCode` 组件与使用指引。
     - 保留只读地址与「断开连接」按钮。

5. **测试覆盖（`apps/mobile/__tests__/settings-screen.test.tsx`）**：
   - 覆盖单一连接串提交连接成功路径。
   - 覆盖高级设置展开后分别填写的连接路径。
   - 覆盖已连接状态下的连接串复制与扫码配对展开。

## 2. 剪贴板跨端方案
- 引入官方 `expo-clipboard`：
  - `await Clipboard.setStringAsync(text)`
  - 兼容 iOS、Android 和 Web（Web 自动降级至 `navigator.clipboard` 或 execCommand）。
  - 在 Jest 环境下提供简易 mock。

## 3. 二维码轻量渲染
- 二维码矩阵使用 `qrcode` 纯 JS core 库计算尺寸和 module。
- 渲染逻辑：
  - 外层容器：白色背景卡片。
  - 行扫描合并：对每一行的连续黑色像素进行合并为一个绝对定位或 flex 水平块，大幅减少 DOM/View 节点数量（从 1000+ 节点压缩至 ~150 节点）。
  - 支持传入 `size`（默认 200 pt）。
