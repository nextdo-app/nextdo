# 执行计划：三 issue 集成与 0.1.7 发布（父任务）

> 本任务不写产品代码；产出 = 三个子任务的集成、提交、PR 与发版。子任务各自有 prd/design/implement。

## 步骤

1. [ ] **子任务依次完成**（44 → 45 → 46）：每个子任务按自己的 implement.md 走「分层实施 → 分层门禁 → 全量门禁 → 浏览器实测 → spec 更新 → 提交计划确认 → commit」。
2. [ ] **全量门禁（最终一次）**：`pnpm lint && pnpm typecheck && pnpm test` + `node scripts/verify-web.mjs --no-serve`（含 web 构建）。三个子任务的截图证据分别落在 `.verify/<slug>/`。
3. [ ] **版本 bump（六处 → 0.1.7）**：根 `package.json`、`apps/mobile/package.json`、`apps/mobile/app.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/Cargo.toml`；`node scripts/check-release-version.mjs --tag v0.1.7` 通过。
4. [ ] **提交计划（Phase 3.4，一次确认）**：工作提交（子任务各自一条 + spec 一条 + bump 一条）→ 归档提交 → journal 提交；不 amend、不 push（推送在下一独立步骤，见 5）。
5. [ ] **推送与 PR**：`git push -u origin feat/issues-44-45-46` + `git push origin park/contexts-scenes`；`gh pr create --base main` —— PR 描述含：#44/#45/#46 的改动摘要、#46 的「重新实现注意事项」、**本地 main 领先 origin 的 4 条既有提交会随本 PR 一并入库**、与 deadline 任务的交叠与合并顺序建议。等 CI 全绿。
6. [ ] **合并与 tag**：合并 PR（或由用户合并）→ `git tag -f v0.1.7 <merge_sha>` → 推送 tag → 轮询发布流水线。
7. [ ] **资产核验（10 个）**：aarch64.dmg / x64.dmg / x64-setup.exe / amd64.AppImage / amd64.deb / android arm64 APK / android x86_64 APK / worker.js / 其余流水线产物 —— 逐个列出名字与大小，写入交付说明。
8. [ ] **收尾**：三个子任务 + 父任务归档；journal 记录本会话；worktree 清理（`git worktree remove`，可留待用户确认后）。

## 复核门（review gates）

- 第 4 步的提交计划必须一次成型给用户确认；被否决即转手工模式，不再提第二个方案。
- 第 5 步 PR 描述里点名既有 4 条提交与 deadline 交叠。
- 第 6 步合并前 CI 必须绿；tag 与 merge sha 对齐（用 `gh api` 取 merge_commit_sha）。

## 风险

- **与 deadline 任务交叠**：两个任务都改 `clarify-flow.ts` / `clarify-wizard.tsx`；先合并的一条会让另一条需要 rebase + 重跑门禁。
- **worktree 被外部清理**：本会话已发生过一次（`Nextdo-issues` 目录被删）；工作副本在 `/tmp/nextdo-issues-work-*.tgz` 留有备份，层与层之间重新备份。
