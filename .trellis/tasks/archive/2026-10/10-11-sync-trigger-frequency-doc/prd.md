# Document sync trigger timing and frequency (GitHub issue #15)

> 来源 issue：https://github.com/nextdo-app/nextdo/issues/15 「明确数据同步的触发时机与同步频率」

## 背景与问题陈述

目前项目中没有明确说明数据同步的触发时机和同步频率，用户无法确认数据会在什么时候同步，也不知道两次自动同步之间的间隔是多少。

## 目标

把真实的同步行为梳理清楚并在项目文档与设置界面中明确说明，消除用户对「数据是否已同步」的疑问。

## Requirements

- 核实代码中同步的实际行为（同步是由创建/更新/删除后立即触发，还是按计划任务执行）。
- 说明默认同步频率与执行时间。
- 说明是否支持用户手动触发同步，以及入口位置。
- 说明同步失败后的重试策略，以及用户可见的错误提示形态。
- 说明用户是否可以配置同步频率，配置项的边界。
- 把结论同步到项目文档，并在设置界面中以用户可读的方式呈现（入口与文案位置在设计阶段确定）。

## Acceptance Criteria

- [ ] 文档中明确写出同步触发时机（变更后即时 / 定时或两者兼有）。
- [ ] 文档中写明默认同步频率与执行时间点。
- [ ] 文档中写明手动触发同步的方式与失败重试策略。
- [ ] 设置界面中用户能查到上述关键信息（触发时机、频率、是否可配置）。
- [ ] 文档描述与代码实际行为一致，不存在互相矛盾的表述。
- [ ] Web 端实测通过（`pnpm verify:web` 门禁全绿 + 设置界面截图存放在 `.verify/sync-trigger-frequency-doc/`）。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.