# #44 #45 #46 三 issue 修复与 0.1.7 发布

## Goal

父任务：#44 澄清流程重排、#45 通知设置简化与权限统一、#46 场景能力下线（代码保留在 park/contexts-scenes 分支）；跨子任务验收 = 全量门禁绿 + 发布 0.1.7（六处 bump、PR、tag、10 个资产）

## Requirements

- **R1 三个子任务各自按自己的 prd/design/implement 验收**：#44（`10-17-clarify-project-first`）、#45（`10-17-notification-app-permission`）、#46（`10-17-remove-contexts-scenes`）。实施顺序 = 44 → 45 → 46（44/46 都改向导，先 44 定新链再 46 摘场景）。
- **R2 分支与 PR**：工作分支 `feat/issues-44-45-46`（worktree `/Users/printsdf/Research/projects/Nextdo-issues`，基于本地 main f398147）；分支会带上本地 main 领先 origin 的 4 条提交（UI 优化 / 表单标签），PR 说明里点名。PR 目标分支 = main。
- **R3 版本**：六处 bump 到 **0.1.7**（根 package.json、apps/mobile/package.json、apps/mobile/app.json、apps/desktop/package.json、apps/desktop/src-tauri/tauri.conf.json、apps/desktop/src-tauri/Cargo.toml），`node scripts/check-release-version.mjs --tag v0.1.7` 通过。
- **R4 发布**：CI 全绿 → 合并 → tag `v0.1.7` → 发布流水线 → 核验 Release 资产（10 个：aarch64.dmg、x64.dmg、x64-setup.exe、amd64.AppImage、amd64.deb、android arm64/x86_64 APK、worker.js 等，逐一列出）。
- **R5 交叠与并行**：deadline 任务由另一个 agent 在主工作区推进（`clarify-flow.ts` / `clarify-wizard.tsx` 有交叠）；合并顺序先落一条，另一条 rebase 后重跑门禁。

## Acceptance Criteria

- [ ] AC-1 三个子任务完成并归档（work 提交 → archive 提交 → journal 提交的分离顺序）。
- [ ] AC-2 全量门禁绿（`pnpm lint` / `pnpm typecheck` / `pnpm test`，web 实测通过 `scripts/verify-web.mjs`）。
- [ ] AC-3 PR 创建且 CI 绿；描述含 #44/#45/#46 与 #46 的重新实现注意事项；`park/contexts-scenes` 已推送。
- [ ] AC-4 tag `v0.1.7` 推送后流水线成功，Release 资产核验通过（清单写入变更说明）。
- [ ] AC-5 主工作区（deadline 任务）未被本任务触碰：提交里不含 `apps/mobile/lib/clarify-flow.ts` 之外的 deadline 改动 —— 以「提交前 `git status` 核对」为准。

## Notes

- 发布版式（正式版 0.1.7 还是先 beta.N）在 Phase 3.4 的提交计划里与你最终确认。
- 本任务不产出代码，产出 = 三条子任务的集成 + 发版；父任务的 implement.md 即发布 runbook。
