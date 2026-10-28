# 提醒同一时刻重复推送：派发按任务+时刻去重

## Goal

同一条提醒在微信（PushPlus）里连续收到三条内容完全相同的消息。线上 Worker 长期停留在单次投递修复之前的版本，且派发去重只看单条 reminder 行；收敛为「一个任务的同一时刻只发一条」。

## Requirements

- R1 线上 Worker 与仓库 main 的提醒派发逻辑一致：先部署含单次投递修复的版本。
- R2 一个任务的同一时刻，无论数据库里存在几条重复的 reminder 行，只向外部通道发送一条消息。
- R3 去重键为 `(action_kind, action_id, fires_at)`：同一任务、同一触发时刻视为同一条提醒；不同时刻、不同任务各自独立投递。
- R4 不改变「一个通道成功即停止（失败回退下一通道）」的既有契约；不引入数据库唯一约束，避免 PowerSync 客户端上传重复行时被 Postgres 拒绝而产生同步错误。
- R5 客户端已有的自愈行为不变：`reconcileReminder` 在下次编辑时只保留每个时刻的一行，其余置为 `cancelled`。

## Acceptance Criteria

- [x] AC-1 生产 Worker 部署到含单次投递修复的版本（部署时间晚于 `2026-10-27` 的修复提交）。
- [x] AC-2 两条属于同一 `(action_kind, action_id, fires_at)` 的 reminder 行只产生一次 send；行数更多时同理（单测覆盖）。
- [x] AC-3 不同任务的同刻提醒仍然各自发送；「多渠道只发一次」「失败回退」用例不回归。
- [x] AC-4 `server/app` typecheck 与全量 jest 通过。
- [x] AC-5 部署后 `/health` 返回 `{"status":"ok"}`，部署列表出现新版本记录。

## Notes

- 复现材料：用户在微信收到三条完全相同、同一时刻的推送；线上仅配置 `NEXTDO_PUSHPLUS_TOKEN` 一个外部通道（`wrangler secret list`），因此三条消息必然来自三次独立派发（三条 reminder 行）。
- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
