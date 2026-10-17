# 执行计划：表单字段常显标签

## 步骤

1. [x] 新增 `apps/mobile/components/form-field.tsx`（`label` + 可选 `className`），标签在控件上方常显。
2. [x] 项目详情页四个内联表单加标签（`app/projects/[id].tsx`：添加行动 / 编辑项目 / 编辑行动 / 新建项目习惯）。
3. [x] 项目 Tab 新建项目表单加标签（`app/(tabs)/projects.tsx`）。
4. [x] 习惯创建与编辑表单加标签，并把时间窗口改成两个并排的 `FormField className="flex-1"`（`app/habits.tsx`、`components/edit-habit-form.tsx`）。
5. [x] 等待事项、新场景、设置高级设置两个地址框加标签（`app/waiting.tsx`、`app/contexts.tsx`、`app/(tabs)/settings.tsx`）。
6. [x] 规范更新：`.trellis/spec/app/component-guidelines.md` 新增「Forms (field labels)」（Phase 3.3）。
7. [ ] 门禁 + 浏览器实测（本任务收尾）：
   - `pnpm lint` / `pnpm typecheck` / `pnpm test`
   - `node scripts/verify-web.mjs --port=4180`（门禁 + 构建 + 常驻服务）
   - `node .verify/form-field-labels/capture.mjs`（真实流程截图 → `.verify/form-field-labels/`）
   - 核验要点写入 `.verify/form-field-labels/evidence.md`
8. [ ] Phase 3.4：提交计划发给用户确认后，按顺序 add + commit（不 amend、不 push），随后提示 `/finish-work`。

## 校验命令

```bash
pnpm lint && pnpm typecheck && pnpm test        # 门禁（root，全部 workspace）
node scripts/verify-web.mjs --port=4180         # 门禁 + expo web 构建 + 静态服务器
node .verify/form-field-labels/capture.mjs      # headless Chrome 截图（需上面的服务器在跑）
```

## 复核门（review gates）

- 门禁三连必须全绿（含 mobile 41 套件 / 626 用例），任何一项红即回到步骤 2–5 修。
- 截图必须覆盖 PRD 的 AC-1 ~ AC-4，且每张截图里字段**处于已填写状态**仍能看到字段名 —— 这正是本次要证明的行为。
- `.verify/` 是 gitignore 目录，截图与脚本不入库；交付说明里给出目录与文件名。

## 回滚点

- 单一回滚点：`components/form-field.tsx` + 7 个调用点属于同一次展示层改动，整条 commit revert 即恢复原状（无数据/迁移/配置影响）。
