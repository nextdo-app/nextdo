# 实现与验证记录：手机端检查更新支持正式版与测试版双渠道 (fixes #18)

## 1. 改动概述
针对手机端与桌面端应用内更新检查，支持同时检测正式版（stable）与测试版（beta）并让用户自主配置渠道偏好与更新目标：
1. **核心逻辑（`apps/mobile/lib/app-update.ts`）**：
   - 新增 `parseAtomFeedEntries`：解析 GitHub releases.atom 中的完整 release 记录，包括 tag、version、channel、channelLabel 与发布时间（`publishedAt`）。
   - 新增 `pickDualChannelReleases`：在所有 release 候选集中同时匹配最高的正式版与测试版最新记录。
   - 新增 `fetchDualChannelReleases`：优先请求 releases.atom 检索双渠道版本，若 atom 访问失败或未匹配到，平滑降级到 `releases/latest` 正式版兜底。
   - 新增 `getUpdateChannelPreference` / `setUpdateChannelPreference`：提供用户渠道偏好读取与持久化存储（Native 平台接入 SecureStore，Web 端接入 localStorage/MemoryStore）；当前版本为预发布时默认倾向测试版，当前版本为正式版时默认倾向正式版。
   - 保持所有下载链接与 release 链接均附带加速代理前缀（`UPDATE_PROXY_PREFIX`）。
2. **状态抽象（`apps/mobile/hooks/use-app-update.ts`）**：
   - 暴露 `preferredChannel` 与 `setPreferredChannel`。
   - 在检查更新完成后，若同时存在正式版与测试版更新，构建多版本候选列表 `options`（包含版本号、渠道徽章、发布日期、是否为用户偏好），支持通过 `selectVersion(version)` 自由切换目标版本。
3. **界面展示（`apps/mobile/app/(tabs)/settings.tsx`）**：
   - 「应用更新」卡片内增加更新渠道偏好切换项（「正式版（稳定推荐）」与「测试版（优先尝鲜）」）。
   - 检测到新版本时，若有多个渠道更新可选，提供多版本选择卡片，展示渠道徽章、版本号、发布日期与单选指示器，点选即可切换当前准备下载的版本。
   - 当仅一个渠道有可用新版本时，展示相应渠道标签及发布时间。

## 2. 门禁验证结果
执行命令：
```bash
pnpm verify:web --no-serve
```
各阶段验证通过：
- **1/4 lint**：ESLint 全 workspace 校验通过（0 errors, 0 warnings）。
- **2/4 typecheck**：全部包（core, db, ui, mobile, server）TypeScript 类型检查通过。
- **3/4 test**：全部单测通过（mobile 37 个测试套件，543 个测试全部 PASS；core 12 个测试套件，212 个测试全部 PASS）。
  - `lib/app-update.test.ts`：72 个用例全部通过（覆盖双渠道提取、Atom Feed 日期解析、偏好持久化、降级兜底等）。
  - `__tests__/settings-screen.test.tsx`：57 个用例全部通过（覆盖偏好切换、多版本更新展示与选择交互、加速代理链接校验等）。
- **4/4 build:web**：Expo Web 生产构建及 PWA 后处理成功导出。

## 3. 浏览器实测确认
在本地静态服务器（`http://localhost:4180`）中打开「设置」页面实测界面与交互，截图保存在 `.verify/dual-channel-update-check/`：
- `.verify/dual-channel-update-check/01-settings-channel-preference-initial.png`：检查更新模块展示渠道偏好设置（正式版/测试版）及当前版本信息。
- `.verify/dual-channel-update-check/02-settings-channel-preference-beta.png`：点击切换为测试版偏好（高亮激活并持久化）。
- `.verify/dual-channel-update-check/03-settings-check-update-result.png`：点击检查更新并完成版本检测。
- `.verify/dual-channel-update-check/04-settings-channel-preference-stable.png`：点击切换回正式版偏好。
