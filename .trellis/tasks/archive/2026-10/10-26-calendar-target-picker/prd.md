# 支持选择 Google / iCloud 等系统日历作为同步目标

## Goal

让用户从系统已有的日历中选择同步目标，从而把提醒写进 Google 日历或 iCloud 日历

## Requirements

- R1 设置页提供「写入哪个日历」选择器，列出系统日历数据库里的所有可写日历（含已登录的 Google、iCloud 与本地日历），并标出账号来源。
- R2 首项为「Nextdo 默认日历」——保留现有行为（自建 `Nextdo` 日历）。
- R3 选择持久化在设备本地的同步状态里（`preferredCalendarId`），不进 PowerSync：日历 id 只在本机的系统数据库里有意义。
- R4 同步时优先写入用户选的日历；选的日历被删除、账号退出或变为只读时，回退到默认目标而不是静默丢失提醒。
- R5 只读日历（订阅日历、节假日）不出现在选择器里。
- R6 不新增任何 Google / Apple 账号授权流程：Nextdo 只写系统日历，由系统自行同步到云端账号。

## Acceptance Criteria

- [x] AC-1 选了 Google 日历后，提醒事件写进该日历，不再新建 Nextdo 日历。
- [x] AC-2 选的日历消失或只读 → 回退到 Nextdo 默认日历，仍能写入。
- [x] AC-3 没有选择时行为与改动前一致（复用或创建 Nextdo 日历）。
- [x] AC-4 选择器展示账号来源，同名日历可区分。
- [x] AC-5 `pnpm lint` / `pnpm typecheck` / 移动端测试全绿。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
