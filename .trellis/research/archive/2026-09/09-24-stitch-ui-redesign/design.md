# Design — 按 Paper Serenity 视觉基线重做四屏 UI

> 视觉基线：`stitch_focus_gtd_clarify_app/`（gtd_1–gtd_4 的 **png** 为准，
> gtd_1/gtd_2 目录的 html 与 png 内容对调——html 是另一屏的导出，勿照 html 做）。
> 交互基线：09-23-capture-clarify-flow 的 D1（记一条问一条）+ spec 问题链，不可回归。

## 1. 全局换肤（R1）— `packages/ui` + tailwind + 字体

### 1.1 tokens（`packages/ui/src/tokens/*.json`）

**token 键不变，只换值**（语义类名 `bg-canvas`/`text-ink`/`border-border`/…
全部保持，tailwind.config.js 的映射不动——四屏改动面收敛到布局与组件）。

`colors.json` 新值（浅色取 DESIGN.md 正文值；深色为派生的暖色系，实现时可
微调观感，键名不动）：

| token | 浅色（新） | 来源 | 深色（派生） |
|---|---|---|---|
| canvas | `#faf9f6` | paper-canvas | `#171412` |
| canvasDark 同表 → canvas 的 dark 值按现有键分列：| | | |
| canvasDark | `#171412` | 派生 | — |
| surface | `#ffffff` | paper-surface | `#211d19`（surfaceDark） |
| ink | `#262320` | charcoal-ink | `#ece7df`（inkDark） |
| muted | `#716b64` | charcoal-muted | `#9b948a`（mutedDark） |
| accent | `#c85a17` | 正文陶土值（YAML `#9c3f00` 弃用，PRD 已定） | `#e0703a`（accentDark，深底提亮） |
| onAccent | `#ffffff` | on-primary | `#241509`（onAccentDark，深字配亮陶土） |
| danger | `#ba1a1a` | error | `#ff6b60`（dangerDark） |
| warning | `#a35a12` | 陶土深调（re-clarify 横幅/优先澄清） | `#d98e4a`（warningDark） |
| border | `#e8e5df` | border-warm | `#3a342c`（borderDark） |

**新增**（DESIGN.md 的 5 组土色 chip，供 ContextChip 用，键名 `tag-earth-N-*`）：
`tag-earth-1-bg #f0eee9 / -text #544e47`（原 @Computer）、
`tag-earth-2-bg #edeae3 / -text #5c554c`（@Phone）、
`tag-earth-3-bg #f9ede2 / -text #914d1c`（@Waiting 琥珀）、
`tag-earth-4-bg #edf0ea / -text #44523b`（@Errands 橄榄）、
`tag-earth-5-bg #f2eee7 / -text #61574b`（@Anytime 亚麻）。

`radii.json`（DESIGN 三档：输入/按钮 8、卡片 12–16、pill full；现有类名映射到新值，
组件内类名微调见 §1.4）：`sm 6px / md 8px / lg 12px / xl 14px / 2xl 16px / full 9999px`
（现状 sm6/md10/lg14/xl18/2xl22 → 整体收方 2–6px，符合"手切卡纸"质感）。

`spacing.json` 不变（4/8/12/16/24/44 已对应 DESIGN space-xs…xl）。
`typography.json`（仅信息性参考，tailwind 未消费——保持同步）：
caption 12/16、body 15/24、title 18/26、新增 display 32/40（DESIGN 值）。

### 1.2 tailwind（`apps/mobile/tailwind.config.js`）

- colors/borderRadius 映射不变（自动吃到新 JSON 值）；
- 新增 `fontFamily: { sans: ['Plus Jakarta Sans'], display: ['Epilogue'] }`；
- 新增 10 个 `tag-earth-N-bg/-text` 颜色映射。

### 1.3 字体

- 依赖（`apps/mobile/package.json`，精确版本按 pnpm 解析锁定）：
  `@expo-google-fonts/epilogue`、`@expo-google-fonts/plus-jakarta-sans`。
