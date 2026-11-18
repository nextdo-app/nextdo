# 工具链版本（TypeScript / ESLint / Prettier / Jest / @types/node）（2026-09-21 核实）

> 核实方式：npm registry 元数据（`npm view ... time` 取发布与版本线）。
>
> 版本策略（见 prd）：所有 workspace 的 `package.json` 一律**精确版本**（禁止 `^`/`~`）；下表"锁定版本"列即要写入的精确值。

## 结论速查

| 依赖 | 锁定版本 | 说明 |
|---|---|---|
| `typescript` | `6.0.3`（6.0.x 最新） | **见下方 TS 版本冲突分析**——不要用 npm overall latest 7.0.2 |
| `eslint` | `10.11.0`（overall latest；10.0.0 发布于 2026-02-06） | flat config 仍是唯一默认格式 |
| `@eslint/js` | `10.0.1` | flat config 配套 |
| `typescript-eslint` | `8.70.0` | peer：`eslint ^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0`，`typescript >=4.8.4 <6.1.0` |
| `prettier` | `3.9.8`（2026-09-17 发布） | v3 线稳定 |
| `jest` | `29.7.0`（29.x 最终版） | **必须 29**：jest-expo 57.0.5 是 Jest 29 系（详见 versions-expo.md §3） |
| `@types/node` | `24.13.6` | 与 Node 24 配套（见 versions-node.md）；overall latest 26.6.2 对应 Node 26 |

## TypeScript 版本冲突分析（重要）

npm 上 `typescript` 的 `latest` 已经是 **7.0.2**（微软原生（Go）重写版 "Corsa" 转正），同时存在 `beta: 6.0.0-beta`（旧 JS 编译器的 6.0 beta）。三条线并存：

- **5.x**：最终版 5.9.3（保守线）。
- **6.0.x**：最新 6.0.3 —— **Expo SDK 57 官方模板（expo-template-default@57.0.26）pin 的就是 `typescript ~6.0.3`**。
- **7.0.x**：最新 7.0.2（`latest` tag）—— 原生编译器，但：
  - `typescript-eslint@8.70.0` 的 peer 上限是 **`<6.1.0`**，**不支持 TS 7**；
  - jest-expo / babel 生态对 TS 7 无官方验证记录。

**建议：精确 pin `typescript 6.0.3`**（Expo 57 模板写 `~6.0.3`，按仓库策略钉其下限 6.0.3）。被 typescript-eslint 8.70 完整支持、且 6.x 与 5.x 语法检查行为基本兼容。TS 7 的采用留作独立升级任务。
注意：根 `pnpm add -D typescript` 若不带版本会拉到 7.0.2，必须显式写 `6.0.3`。

## ESLint 9 vs 10

- 任务描述里的 "ESLint 9" 已落后一个 major：**ESLint 10.0.0 于 2026-02-06 发布**，当前 latest **10.11.0**（2026-09-18）。
- flat config 在 9 成为默认、10 中继续是唯一配置形式（eslintrc 已在 9 移除）。
- `typescript-eslint@8.70.0` 同时支持 eslint 8/9/10（peer `^8.57.0 || ^9.0.0 || ^10.0.0`）。
- 建议：**精确 pin `eslint 10.11.0` + `@eslint/js 10.0.1` + `typescript-eslint 8.70.0`**（仓库策略：`package.json` 禁止 `^`/`~`），flat config（`eslint.config.js`/`.mjs`）。**当前 pin 一律用 10.11.0，不要退到 9.x**；eslint 9.x 仅作为"未来若要降 major"的历史备选记录（仍在 typescript-eslint 8.70 支持范围内）。
- 已知 10.x 生态适配风险：**unverified**（未见主流框架声明不兼容 ESLint 10 的公告；scaffold 时以 `pnpm lint` 全绿为准）。

## Jest 与 jest-expo 兼容关系

- jest 整体 latest = **30.5.2**（30.0.0 发布于 2025-06-10）。
- 但 **jest-expo 57.0.5 的内部依赖全部是 jest 29 组件**（`babel-jest ^29.2.1`、`jest-environment-jsdom ^29.2.1`、`@jest/globals ^29.2.1`、`jest-snapshot ^29.2.1`），peer 不含 jest 30。
- 结论：根 devDep pin **`jest 29.7.0`**（29.x 最终版）+ `jest-expo 57.0.5`（精确 pin）；jest 30 与本栈不兼容，勿升级（jest-expo 58 是否切到 jest 30：unverified，与本项目无关）。
- 非 Expo 包（packages/core、packages/db、server/app）的纯 TS 测试也可以用同一份 jest 29.7.0（ts-jest 29 或 babel-jest），保持全仓单一 jest 大版本。

## Prettier

- latest = **3.9.8**（2026-09-17）。v3 线（3.0 起无 breaking 小版本演进）稳定。
- 与 ESLint 的冲突交给 `eslint-config-prettier`（精确 pin **10.1.8**，scaffold 时 `pnpm add -D eslint-config-prettier@10.1.8` 并跑 lint 验证）。

## @types/node

- 随 Node 运行时走：**Node 24 → `@types/node@24.13.6`**（24.x 线最新）。
- 22.x 线最新 22.20.4（若最终选 Node 22）；overall latest 26.6.2 对应 Node 26（Current，不选）。
- `@types/react`：精确 pin `19.2.2`（Expo 57 模板写 `~19.2.2`；19.2.x 线最新 19.2.18，按策略不浮动；19.3.0 对应 React 19.3 / SDK 58 线，不要用）。

## 来源 URL

- https://www.npmjs.com/package/typescript （latest 7.0.2；5.9.3；6.0.3）
- https://www.npmjs.com/package/typescript-eslint （8.70.0，peer eslint/TS 范围）
- https://www.npmjs.com/package/eslint （10.11.0；10.0.0 发布 2026-02-06）
- https://www.npmjs.com/package/@eslint/js （10.0.1）
- https://www.npmjs.com/package/prettier （3.9.8，2026-09-17）
- https://www.npmjs.com/package/jest （30.5.2；29.7.0 为 29 线终点）
- https://www.npmjs.com/package/jest-expo （57.0.5，deps 全为 jest 29 组件）
- https://www.npmjs.com/package/@types/node （26.6.2 latest；24.13.6 / 22.20.4）
- https://www.npmjs.com/package/expo-template-default （sdk-57 模板 pin typescript ~6.0.3 / @types/react ~19.2.2）
