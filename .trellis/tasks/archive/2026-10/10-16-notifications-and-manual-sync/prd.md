# 通知与同步体验改进（issue #24 / #22）

## Goal

解决 GitHub issue #24（通知主动授权 + App 内总开关）与 #22（手动同步 + 上次同步时间），并 bump 版本、发 PR、打包发布。

## Background

- 仓库 `nextdo-app/nextdo`；起点 `origin/main` = `093b08e`（PR #35 已合并）。
- 版本现状：根 `package.json`、`apps/mobile/package.json`、`apps/mobile/app.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json` 六处均为 `0.1.6-beta.4`，由 `scripts/check-release-version.mjs` 强制一致。
- 最近发布 `v0.1.6-beta.4`（prerelease）；最近正式版 `v0.1.4`。
- 发布由 `.github/workflows/release.yml` 驱动：推 `v*` tag → 构建 macOS / Windows / Linux / Android / worker → 创建 GitHub Release。Release 正文 = 应用内 ChangeLog，由 `scripts/build-release-notes.mjs` 从提交历史生成（不得写成产物清单）。

## Task Map

| 子任务 | 交付物 | 对应 issue |
|---|---|---|
| `10-16-notification-optin-and-master-switch` | 首次主动授权引导 + App 内通知总开关 | #24 |
| `10-16-manual-sync-and-last-synced` | 「立即同步」入口 + 上次同步时间 + 更细状态 | #22 |
| 本任务（父） | 版本 bump、PR、打包发布 | — |

## Requirements

- R1 两个 issue 的验收标准由各自子任务 `prd.md` 承载；父任务只要求它们**全部**满足。
- R2 全部改动落在同一个分支、同一个 PR（用户要求「提个 pr」，单数）。
- R3 版本 bump 后六处版本源保持一致，`pnpm check:version` 通过且渠道（prerelease / stable）正确。
- R4 PR 合并后推 tag 触发发布；Release 正文由提交历史生成，不得写入产物清单。
- R5 父任务自身只改版本号与发布相关内容，不直接改产品代码。

## Acceptance Criteria

- [ ] AC1 两个子任务的验收标准全部满足。
- [ ] AC2 `pnpm verify:web` 全绿（lint → typecheck → test → web 构建）。
- [ ] AC3 涉及界面在浏览器实测并截图到 `.verify/<slug>/`；无法实测的部分在交付说明中明确列出。
- [ ] AC4 `pnpm check:version` 通过，六处版本号一致，tag 与渠道匹配。
- [ ] AC5 PR 已创建（base `main`），描述含两个 issue 的关闭引用与验证证据。
- [ ] AC6 合并后推 tag，`release` workflow 成功，GitHub Release 正文为真实变更日志（`gh release view <tag> --json body` 校验）。

## Out of Scope

- iOS 打包（发布流水线不含 iOS，需 Apple 签名凭据）。
- 账号体系 / 多用户（v1 单用户）。
- 依赖 Docker 的 `e2e/sync-roundtrip.ts` 全链路回归。

## Open Questions

- 本次发布的版本号与渠道（`v0.1.6-beta.5` 继续测试版 / `v0.1.7` 转正式版）——待用户确认。
