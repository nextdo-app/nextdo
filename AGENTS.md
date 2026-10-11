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

---

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
