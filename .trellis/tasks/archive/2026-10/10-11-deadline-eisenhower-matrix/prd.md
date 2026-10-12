# Deadlines for projects and actions with Eisenhower matrix ordering (GitHub issue #16)

> 来源 issue：https://github.com/nextdo-app/nextdo/issues/16 「为项目和行动增加截止时间，并基于四象限原则优化行动安排」

## 背景与问题陈述

目前项目和行动缺少明确的截止时间，用户无法直观看到事项需要在何时完成，也难以根据时间压力安排当前行动。

## 目标

为项目和行动增加截止时间能力，并让行动安排综合考虑重要性与紧急性，落实四象限原则：

1. 重要且紧急
2. 不重要但紧急
3. 重要但不紧急
4. 不重要且不紧急

## Requirements

- 项目支持设置、修改和清除截止时间。
- 行动支持设置、修改和清除截止时间。
- 在项目详情与行动详情中展示截止时间。
- 行动列表 / 待办视图能识别临近截止和已逾期的行动。
- 行动排序或推荐逻辑综合考虑重要性、紧急性与截止时间。
- 对即将到期和已逾期的行动提供清晰的视觉状态提示。
- 截止时间未设置时保持合理默认行为，不阻塞现有项目和行动的使用。

## 四象限安排规则

系统依据重要性与截止时间推导行动所属象限，并按下列顺序安排：

1. 重要且紧急 → 优先处理
2. 不重要但紧急 → 及时处理或委派
3. 重要但不紧急 → 安排计划
4. 不重要且不紧急 → 延后处理或减少关注

## Acceptance Criteria

- [ ] 用户可以为项目设置、编辑和移除截止时间。
- [ ] 用户可以为行动设置、编辑和移除截止时间。
- [ ] 截止时间在相关详情和列表界面中正确展示。
- [ ] 系统能区分未到期、临近到期、已逾期三种状态，且「临近」的阈值有明确定义。
- [ ] 行动可按重要性、紧急性和截止时间排序或分组。
- [ ] 排序结果符合「重要且紧急 → 不重要但紧急 → 重要但不紧急 → 不重要且不紧急」的优先顺序。
- [ ] 未设置截止时间的项目和行动仍可正常使用。
- [ ] 现有数据的迁移与兼容策略明确，不影响已有项目与行动。
- [ ] Web 端实测通过（`pnpm verify:web` 门禁全绿 + 浏览器截图存放在 `.verify/deadline-eisenhower-matrix/`）。

## 相关范围

需要同时评估数据模型、创建 / 编辑表单、详情展示、列表排序、提醒，以及相关 API 和客户端交互。跨层改动较大，实施前应先补 `design.md`。

## Out of Scope

- 与「版本渠道 / tag」相关的发布流程改动（GitHub issue #14，用户正在单独处理）。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.