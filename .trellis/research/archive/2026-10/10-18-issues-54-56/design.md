# Design: issues #54 / #56 集成与发布

## 1. 集成边界

两个子任务修改的代码区域互不重叠：

- 子任务 1：`apps/mobile/app/focus/[id].tsx`（「时间到」区块）+ 其测试。
- 子任务 2：`apps/mobile/lib/notification-settings.ts`、`lib/reminders/*`、`lib/calendar/*`（新增）、`hooks/use-reminder-delivery.ts`、`app/(tabs)/settings.tsx`、`app/_layout.tsx`、`package.json` / `app.json`（新增 `expo-audio`、`expo-calendar`）。

共同点只有 `focus/[id].tsx`：子任务 2 需要在「时间到」时播放提示音。为避免并行冲突，提示音的**播放调用**由子任务 2 在最后一步接入（子任务 1 先完成布局），父任务负责合并顺序：子任务 1 → 子任务 2。

## 2. 发布与关闭 issue

- 分支：在当前 `release/0.1.8-beta.1` 基础上继续提交（该分支已含 #50/#51 修复）。
- 版本：按 `conventions.md` 的 6 处版本号同步规则 bump（根 `package.json`、`apps/mobile/package.json`、`app.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock` 等，遵循现有脚本）。
- issue 关闭：提交 PR 时在描述中写 `Closes #56 #54`；#50 / #51 在复核确认后用 `gh issue close` 附说明关闭。

## 3. 验证策略

1. 每个子任务先跑各自相关的 jest 用例。
2. 父任务合并后跑 `pnpm verify:web`（lint → typecheck → test → web export）。
3. 浏览器实测：
   - 专注页计时结束的「时间到」视觉与提示音；
   - 设置页提示音/日历分区的开关与权限引导；
   - 既有提醒通知流程回归。
4. 截图存 `.verify/issues-54-56/`，写成 `evidence.md`。

## 4. 风险

- `expo-calendar` / `expo-audio` 是原生模块：Web 构建必须能正常降级（不可在模块顶层 import 原生 API）。设计上通过 `Platform.OS` 分支 + 动态 `import()` 隔离。
- 桌面端（Tauri WebView）没有日历能力：设置页显示降级说明，不渲染开关。
- 提醒音色：OS 通知声音只能引用打包的音频文件，音量受系统控制；应用内播放保持 unity gain（同样跟随系统音量），音色点击即试听。