- 根 `app/_layout.tsx`：`useFonts` 加载两族常用字重
  （Epilogue 500/600/700；Plus Jakarta Sans 400/500/600/700）；
  **未加载完成前渲染占位 View**（canvas 底 + 居中"加载中…"），不渲染 `<Stack>`——
  不加 `expo-splash-screen` 原生依赖（占位即满足"不闪白屏"验收）。
- CJK：RN 的 fontFamily 是单族名，中文走**操作系统逐字回落**
  （iOS PingFang SC / Android Noto CJK / web 浏览器默认）——正是
  DESIGN.md "standard system fallbacks harmonize naturally" 的意图，无需额外配置。
- 全局默认字体的施加：优先试 NativeWind v4 `global.css` 的
  `@layer base { Text { font-family: 'Plus Jakarta Sans'; } }`
  （v4 支持对 RN 核心组件的 base 规则）；web export + 模拟器各验证一次，
  若 native 不生效，退路 = 机械补 `font-sans` 类（对 Text 元素批量加），
  大标题（各屏大标题 / Now hero / 项目名）用 `font-display`（Epilogue）。

### 1.4 `@nextdo/ui` 组件重样式

- `button.tsx`：主按钮陶土（token 已换值，类名不动）；圆角改 DESIGN 8px 档
  （sm/md → `rounded-md`，lg → `rounded-lg`）；active 态保留 `active:opacity-*`。
- `card.tsx`：`rounded-2xl`（=16px 新值）+ `border-border`（=border-warm），不变即可。
- `tag.tsx`：pill 高度 22px（`h-6`→`h-[22px]`）、字号 11px/500（DESIGN badge 规范）。
- `empty-state.tsx`：文字色级按新 token 微调。
- **新组件**（≥2 屏复用 → 按 app/index 清单提升到 `packages/ui`）：
  - `context-chip.tsx`：`export function ContextChip({ name, active, onPress, className })`。
    土色取自 `contextTone(name)`：纯函数把 context 名做稳定散列 → 5 组土色之一
    （同名字永远同色；用户自建情境也有颜色）。完整类名字符串表（NativeWind 要求）：
    `EARTH_TONE_CLASSES: [ 'bg-tag-earth-1-bg text-tag-earth-1-text', … ]`。
    无 `onPress` 时渲染只读 chip（列表行用）。
  - `progress-bar.tsx`：`export function ProgressBar({ value, className })`
    （value ∈ [0,1]，陶土填充 + 细轨道；Projects 进度条与 Clarify 步骤进度共用）。
- `packages/ui/src/index.ts` 导出新增组件 + `contextTone`。

## 2. 收集箱 Inbox（R2）— `app/(tabs)/inbox.tsx`

按 gtd_1 png（信息架构重做，交互不变）：

- 大标题块：`清空大脑`（display 字）+ 副标题"先记下来，不用现在想清楚。"
  （tab 栏标签仍"收件箱"；设计稿的 app 顶栏"Inbox"不搬——Expo Router tab 已有标题位）。
- 捕获卡（Card）：TextInput 占位"有什么事情占据着你现在的注意力？"
  + 提示行"支持自然输入，待会儿逐个澄清"（muted）+ 主按钮
  **`记录并澄清`**（设计稿 CTA"加入收集箱"按 PRD 弃用——会误导用户以为只入箱）。
  保存成功仍走 `handoffToClarify`（R3，行为不动）。
- 计数行：`待处理 {n}` chip（设计稿的"清空预览/快速流程/清空全部"**全部不做**，
  与一条一条流程冲突，PRD 已定）。
- 行（InboxRow 重做）：
  - 标题（base/medium）+ meta 行：`{相对时间}`（新 helper `formatRelativeTime`，§8）
    ；未澄清且 `now - capturedAt > 24h` → 追加 warning 色文字 `优先澄清`
    （文字本身即信号，满足 a11y"颜色不是唯一信号"）。
  - 右侧：`处理 →`（Button tinted → `router.push('/clarify/<id>')`）+
    现有删除（ghost，两次点按确认）保留。整行点按进向导保留（R3）。
- 底部"GTD 澄清心法"说明卡（静态文案，设计稿原文：
  "收集箱不是待办清单，它是大脑的缓冲区。两分钟内能完成的事立即去做，复杂的转化为项目与下一步。"）。
