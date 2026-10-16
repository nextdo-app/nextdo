# 执行计划：版本 bump、PR 与发布（父任务）

父任务只做集成与发布，不直接改产品代码。

## 顺序清单

1. 等两个子任务完成并验证通过。
2. 六处版本号统一 bump 到目标版本：`package.json`、`apps/mobile/package.json`、`apps/mobile/app.json`（`expo.version`）、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json`。
3. `pnpm check:version` 校验一致性与渠道。
4. 提交并推送分支，创建 PR（base `main`），描述含 `Closes #24` / `Closes #22` 与验证证据。
5. PR 合并后推 tag（`v<version>`）→ `.github/workflows/release.yml` 自动构建并创建 Release。
6. 用 `gh release view <tag> --json body` 校验 Release 正文是真实变更日志（不是产物清单）。

## 验证命令

```bash
pnpm check:version
pnpm check:version --tag v<version>
gh release view v<version> --json tagName,isPrerelease,body
```

## 风险点 / 回滚点

- **版本号必须六处同时改**，漏一处 `check:version` 会直接失败；这是有意的护栏。
- **tag 与渠道必须匹配**：prerelease 版本不得用正式版 tag，反之亦然（`scripts/check-release-version.mjs` 的 Issue #14 防护）。
- **tag 必须打在含本次改动的提交上**：PR 未合并就推 tag，release 会构建旧代码。
- 发布失败可重跑 workflow（`workflow_dispatch` + `run_id`），已存在的 Release 会被 `--clobber` 覆盖资产并刷新正文。
