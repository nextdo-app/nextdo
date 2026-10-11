# 交付前验证（浏览器实测门禁）

本次改动涉及应用代码时，用这个命令走完整的交付门禁。**门禁全绿不等于可以交付** —— 必须再在浏览器里实测并截图。

## Step 1: 跑门禁 + 构建 + 起服务器

```bash
pnpm verify:web
```

依次执行 `lint → typecheck → test → build:web`，然后在 `apps/mobile/dist` 上起一个静态服务器并打印 `http://localhost:4180`，保持运行。

内层循环可以缩短：`--skip-tests`（改 UI 时最快）、`--skip-build`（复用已有 dist）、`--no-serve`（只跑门禁就退出）、`--port=XXXX`（换端口）。**但交付前的最终验证不允许带任何 skip 参数。**

哪一步挂了就停下修，不要往下走。

## Step 2: 浏览器实测

打开上一步打印的地址，走一遍**本次改动涉及的用户流程**。

Expo 的 web 输出是 SPA（产物只有一个 `index.html`），脚本已内置 index.html 回落，所以直接访问 `/settings`、`/focus/xxx` 这类深层路由不会 404 —— 不要据此判断「路由坏了」。

需要确认的点：

- 主路径走通（点击、输入、保存后界面确实变了）；
- 加载态、空态、错误态在界面上**真的渲染出来了**，而不是只抛了异常；
- 改动会失败时，确认界面上出现了预期的失败文案；
- 涉及导航的改动，确认跳转后的页面能正常渲染。

用浏览器工具（截图 / 快照）留证，**必须按 session / 功能建独立子目录存放**：在 `.verify/` 下按本次任务或功能建子文件夹（如 `.verify/<feature-slug>/` 或 `.verify/<session-slug>/`），不要把截图散落在根目录下（`.verify/` 已 gitignore，不要提交）。

## Step 3: 收尾

实测完成后停掉服务器（Ctrl-C，退出码 0 属于正常收尾，不是失败）。

交付说明里写清：跑了哪些命令、实测了哪几个页面/行为、截了哪些图并注明具体的子目录路径（如 `.verify/<feature-slug>/xxx.png`）。**不要**用「单测通过」代替界面行为已验证。

详细清单见 `.trellis/spec/project/quality-guidelines.md` 的「Web 验证门禁」。