- 捕获弹窗（quick-capture-modal）：仅换肤，行为（onCaptured 交接）不变。
- 列表排序（oldest first）不动。

## 3. Clarify 向导（R2/R3/R5/D5）

### 3.1 纯状态机（`apps/mobile/lib/clarify-flow.ts`）

`WizardBase` 扩展（reducer 保持纯；展示字符串常量放本文件）：

```ts
export type QuestionId = 'q1' | 'q1b' | 'q2' | 'q2b' | 'q3' | 'q3b' | 'q4' | 'q5';
export interface AnsweredQuestion { id: QuestionId; question: string; answer: string }
interface WizardBase { …现有字段; depth: number; answered: AnsweredQuestion[] }
```

- `depth`：已前进行的步数。每个前进转移（answer-*、toForm）+1 并向 `answered`
  追加 `{ id, question: QUESTION_TITLES[id], answer: <答案文案> }`
  （答案文案 = 用户点的那个按钮的文本）。`createWizardState` 置 0/[]。
- **进度常数**（PRD D5）：`export const PROGRESS_MAX: Record<WizardMode, number> =
  { clarify: 7, reclarify: 6 }`（= 该 mode 最长路径步数，含表单步、不含预览步）。
  显示 n = `min(depth + 1, m)`；预览步显示"决策摘要预览"+ 进度条 100%（预览不占 n）。
- **新步骤 `preview`**（D5 独立一步）：

  ```ts
  | { step: 'preview'; form: FormKind; fields: FormFields; twoMinute: boolean;
      projectId?: string; projectTitle?: string; submission: Submission }
  ```

  - 新 action：`{ type: 'preview'; submission: Submission }`（仅 form 步可发；
    payload 走 action，reducer 纯——同 q2b attach 模式）与
    `{ type: 'back-to-form' }`（preview → 还原 form 步，depth 不变——预览是表单的确认相）。
  - **经预览的表单**：`PREVIEW_FORMS = ['action', 'project', 'calendar', 'waiting']`
    （导出；reference/someday/trash 保持直接提交，行为不变）。
- `FormFields` 新增 `contextIds: string[]`（`emptyFields` 置 `[]`；
  `createWizardState(mode, defaultTitle, initialContextIds = [])` 预填——
  re-clarify 用现有行动的 contextIds）。
- `WizardAction` 的 field 重载扩展：`| { type: 'field'; field: 'contextIds'; value: string[] }`。
- `buildFormSubmission`：`action` / `calendar` / `project` 三个分支的 target 均写
  `contextIds: fields.contextIds`（可为 `[]`——db 侧 `target.contextIds ?? []`
  对 `[]` 原样生效；clarify 新行与 reclarify 清空语义一致）。
- 测试（`lib/clarify-flow.test.ts` 补）：depth/answered 沿 q1→q2→q2b→q3→q4→q5→form
  全链递增；preview 往返（form→preview→back→preview 幂等）；contextIds 进
  submission 三分支 × 两 mode（含空数组）；reclarify 预填。

### 3.2 向导界面（`apps/mobile/components/clarify-wizard.tsx`）

按 gtd_2 png 自上而下（**AI 建议卡不做**，R4）：

1. 头部行：状态 Tag（"正在澄清"/"重新明晰"，按 mode）+ 返回按钮（保留）。
2. 条目标题卡：`defaultTitle`（display 字）+ meta 行
   （clarify："收录于 {formatLocalDate} · 收集箱"；reclarify："已有行动"）。
3. 进度行：`步骤 {n}/{m}` + `ProgressBar` + `{pct}%`（§3.1 规则）。
4. 当前问题卡：现有 QuestionCard 重样式（大标题 + 副题 + 大按钮；
   q2b 项目行按 DESIGN 行规范重样式，"当前"标记保留）。**问题内容与顺序不动（R3）。**
