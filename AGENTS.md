<!-- TRELLIS:START -->
# mini-trellis

This project uses mini-trellis as a memory layer. Working knowledge lives under `.trellis/`:

- `.trellis/spec/` — durable contracts (short markdown; read `index.md` first)
- `.trellis/research/` — topic inbox (`<topic>.md`; `README.md` is not a topic)
- `.trellis/workspace/` — per-developer journals

Record a session with `/mini-trellis:remember` (Claude/OpenCode), `/mini-trellis-remember` (Pi/OMP/Kiro), `$mini-trellis-remember` (Codex/ZCode), or the `mini-trellis-remember` skill (Cursor and DeepSeek Harness). When earlier decisions or relevant project rules are needed, use `mini-trellis mem recall "<topic or path>"`; expand evidence with `mini-trellis mem read "<ref>"`. No search is required for unrelated work. Promote lasting boundaries into spec with `mini-trellis-update-spec`.

When the user confirms or corrects a project rule, save it through remember even without an explicit “remember” request, unless they ask not to save. An agreed future policy is recorded as agreed, not implemented. Also record reusable findings or a useful session/compact handoff. Questions, reviews, ordinary edits and unconfirmed proposals need no new record. New installs write notes without an automatic git commit; use `mini-trellis doctor` to check host wiring and `mini-trellis refresh --dry-run` before refreshing assets.

Keep one current rule in the document that already owns it. Preserve conditions with their rules: “when X, do not Y” must not become “never Y.” Unconfirmed scope, exceptions, and implementation choices stay open or are labeled as inference, not added to the contract.

For a confirmed update, use remember to edit the existing topic, verify the saved section once, record the journal link, and check the new entry/index row. Complete these authorized steps in the same turn without asking again between writes. Reuse returned file contents while unchanged instead of repeating reads. Journal-only success is not topic success; report partial writes accurately. New notes follow the requested or discussion language; updates preserve the document language.

For a memory-only update, reply with one short sentence using actual topic and journal Markdown links; expand for conflicts or partial writes. In a development task, include the links briefly with the requested result. Update affected README/docs/spec/research descriptions, including stale implementation status, in the same turn as the code. This maintenance needs no separate remember request or new journal entry.

When recall excerpts already answer the question with source and qualifiers, cite them and stop. Expand only missing context; do not repeat a lookup or fall back to dialogue-only `search` merely to reconfirm sufficient evidence.

ZCode, Kiro and OMP conversation histories are not parsed; use project knowledge or supply Markdown/text exports. For an explicit request to organize selected past sessions or supplied Markdown/text exports into project knowledge, use `mini-trellis-session-insight`; update existing documents and preserve sources.

mini-trellis does not create or drive tasks.

Managed by mini-trellis. Edits outside this block are preserved.
<!-- TRELLIS:END -->

<!-- 交付前验证流程：开始任何改动之前先读完这一节 -->

# 交付前验证流程（改动 → 验证 → 浏览器确认 → 交付）

**门禁全绿不等于可以交付。** 任何改动过应用代码的任务，都必须走完下面
四步才能向用户报告「已完成」。跳过第 3、4 步（浏览器实测 + 截图）就是
把没验证过的东西当成验证过的。

1. **改动代码。** 只改这次要解决的东西。
2. **跑门禁。** 一条命令跑完 lint → typecheck → test → web 构建：

   ```bash
   pnpm verify:web
   ```

   任何一步挂掉就停下修，不要往下走。加 `--skip-tests` / `--skip-build`
   可以缩短内层循环，但不能作为交付前的最终验证。

3. **浏览器实测并截图。** 上一步的命令会起一个静态服务器并打印
   `http://localhost:4180`（expo 的 web 输出是 SPA，脚本已做
   index.html 回落）。用浏览器打开它：
   - 走一遍**本次改动涉及的行为**（改了哪个页面就点哪个页面），
   - **截图按 session / 功能建独立子目录存放**：在 `.verify/` 下按本次任务或功能建子文件夹（如 `.verify/<feature-or-task-slug>/`，例：`.verify/app-update-check/`、`.verify/now-hierarchy/`），**禁止将截图直接散落在 `.verify/` 根目录**，以便隔离和检查（`.verify/` 目录已 gitignore，别提交），
   - 改动会失败时，也要确认界面上确实出现了预期的失败态。

4. **交付。** 报告时说清楚实测了什么：跑了哪些命令、看了哪几个页面、
   截了哪些图并注明具体的子目录路径（如 `.verify/<feature-slug>/xxx.png`）。**不要**把「单测绿了」当成界面行为已验证。

改动只涉及 `packages/*`、`server/*` 且不触及 `apps/mobile` 时，第 2 步
仍然全跑，但第 3 步可以只验证受影响的那部分界面。

详细门禁清单与常见坑见
[`.trellis/spec/project/quality-guidelines.md`](.trellis/spec/project/quality-guidelines.md)。

## 构建产物：不在本地构建，交给 GitHub Actions

需要安装包（macOS `.dmg` / Windows `.exe` / Linux `.AppImage` / Android `.apk`）时，
**不要在本地跑 `tauri build` 或 `eas build`**。正确路径是推送分支并开 PR：

- PR 由 `.github/workflows/ci.yml` 跑 lint / typecheck / test（Quality Gate）作为门禁；
- 安装包由 `.github/workflows/release.yml` 在 `v*` tag 或 `workflow_dispatch` 时构建并发布 Release。

本地只做：改代码 → `pnpm verify:web` 的 lint/typecheck/test → 浏览器实测截图。
不要用本地构建出来的包当作「已验证」的依据，也不要把构建产物
（`apps/desktop/src-tauri/target`、`apps/mobile/dist` 等）留在工作区或提交进仓库。

---
