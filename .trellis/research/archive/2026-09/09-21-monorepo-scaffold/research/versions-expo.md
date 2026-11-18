# Expo / React Native 版本锁定（2026-09-21 核实）

> 核实方式：npm registry 元数据（`npm view`）+ Expo 官方文档版本表 + npm 官方模板包 `expo-template-default`（dist-tag `sdk-57`）。
>
> 版本策略（见 prd）：本仓库 `package.json` 一律精确版本（禁止 `^`/`~`）；下表"锁定版本"列为要写入的精确值（官方模板自身用 `~` 的，钉其下限版本）。

## 结论速查

| 依赖 | 锁定版本 | 状态 |
|---|---|---|
| `expo` | `57.0.24`（SDK 57） | latest 稳定版（2026-09-18 发布） |
| `react` / `react-dom` | `19.2.3`（精确） | 官方模板固定值 |
| `react-native` | `0.86.3`（精确） | 官方模板固定值 |
| `react-native-web` | `0.21.0` | 官方模板固定值 |
| `expo-router` | `57.0.22`（npm latest） | 稳定 |
| `expo-secure-store` | `57.0.4`（npm latest） | 稳定 |
| `jest-expo` | `57.0.5`（npm latest） | 稳定；**Jest 29 系**（见下） |
| `react-native-reanimated` | `4.5.1`（精确） | 官方模板固定值 |
| `react-native-worklets` | `0.10.1`（精确） | 官方模板固定值（reanimated 4 的配套包，SDK 57 起需要） |
| `react-native-gesture-handler` | `2.32.0` | 官方模板固定值 |
| `react-native-screens` | `4.26.0` | 官方模板固定值 |
| `react-native-safe-area-context` | `5.7.0` | 官方模板固定值 |
| `@types/react` | `19.2.2`（19.2.x 最新 = 19.2.18，按策略不浮动） | 官方模板固定值 |
| `typescript` | `6.0.3` | 官方模板固定值（详见 versions-tooling.md 的 TS 版本冲突分析） |
| NativeWind | `4.2.7`（latest 稳定） | 见下 |
| `tailwindcss` | `3.4.19`（3.x 最终版） | NativeWind 4 的 peer 是 `~3` |

## 关键事实

### 1. Expo SDK 57 是 2026-09 当前最新稳定 SDK

- `expo@57.0.24` = npm `latest`；SDK 57.0.0 发布于 2026-06-30。
- `expo@58.0.0-preview.3` = `next`/`sdk-58` 预发布，**不要用**。
- 官方版本表（https://docs.expo.dev/versions/latest/）：SDK 57.0.0 → RN 0.86 / React 19.2.3 / react-native-web 0.21.0 / **最低 Node.js 22.13.x**。
- **最低 Node 22.13 与 spec 里写死的 Node 20 冲突**（且 Node 20 已 EOL，详见 versions-node.md）。scaffold 必须把 Node 提到 ≥22.13，建议 24 LTS。

### 2. 精确配套版本以官方模板为准

`expo-template-default@57.0.26`（npm dist-tag `sdk-57`，即 `npx create-expo-app` 默认模板）的 package.json：

```jsonc
{
  "dependencies": {
    "expo": "~57.0.24", "react": "19.2.3", "react-dom": "19.2.3",
    "react-native": "0.86.3", "react-native-web": "~0.21.0",
    "expo-router": "~57.0.22", "expo-constants": "~57.0.19",
    "react-native-reanimated": "4.5.1", "react-native-worklets": "0.10.1",
    "react-native-gesture-handler": "~2.32.0",
    "react-native-screens": "~4.26.0",
    "react-native-safe-area-context": "~5.7.0"
  },
  "devDependencies": { "typescript": "~6.0.3", "@types/react": "~19.2.2" }
}
```

来源：`npm view expo-template-default@57.0.26 dependencies devDependencies`（https://www.npmjs.com/package/expo-template-default）

### 3. jest-expo 57 仍是 Jest 29 系

- `jest-expo@57.0.5` 的 dependencies 全部是 jest 29 组件（`babel-jest ^29.2.1`、`jest-environment-jsdom ^29.2.1`、`@jest/globals ^29.2.1`、`react-test-renderer 19.2.3`）。
- peerDependencies：`expo *`、`react-native *`、`@react-native/jest-preset ^0.86.3`、`react-server-dom-webpack ~19.0.4 || ~19.1.5 || ~19.2.4`。
- 因此根工程 pin **jest 29.7.0**（29.x 最终版，2023-09-12）。npm 上 jest 整体 latest 是 30.5.2（30.0.0 发布于 2025-06-10），但 jest-expo 57 未跟进 Jest 30 —— **不要装 jest 30**。（jest-expo 58 是否支持 Jest 30：unverified，不影响本任务。）

### 4. NativeWind：稳定版仍是 4.2.7，v5 处于 RC

- `nativewind@4.2.7` = `latest`（**2026-09-14 发布**，非常新的稳定版）。
- 依赖 `react-native-css-interop@0.2.7`，其 peerDependencies：`react >=18`、`tailwindcss ~3`、`react-native-reanimated >=3.6.2`、`react-native *` —— 与 RN 0.86.3 / React 19.2.3 / reanimated 4.5.1 范围兼容。
- `nativewind@5.0.0-rc.0`（2026-09-13 发布）只存在于 `rc`/`preview`/`rc-staging` tag，peer 是 `tailwindcss >4.1.11` + `react-native-css 3.1.0-rc.0` —— **RC 状态，scaffold 不采用**。
- 注意事项：
  - NativeWind 4 需要 Babel 插件 + Metro 配置（`babel-preset-expo` 已内建支持 NW4 的 preset 选项；按 nativewind 文档加 `nativewind/babel` preset 与 metro transformer）。
  - nativewind 4.2.7 的 README **没有**显式声明 "Expo SDK 57 / RN 0.86 已验证" —— 兼容性是从 peer 范围推断的，vendor 级验证状态 **unverified**，scaffold 时应跑一次真实构建验证。
  - tailwindcss 用 **3.4.19**（3.x 最终版）；tailwindcss 4.3.3 存在但只给 NativeWind 5（RC）用。

## 来源 URL

- https://docs.expo.dev/versions/latest/ （SDK↔RN↔React↔Node 版本表，官方）
- https://www.npmjs.com/package/expo （57.0.24 latest，58.0.0-preview.3 next）
- https://www.npmjs.com/package/expo-template-default （dist-tag `sdk-57` = 57.0.26，模板精确依赖）
- https://www.npmjs.com/package/jest-expo （57.0.5，deps/peers）
- https://www.npmjs.com/package/nativewind （4.2.7 latest；5.0.0-rc.0 rc）
- https://www.npmjs.com/package/expo-router （57.0.22）
- https://www.npmjs.com/package/expo-secure-store （57.0.4）