5. **"GTD 决策摘要"卡（常驻，问题卡下方）**：按 mode 的问题链
   （clarify: q1…q5 全 8 项；reclarify: q2…q5 共 6 项——q1/q1b 不显示）逐行渲染：
   序号徽标 + 问题 + 答案。已答：陶土高亮 + 答案文字（数据 = `state.answered`）；
   未答：置灰（charcoal-faint 级）。分支未走的题也置灰显示（设计稿同款）。
6. 表单卡（FormCard 重样式）：
   - `action` / `calendar` / `project` 表单新增**情境多选区**（R5）：
     标题"在哪里做？（可多选，不选 = 随处可执行）" + `ContextChip` 可点选组
     （`useContexts()` 数据，种子 5 个 + 用户自建）；
     选中态 = 土色底加深 + 对勾（颜色外加文字/符号信号）。
   - 原"保存"按钮行为分叉：`form ∈ PREVIEW_FORMS` →
     `validateForm` 通过后 `dispatch({ type: 'preview', submission: buildFormSubmission(…) })`
     （**不写库**）；其余表单直接 `submit()`（现状）。
7. **预览卡（`step === 'preview'`）**："决策摘要预览 · 归位就绪"：
   行 = 所属项目（attach 路径显示项目名；project 表单显示新建项目名）/
   标题（行动或等待）/ 执行情境（ContextChips 只读，空 = "随处可执行"）/
   预计耗时 {est} 分钟 / 价值 {value}（action·calendar·project）/ 截止（如有）。
   按钮：`确认保存`（primary → `submit(state.preview.submission)`，成功后 done 步）
   + `上一步修改`（secondary → `back-to-form`）。
8. done 步：`再记一条 / 完成` 不动（R3），仅换肤。

### 3.3 `apps/mobile/hooks/use-action-title.ts`

返回值扩展 `contextIds: string[]`（同一行已查出，零额外查询；
re-clarify 表单预填用）。`ClarifyWizard` 把它传给 `WizardBody` →
`createWizardState`。

### 3.4 测试（`__tests__/clarify-wizard.test.tsx`）

- 进度：答 q1 后显示"步骤 2/7"；reclarify 入口"步骤 1/6"。
- 决策摘要：已答高亮含答案、未答置灰；reclarify 不显示 q1/q1b 行。
- 预览：action 表单保存 → 出现预览卡（未写库：mock `applyClarify` 未调用）→
  确认保存 → 调用一次 → done；上一步修改 → 回表单且字段保留。
  reference/trash 表单保存 → 直接提交（无预览）。
- 情境多选：action 表单勾选 2 个 chip → 预览显示 2 个 chip；
  reclarify 预填现有 contextIds。
- 回归：q2b 三向、完成步两按钮、do-now 路径（现有断言随文案同步更新）。

## 4. 项目 Projects（D4）

### 4.1 db（`packages/db`）

`queries/watch-queries.ts` 新增（与 `projectsWatchQuery` 同款模式：
单语句 + 标量子查询，PowerSync 表依赖跟踪对两个表都触发）：

```ts
export interface ProjectCard extends Project {
  openCount: number;
  completedCount: number;          // 非删除、status='completed'
  earliestOpenDeadline: string | null;
  lastProgressAt: string | null;   // completion_records 经项目行动的最大 completed_at
  nextAction: {                    // "当前下一步行动"
    id: string; title: string; contextIds: string[];
    deadline: string | null; estMinutes: number;
  } | null;
}
export function projectCardsWatchQuery(db: NextdoDb): CompilableQuery<ProjectCard>
```

- 标量子查询（均为 `next_actions na` 关联 `projects.id`、`deleted_at IS NULL`）：
  `open_count`（status open）、`completed_count`（status completed）、
  `earliest_open_deadline`（open 且 deadline IS NOT NULL 的 MIN）、
  `last_progress_at`
  （`(SELECT MAX(cr.completed_at) FROM completion_records cr JOIN next_actions na ON na.id = cr.action_id WHERE na.project_id = projects.id AND na.deleted_at IS NULL)`——
  完成审计表见 schema `completion_records`；next_actions 本身无 completed_at 列）、
  next-action top-1：同一 `ORDER BY (na.deadline IS NULL) ASC, na.deadline ASC,
  na.created_at ASC LIMIT 1` 的 5 个标量子查询（id/title/deadline/est_minutes/
  context_ids——deadline 空排最后、同级按捕获时间，与"最早的、最确定的先做"一致）。
- mapper：`progress = completedCount / (openCount + completedCount)`（分母 0 → 0）
  在**屏上**算（组件只消费 count）；`context_ids` 用 `parseJson<string[]>` 解析。
- **停滞**：`queries/reviews.ts` 的 `isStalled` + `STALL_DAYS` 加 `export`
  （不改逻辑）；`stalled` 标志**在屏上**用 `useAppClock()` 的 now 计算
  （watch mapper 不会随分钟 tick 重跑——时间敏感派生留在 UI 层，
  先例：`shouldOfferReclarify` 从 `use-now.ts` 导出纯 helper）。
- 测试（`packages/db/src/test/queries.projects.test.ts` 补，fixtures 已有项目/行动/
  完成记录）：progress 1/4、earliest deadline 取 open 最小、next-action 排序
  （deadline 空最后 → created_at）、无 open 行动 → nextAction null /
  openCount 0、lastProgressAt 取完成记录最大值、isStalled 复用（14 天边界）。

### 4.2 hook + 屏

- 新 hook `apps/mobile/hooks/use-project-cards.ts`
  （`useQuery(projectCardsWatchQuery(db))`，模式同 `useProjects`）+
  `useAppClock`；导出纯 helper `isProjectStalled(card, now)`
  （= `isStalled(card.lastProgressAt, card.createdAt, now) && card.status === 'active'`）。
- `app/(tabs)/projects.tsx` 重做（gtd_3 png）：
  - 头部："项目"大标题 + 副题"需要多个行动才能完成的具体结果。每个进行中的项目
    都应有一个明确的下一步。" + `{n} 进行中` chip。
  - **筛选 chips**（本地 state，计数实时派生）：
    `进行中 {active}`（默认）/ `无下一步 {active 且 openCount=0}` /
    `已归档 {status ≠ active}`（done/dropped/on-hold）。
  - 行卡（ProjectCardRow）：
    - 标题 + 截止 chip（`earliestOpenDeadline` → `截止 {M月D日}`；无 → 不显示）；
    - `ProgressBar`（completed/(open+completed)）+ `{completed}/{total} 行动`；
    - "当前下一步行动"子卡（有 nextAction 时）：▶ 图标 + 标题 +
      `ContextChip` 只读组 + 截止（如有，`formatDueLabel`）；
    - 警告区：`openCount === 0` → 琥珀卡"缺少下一步 · 项目处于停滞风险"
      （停滞与否都显示）+ 按钮`澄清下一步` → `router.push('/projects/<id>')`
      （项目详情现有 AddActionForm 承接）；
      否则 `stalled` → 灰 Tag"14 天无进展"。
  - `+ 新建项目（明确具体成果）`：现有 `NewProjectForm` 保留换肤。
    注意：该内联表单只建项目（`useAddProject` → `addProject`，**不建首个
    行动**），情境属行动属性，此表单**不加**情境字段——情境多选取在向导
    的项目表单（原子建项目+首行动，§3.2 已覆盖）与项目详情 AddActionForm
    不涉（R5 范围 = 向导 action/calendar 表单）。
- 项目详情 `app/projects/[id].tsx`：行动行加 `ContextChip` 只读组
  （PRD 验收要求"项目详情行内 chips"；`useProjectActions` 返回的行动已带 contextIds）。

## 5. 下一步 Now（D2）— `app/(tabs)/now.tsx`

**hero 优先**（PRD D2）：现有推荐单条 hero（Tag 行 + 大标题 + 副题 +
"为什么是它？" + 开始/换一个/稍后）行为与数据源**完全不动**，仅按 DESIGN 重样式。

自上而下：EngineContextBar（引擎输入，保留重样式）→ re-clarify 横幅（保留）→
**新增统计行** → hero → **新增情境过滤 chips** → **可执行列表（常展开）** →
习惯条（保留）。

- **统计行**（Card，三格）：
  - `可执行 {eligible.length}/{eligible.length + filtered.length} 项`；
  - `预计耗时 {Σ eligible estMinutes} 分钟`；
  - `认知负荷 {轻|平|重}`：纯 helper `cognitiveLoadLabel(totalMinutes)`
    （`lib/` 新文件 `cognitive-load.ts` + 单测）：<60 轻 / 60–180 平 / >180 重
    （PRD 已定的三档近似，设计稿"平稳"同款语义）。
- **情境过滤 chips**（本地 UI state，**独立于引擎 context**——只影响列表区，
  不影响 hero 推荐，PRD 验收项）：`全部` + 每个 Context 实体（`useContexts()`）
  一个 chip，**纯名称、无计数**（2026-09-24 用户决定：计数看着不好看，
  原设计的 `{n}` 计数取消）。选中一个 context → 列表只显示匹配项
  （多选 = 并集）；无情境行动随处可执行，穿过任何过滤。
- **可执行列表**（现有 EligibleList 常展开化 + 重做行）：
  标题 + 项目 chip（`projectTitles`，无项目不显示）+ `ContextChip` 只读组 +
  截止 chip（`formatDueLabel`：今天/明天/{M月D日}；无 → muted"随时"）+
  行内`稍后`（SnoozeSheet）/`删除`（现有 mutation hooks）。
  过滤后为空 → EmptyState"没有匹配当前情境的可执行事项"。
- 测试（`__tests__/now-screen.test.tsx` 补 + 回归）：统计行数值（mock pool：
  5/8、Σ est、负荷档）、chip 过滤（选中/取消/并集/空态）、hero 断言回归。

## 6. Context 种子（支撑 R5）

spec（domain-model.md）声明 Context "Seeded: home, office, computer, phone,
outside"，但**代码里从来没有种子逻辑**（`useContexts` 只有 quick-create；
db 测试 fixtures 手工插入）。fresh DB 上向导的情境 chips 会是空的——补上：

- `packages/db/src/queries/contexts.ts` 新增：

  ```ts
  export async function seedDefaultContexts(db: NextdoDb, now: Date): Promise<number>
  // 无任何未删除 context 行 → 插入 5 个默认（ulid(now) id、now 时间戳），返回插入数；
  // 否则 no-op 返回 0（用户删光的 5 个不重种——尊重用户意图）。幂等。
  ```

- 调用点：`apps/mobile/app/_layout.tsx` 的 `start()`，`powersync.init()` +
  stream 之后：`await seedDefaultContexts(wrapDb(powersync), new Date())`
  （try/catch 非致命，warn 日志——根 layout 导入 @nextdo/db 是 database-guidelines
  允许的唯一例外位置）。
- `packages/db/src/index.ts` 导出；db 单测：fresh 库种 5 个（名 = home/office/
  computer/phone/outside）、二次调用 no-op、已有用户情境 → no-op。

## 7. tab 栏

`(tabs)/_layout.tsx` 仅换色（accent/muted/surface/border 走新 token 自动生效）；
**保持纯文字 4 tab**（设计稿 5 tab 按 D2 收敛；图标资产不在 v1 范围）。

## 8. 格式 helper（`apps/mobile/lib/format.ts`）

- `formatRelativeTime(iso, now)`：`刚刚`（<60s）/ `{n} 分钟前`（<60m）/
  `今天 HH:mm` / `昨天 HH:mm` / `{M月D日}`（Inbox 行 meta）。
- `formatDueLabel(iso | null, now)`：null → `随时`；今天 → `今天`；明天 → `明天`；
  否则 `{M月D日}`（Now 行 + Projects 截止 chip）。
- 新 `lib/format.test.ts` 单测（device-local 边界：今天/昨天/跨月）。

## 9. 错误文案

无新 db 错误码（不新增校验），`lib/error-messages.ts` 不动。

## 10. 兼容与回滚

- 全部为**增量/换肤**：token 值替换（键不动）、ui 组件重样式 + 2 个新组件、
  状态机新增字段/步骤（旧路径语义不变）、1 个新 watch 查询、1 个种子函数、
  4 屏重布局。**无 schema 变更、无引擎变更、无同步层变更**
  （种子 context 是普通用户数据行，走既有上传链路）。
- 旧数据零影响（contextIds 列本就存在且可空语义 = `[]`）。
- 回滚 = 分支回退，无迁移。

## 11. 风险

1. **字体加载**：`@expo-google-fonts/*` 与 expo 57 / RN 0.86 的兼容性以安装解析
   结果为准（精确版本锁定）；CJK 回落在 web（Tauri）下用浏览器默认 CJK 字体，
   需 `expo export --platform web` 后肉眼确认无方块。
2. **NativeWind base 字体规则**在 native 端是否生效不确定（v4 文档支持
   `@layer base` 目标 RN 组件）——§1.3 有退路（机械补 `font-sans`），
   实现时先跑通退路判定再批量。
3. **watch 查询多标量子查询**：单语句模式有现成先例（`projectsWatchQuery`），
   但 top-1 五连写需注意 ORDER BY 完全一致；db 测试覆盖排序。
4. **预览步把 `Submission` 放进 reducer state**：纯数据（core/db 的 plain
   interface），无副作用；注意不要在 preview 步重复 build（以 state 里的为准）。
5. **测试churn**：4 个屏测试 + 向导测试的文案/结构断言需同步更新——
   行为断言（跳转、提交、过滤）保留，只换文案常量。
6. gtd_1/gtd_2 的 **html 与 png 对调**：一律以 png 为准（已在头部标注）。
7. 深色模式：派生深色值首版以"不穿帮"为标准（对比度 ≥ 正文可读），
   手测 system dark 下四屏 + 弹窗。

## 12. 二轮反馈修订（2026-09-24 用户手测反馈）

两处修订（均不改行为，只改表单交互与视觉）：

### 12.1 表单日期/时间改用"时间框"组件（不再手输 ISO）

- 新组件 `apps/mobile/components/datetime-picker.tsx`（`DateTimePicker`）：
  纯 RN modal（遵循 quick-capture-modal 的 modal 惯例：透明背景 + 居中卡），
  点选 chip 网格——日期 = 年/月/日 三行、时间 = 时/分 两行（24/60 全量
  平铺，无滚动），`确定` 提交 / `取消` 关闭。
- 为什么不用 `@react-native-community/datetimepicker`：web 平台官方实现
  什么都不渲染（warn + return null），而桌面壳正是 web 构建——故自实现
  全平台一致的纯 RN picker，**不引入任何新 native 依赖**。
- 作用范围：向导表单的全部日期/时间字段——开始日期 / 开始时间（calendar）、
  截止（calendar / action）、期望日期（waiting）。字段值仍是
  `'YYYY-MM-DD'` / `'HH:mm'` 字符串 → **clarify-flow 状态机、校验、提交
  组装全部不动**（字符串契约不变）；可选字段带"清除"按钮。
- calendar 表单的预览步新增"开始"行（`composeLocalDateTimeIso` 组装 +
  `formatLocalDateTime` 格式化），保存前可核对所选结果。

### 12.2 Tag 配色对齐设计基线 + 两个可选元素

- 原 Tag tone 为半透明浅染（`bg-accent/15` 等），与设计稿"实底暖色"不符，
  改为实底暖色（新 token）：

  | tone | light | dark |
  |---|---|---|
  | neutral | `surface-container` #f5ece3 + muted | `surface-container-dark` + ink-dark |
  | accent | `secondary-fixed` #ffdcc1 + accent | `secondary-fixed-dark` + accent-dark |
  | warning | earth-3 琥珀（#f9ede2 / #914d1c） | warning-dark 浅染（不变） |
  | danger | 不变 | 不变 |

- 两个新可选属性：`dot`（设计稿"正在澄清"badge 的小陶土圆点——向导头部使用）
  与 `count`（设计稿"待处理"控制的实心小圆计数）。
- Inbox 计数行：`待处理 {n}` 文字 chip → `<Tag label="待处理" count={n} />`
  （§2"单 chip、不做清空预览/快速流程"的决策不变）。
- 这是全局 tone 换色：所有屏（Projects / Now / Review / Focus…）的 Tag
  自动换成设计配色，其余结构不动。
