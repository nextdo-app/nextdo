/**
 * 应用更新检查（设置 → 检查更新）。
 *
 * 版本源是本仓库的 GitHub Release。**所有对外地址都必须先加
 * `UPDATE_PROXY_PREFIX` 加速前缀再请求/打开**——直连 GitHub 在国内极慢
 * 甚至超时，而代理对 `github.com` 能正常转发（已实测）。因此本文件里出现的
 * 每一个 GitHub 原始地址都只作为 `viaProxy()` 的拼接素材，永远不会被直接
 * fetch / openURL。
 *
 * ## 为什么查版本不用 GitHub API
 *
 * 最早的实现请求 `api.github.com/repos/…/releases/latest`。它在国内浏览器里
 * 是坏的：加速代理是**共享出口 IP**，而 GitHub 的未认证 API 限额是每 IP 每
 * 小时 60 次 —— 代理 IP 很快就被打满，实测直接返回
 * `403 API rate limit exceeded`（见 `.trellis/spec/project/quality-guidelines.md`
 * 的同款记录）。未认证的客户端应用也无法附带 token，限额无解。
 *
 * 现在走的是 `github.com/<repo>/releases/latest`：它对「最新 release」做一次
 * 302 跳到 `/releases/tag/vX.Y.Z`，页��本身由 CDN 提供，不受 API 限额影响。
 * fetch 会透明地跟随跳转，最终地址就在 `response.url` 里 —— 从中取 tag 即可，
 * 一次请求、不解析 HTML。
 *
 * 安装包地址按 `<tag>` + 固定文件名规则**拼出来**，不再从 API 的 assets 列表读。
 * release 流水线（`.github/workflows/release.yml`）对每个平台的文件名是确定
 * 的，且上传用 `if-no-files-found: error`，所以「tag 存在 = 该平台安装包存在」
 * 成立。代价是万一某个平台当次没产出，按钮会 404 —— 所以「查看全部安装包」
 * 这个入口任何时候都渲染，用户总能自己找到文件。
 *
 * 本模块负责 URL 拼接、版本号比较、tag 解析、按平台拼安装包，以及唯一一次
 * 网络调用 `fetchLatestRelease()`；平台探测与当前版本读取也在这里（都不需要
 * React）。Settings 页面只通过 `useAppUpdate` 读结果，不直接触碰本模块的
 * 网络部分（component-guidelines：屏幕不碰平台模块）。
 */
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

/** 唯一的 release 源仓库。 */
export const UPDATE_REPO = 'nextdo-app/nextdo';

/** 下载加速代理前缀。**一切对外请求都拼在它后面，绝不直连 GitHub。 */
export const UPDATE_PROXY_PREFIX = 'https://proxyd.picpi.top/';

/** 「最新 release」入口的原始地址（仅作拼接素材，不直接请求）——它会 302 到带 tag 的地址。 */
const RELEASE_LATEST = `https://github.com/${UPDATE_REPO}/releases/latest`;

/** release 页面（原始地址，仅作拼接素材，不直接打开）。 */
const RELEASE_PAGE = `https://github.com/${UPDATE_REPO}/releases/latest`;

/** releases.atom feed 原始地址（包含包含预发布版在内的所有 release 记录）。 */
const RELEASES_ATOM = `https://github.com/${UPDATE_REPO}/releases.atom`;

/** release 资源下载前缀（原始地址，仅作拼接素材）。 */
const RELEASE_DOWNLOAD = `https://github.com/${UPDATE_REPO}/releases/download`;

/** 版本查询超时（毫秒）。国内网络抖动常见，超时后按失败提示而不是一直转圈。 */
const REQUEST_TIMEOUT_MS = 10_000;

/** 给一个 GitHub 原始地址套上加速代理前缀。 */
export function viaProxy(url: string): string {
  return `${UPDATE_PROXY_PREFIX}${url}`;
}

/** 实际请求「最新版本」的地址。 */
export function latestReleaseUrl(): string {
  return viaProxy(RELEASE_LATEST);
}

/** 实际请求 releases.atom feed 的地址。 */
export function releasesAtomUrl(): string {
  return viaProxy(RELEASES_ATOM);
}

/** 实际打开的 release 页面地址（可选指定 tag，未指定时打开 latest）。 */
export function releasePageUrl(tag?: string): string {
  if (tag !== undefined && tag.trim() !== '') {
    return viaProxy(`https://github.com/${UPDATE_REPO}/releases/tag/${tag.trim()}`);
  }
  return viaProxy(RELEASE_PAGE);
}

/* ------------------------------------------------------------------ *
 * 版本号比较
 * ------------------------------------------------------------------ */

interface ParsedVersion {
  core: number[];
  prerelease: string | null;
}

/** 拆版本号：去 `v` 前缀，数字段与预发布后缀分开。 */
function parseVersion(value: string): ParsedVersion {
  const [core = '', ...rest] = value.trim().replace(/^v/i, '').split('-');
  const coreNumbers = core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return {
    core: coreNumbers,
    prerelease: rest.length > 0 ? rest.join('-') : null,
  };
}

/**
 * 比较两个版本号：`-1` 左小、`0` 相等、`1` 左边新。
 *
 * 数字段逐位比较（缺失位按 0 补齐，所以 `0.2` == `0.2.0`）；数字段全等时
 * 正式版高于预发布版（`0.1.4` > `0.1.4-beta.1`），两个预发布版按字符串比。
 * 预发布版低于同号正式版这条正是本应用的日常场景：本地跑的是
 * `0.1.3-beta.1`，仓库最新 release 是 `v0.1.3`。
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i += 1) {
    const leftPart = left.core[i] ?? 0;
    const rightPart = right.core[i] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  // 无预发布后缀 = 正式版，排在其余预发布版之后。
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease > right.prerelease ? 1 : -1;
}

/* ------------------------------------------------------------------ *
 * 版本渠道识别（Issue #14 核心机制）
 * ------------------------------------------------------------------ */

/** 应用版本发布渠道。 */
export type ReleaseChannel = 'stable' | 'beta' | 'alpha' | 'rc' | 'dev';

/**
 * 根据版本号解析其所属的发布渠道。
 *
 * - 纯三段数字（如 0.1.4）为 stable（正式版）。
 * - 包含 -beta.N 为 beta（测试版）。
 * - 包含 -alpha.N 为 alpha（内测版）。
 * - 包含 -rc.N 为 rc（候选发布版）。
 * - 其他预发布标识归为 dev（开发版）。
 */
export function getReleaseChannel(version: string): ReleaseChannel {
  const parsed = parseVersion(version);
  if (parsed.prerelease === null) return 'stable';
  const lower = parsed.prerelease.toLowerCase();
  if (lower.startsWith('beta')) return 'beta';
  if (lower.startsWith('alpha')) return 'alpha';
  if (lower.startsWith('rc')) return 'rc';
  return 'dev';
}

/** 判断给定版本号是否为预发布/测试版本。 */
export function isPrerelease(version: string): boolean {
  return parseVersion(version).prerelease !== null;
}

/** 获取发布渠道的中文显示标签。 */
export function getChannelLabel(channel: ReleaseChannel): string {
  switch (channel) {
    case 'beta':
      return '测试版';
    case 'alpha':
      return '内测版';
    case 'rc':
      return '候选版';
    case 'dev':
      return '开发版';
    case 'stable':
      return '正式版';
  }
}

/* ------------------------------------------------------------------ *
 * tag 解析 + 按平台拼安装包
 * ------------------------------------------------------------------ */

/** 解析出来的最新 release。 */
export interface LatestRelease {
  /** 原始 tag（形如 `v0.1.4`）。 */
  tag: string;
  /** 去掉 `v` 前缀的版本号。 */
  version: string;
}

/** 一个可下载的安装包（URL 已带加速代理前缀）。 */
export interface ReleaseDownload {
  label: string;
  url: string;
}

/**
 * 从「跳转后的最终地址」里取 tag。
 *
 * `https://github.com/<repo>/releases/latest` 302 到 `…/releases/tag/v0.1.3`，
 * fetch 透明跟随后最终地址就是这个。代理会把原始 URL 整段包在
 * `https://proxyd.picpi.top/` 后面，所以这里不锚定域名，只认路径里的
 * `/releases/tag/<tag>` —— 代理换域名也不会失效。
 *
 * 取不到就返回 `null`（调用方落到「解析失败」），绝不抛异常。
 */
export function parseLatestTag(finalUrl: string): string | null {
  const match = /\/releases\/tag\/([^/?#]+)/.exec(finalUrl);
  if (match === null || match[1] === undefined) return null;
  const tag = decodeURIComponent(match[1]);
  return tag.replace(/^v/i, '') === '' ? null : tag;
}

/**
 * 从 GitHub releases.atom feed 的 XML 文本中提取 release tag 列表（按 feed 顺序）。
 *
 * Atom Feed 每个 entry 均有形如 `/releases/tag/<tag>` 的 link 或 id：
 * `<link rel="alternate" type="text/html" href="https://github.com/.../releases/tag/v0.1.5-beta.3"/>`
 * 纯正则提取，不引入第三方 XML 解析库以保持体积轻量。
 */
export function parseAtomFeedTags(atomXml: string): string[] {
  const matches = atomXml.matchAll(/\/releases\/tag\/([^"/?#\s]+)/g);
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const rawTag = match[1];
    if (rawTag !== undefined && rawTag !== '') {
      const decoded = decodeURIComponent(rawTag);
      if (!seen.has(decoded)) {
        seen.add(decoded);
        tags.push(decoded);
      }
    }
  }
  return tags;
}

/**
 * 根据发布渠道从 tag 候选列表中挑选最新版本。
 *
 * 渠道过滤规则：
 * - stable: 仅接受正式版（如 v0.1.4）。
 * - beta: 接受测试版（beta）与正式版（stable）。
 * - alpha: 接受内测版（alpha）、测试版（beta）与正式版（stable）。
 * - rc: 接受候选版（rc）与正式版（stable）。
 * - dev: 接受所有渠道版本。
 *
 * 在符合条件的候选 tag 中，使用 `compareVersions` 挑选版本号最高的一个返回。
 */
export function pickLatestReleaseForChannel(
  tags: string[],
  channel: ReleaseChannel,
): LatestRelease | null {
  const isCandidate = (candidateChannel: ReleaseChannel): boolean => {
    switch (channel) {
      case 'stable':
        return candidateChannel === 'stable';
      case 'beta':
        return candidateChannel === 'beta' || candidateChannel === 'stable';
      case 'alpha':
        return candidateChannel === 'alpha' || candidateChannel === 'beta' || candidateChannel === 'stable';
      case 'rc':
        return candidateChannel === 'rc' || candidateChannel === 'stable';
      case 'dev':
        return true;
    }
  };

  let bestTag: string | null = null;
  let bestVersion: string | null = null;

  for (const tag of tags) {
    const version = tag.replace(/^v/i, '');
    const candChannel = getReleaseChannel(version);
    if (!isCandidate(candChannel)) continue;

    if (bestVersion === null || compareVersions(version, bestVersion) > 0) {
      bestTag = tag;
      bestVersion = version;
    }
  }

  if (bestTag === null || bestVersion === null) return null;
  return { tag: bestTag, version: bestVersion };
}

/**
 * 安装包命名规则：release 流水线给每个平台产出的文件名后缀（与版本号无关，
 * 所以跨版本通用）。见 `.github/workflows/release.yml`。
 */
const DOWNLOADS_BY_PLATFORM = {
  windows: [{ suffix: '_x64-setup.exe', label: 'Windows 安装程序' }],
  linux: [
    { suffix: '_amd64.deb', label: 'Linux · deb' },
    { suffix: '_amd64.AppImage', label: 'Linux · AppImage' },
  ],
  android: [{ suffix: '_android_arm64-v8a.apk', label: 'Android 安装包' }],
} as const satisfies Record<string, ReadonlyArray<{ suffix: string; label: string }>>;

/** macOS 的两个 CPU 架构各自对应的文件后缀。 */
const MAC_SUFFIX: Record<MacArch, { suffix: string; label: string }> = {
  aarch64: { suffix: '_aarch64.dmg', label: 'macOS 安装包（Apple 芯片）' },
  x86_64: { suffix: '_x64.dmg', label: 'macOS 安装包（Intel）' },
};

/** 有安装包可下的平台；`macos` 不在其中（它按架构单独挑，见 `pickDownloads`）。 */
export type DownloadPlatform = keyof typeof DOWNLOADS_BY_PLATFORM;

/** 运行平台（用于挑选安装包）。 */
export type UpdatePlatform = DownloadPlatform | 'macos' | 'ios' | 'web';

/**
 * 按 release 的 tag 拼出当前平台可用的安装包（URL 已加代理前缀）。
 *
 * `macos` 只在 `macArch` 已知时给**一个**包：macOS 的 .dmg 不通用，下错架构
 * 装不上。探测不到架构时返回空数组，由设置页退化成「去 release 页自选」，
 * 绝不把两个架构一起丢给用户让他猜。
 */
export function pickDownloads(
  release: LatestRelease,
  platform: UpdatePlatform,
  macArch: MacArch | null = null,
): ReleaseDownload[] {
  const version = release.version;
  if (platform === 'macos') {
    if (macArch === null) return [];
    const rule = MAC_SUFFIX[macArch];
    return [
      {
        label: rule.label,
        url: viaProxy(`${RELEASE_DOWNLOAD}/${release.tag}/Nextdo_${version}${rule.suffix}`),
      },
    ];
  }
  const rules = DOWNLOADS_BY_PLATFORM[platform as DownloadPlatform];
  if (rules === undefined) return [];
  return rules.map((rule) => ({
    label: rule.label,
    url: viaProxy(`${RELEASE_DOWNLOAD}/${release.tag}/Nextdo_${version}${rule.suffix}`),
  }));
}

/* ------------------------------------------------------------------ *
 * 运行环境探测
 * ------------------------------------------------------------------ */

/**
 * 当前运行的平台。原生直接读 `Platform.OS`；web（含 Tauri 桌面壳）从 UA 判
 * 操作系统——裸 `window` / `navigator` 不在 Expo 的 lib 类型里，必须走
 * `globalThis` 的带类型视图（hook-guidelines Rule 4）。
 *
 * 注意判序：Android / iOS 的 UA 里也含 `Linux` / `Mac OS X` 字样，所以必须
 * 先按 `Platform.OS` 短路，否则网页版在手机上会被判成 Linux 桌面。
 */
export function detectUpdatePlatform(): UpdatePlatform {
  const host = globalThis as {
    window?: { navigator?: { userAgent?: string } };
  };
  const os = host.window?.navigator?.userAgent ?? '';
  const platformName = Platform.OS;

  if (platformName === 'ios') return 'ios';
  if (platformName === 'android') return 'android';
  if (platformName !== 'web') return 'web';

  if (/windows|win32|win64/i.test(os)) return 'windows';
  if (/mac ?os|macintosh/i.test(os)) return 'macos';
  if (/linux|x11|cros/i.test(os)) return 'linux';
  return 'web';
}

/** 本机当前版本号（读 app.json 的 `version`）；读不到时返回空串。 */
export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

/** 本机当前应用版本所属渠道。 */
export function currentAppChannel(): ReleaseChannel {
  return getReleaseChannel(currentAppVersion());
}

/**
 * macOS 的 CPU 架构。`.dmg` 按架构分发的，所以必须知道本机是哪种，
 * 否则用户要么下错装不上，要么被两个按钮逼着猜。
 */
export type MacArch = 'aarch64' | 'x86_64';

/** Tauri IPC 桥的最小形状（照抄 reminders/adapters/tauri.ts 的约定，不引 `@tauri-apps/api`）。 */
interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

function normalizeArch(value: unknown): MacArch | null {
  // Rust 侧回 `std::env::consts::ARCH`（aarch64 / x86_64），
  // 浏览器 UA 高熵字段回 'arm' / 'x86' —— 两种写法都归一化。
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (normalized === 'aarch64' || normalized === 'arm' || normalized === 'arm64') return 'aarch64';
  if (normalized === 'x86_64' || normalized === 'x86' || normalized === 'x64') return 'x86_64';
  return null;
}

/**
 * 探测 macOS 架构；探测不到返回 `null`（调用方据此退化成 release 页链接，
 * 而不是猜一个架构）。
 *
 * 两条路，顺序有讲究：
 *
 * 1. **Tauri 桌面壳** —— 问 Rust 侧（`current_arch` 命令）。这是唯一在
 *    WKWebView 里可靠的来源：WKWebView 的 UA 不含 CPU 架构，Safari 也一样。
 * 2. **浏览器** —— `navigator.userAgentData` 的高熵 `architecture`。只有
 *    Chromium 系（Chrome / Edge）实现，Safari 没有这个 API。
 *
 * 探测失败（没有桥、没有 userAgentData、字段缺失）一律 resolve 成 `null`，
 * 绝不 reject：架构只影响下哪个安装包，探测不了不该让「检查更新」整体失败。
 */
export async function detectMacArch(): Promise<MacArch | null> {
  const host = globalThis as {
    window?: {
      __TAURI_INTERNALS__?: TauriInternals;
      navigator?: {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
        };
      };
    };
  };
  const bridge = host.window?.__TAURI_INTERNALS__;
  if (bridge?.invoke !== undefined) {
    try {
      return normalizeArch(await bridge.invoke('current_arch'));
    } catch {
      // 桌面壳是旧版本（没有这个命令）→ 落到浏览器那条路。
    }
  }
  const getHighEntropyValues = host.window?.navigator?.userAgentData?.getHighEntropyValues;
  if (getHighEntropyValues === undefined) return null;
  try {
    const values = await getHighEntropyValues.call(host.window!.navigator!.userAgentData!, [
      'architecture',
    ]);
    return normalizeArch(values?.architecture);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 网络
 * ------------------------------------------------------------------ */

/** 检查失败的原因（屏幕据此给中文文案，逻辑层不持有文案）。 */
export type UpdateFailureReason = 'network' | 'http' | 'payload';

/** `fetchLatestRelease` 的结果——不抛异常，调用方按 `ok` 分支。 */
export type LatestReleaseResult =
  | { ok: true; release: LatestRelease }
  | { ok: false; reason: UpdateFailureReason };

/**
 * 从 GitHub `/releases/latest` 请求最新的正式版本。
 */
async function fetchReleaseFromLatest(): Promise<LatestReleaseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(latestReleaseUrl(), {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) return { ok: false, reason: 'http' };
    const tag = parseLatestTag(response.url);
    if (tag === null) return { ok: false, reason: 'payload' };
    return { ok: true, release: { tag, version: tag.replace(/^v/i, '') } };
  } catch {
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 GitHub `releases.atom` Feed 提取指定渠道的最新版本。
 */
async function fetchReleaseFromAtom(channel: ReleaseChannel): Promise<LatestReleaseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(releasesAtomUrl(), {
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'http' };
    const text = await response.text();
    const tags = parseAtomFeedTags(text);
    const release = pickLatestReleaseForChannel(tags, channel);
    if (release === null) return { ok: false, reason: 'payload' };
    return { ok: true, release };
  } catch {
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 请求指定发布渠道的「最新版本」。地址带加速代理前缀，超时 10 秒。
 *
 * 策略：
 * 1. 若为 stable（正式版），直接查 releases/latest（快速 302 跟随，且 GitHub 保证只返回最新正式版）。
 * 2. 若为非正式版渠道（如 beta、alpha 等）：GitHub 的 releases/latest 接口只返回正式版，
 *    会忽略所有预发布版本（如 beta.4）。因此优先从 releases.atom feed 拿全量 release 列表挑选对应渠道版本；
 *    若 atom 请求或解析异常，平滑降级回退到 releases/latest 兜底。
 *
 * 失败分三类：`network`（连不上/超时/被 CORS 拦）、`http`（代理返回非 2xx）、
 * `payload`（没有找到符合渠道的 release tag）。
 */
export async function fetchLatestRelease(
  channel: ReleaseChannel = 'stable',
): Promise<LatestReleaseResult> {
  if (channel === 'stable') {
    return fetchReleaseFromLatest();
  }

  const atomResult = await fetchReleaseFromAtom(channel);
  if (atomResult.ok) {
    return atomResult;
  }

  // 降级兜底：如果 atom feed 访问失败或未匹配到，尝试 releases/latest
  const latestResult = await fetchReleaseFromLatest();
  if (latestResult.ok) {
    return latestResult;
  }

  // 均失败时返回 atom 的错误原因
  return atomResult;
}

/**
 * 打开外部链接。
 *
 * 在 Tauri 桌面端壳内，WKWebView/WebView2 默认拦截 window.open 弹窗；
 * 此时通过 Tauri IPC bridge 调用原生的 `open_url` 命令打开系统默认浏览器。
 * 在移动端或普通浏览器中，优雅回落到 React Native 的 `Linking.openURL`。
 */
export async function openExternalUrl(url: string): Promise<void> {
  const host = globalThis as {
    window?: {
      __TAURI_INTERNALS__?: TauriInternals;
    };
  };
  const bridge = host.window?.__TAURI_INTERNALS__;
  if (bridge?.invoke !== undefined) {
    try {
      await bridge.invoke('open_url', { url });
      return;
    } catch {
      // 若桌面壳命令异常，回落到 Linking.openURL
    }
  }
  await Linking.openURL(url);
}

/* ------------------------------------------------------------------ *
 * 桌面端应用内下载
 *
 * 桌面端（Tauri 壳）支持在应用内直接下载安装包并自动打开安装程序，
 * 不需要跳到浏览器。三个函数分别对应 Rust 侧的三个 Tauri 命令。
 * 非 Tauri 环境下（纯浏览器 / 移动端）这些函数不应被调用——调用方
 * 先用 `isTauriDesktop()` 判断。
 * ------------------------------------------------------------------ */

/** Rust 侧 `get_download_progress` 返回的结构体。 */
export interface DesktopDownloadProgress {
  /** `idle` | `downloading` | `done` | `error` */
  state: 'idle' | 'downloading' | 'done' | 'error';
  /** 已下载字节数。 */
  downloaded_bytes: number;
  /** 文件总字节数（服务端不给 Content-Length 时为 0）。 */
  total_bytes: number;
  /** 下载完成后的本地文件路径（仅 done 状态有值）。 */
  file_path: string;
  /** 错误描述（仅 error 状态有值）。 */
  error: string;
}

/** 当前是否运行在 Tauri 桌面壳内。 */
export function isTauriDesktop(): boolean {
  const host = globalThis as {
    window?: { __TAURI_INTERNALS__?: TauriInternals };
  };
  return host.window?.__TAURI_INTERNALS__?.invoke !== undefined;
}

/**
 * 启动桌面端后台下载。`url` 是已加代理前缀的安装包完整地址。
 *
 * 调用后前端应立即开始用 `pollDesktopDownloadProgress()` 轮询进度。
 * 重复调用在下载进行中会被 Rust 侧静默忽略（幂等）。
 */
export async function startDesktopDownload(url: string): Promise<void> {
  const host = globalThis as {
    window?: { __TAURI_INTERNALS__?: TauriInternals };
  };
  const bridge = host.window?.__TAURI_INTERNALS__;
  if (bridge?.invoke === undefined) {
    throw new Error('Not running in Tauri desktop shell');
  }
  await bridge.invoke('download_update', { url });
}

/** 轮询下载进度。返回 Rust 侧的 `DownloadProgress` 结构体快照。 */
export async function pollDesktopDownloadProgress(): Promise<DesktopDownloadProgress> {
  const host = globalThis as {
    window?: { __TAURI_INTERNALS__?: TauriInternals };
  };
  const bridge = host.window?.__TAURI_INTERNALS__;
  if (bridge?.invoke === undefined) {
    return { state: 'idle', downloaded_bytes: 0, total_bytes: 0, file_path: '', error: '' };
  }
  return (await bridge.invoke('get_download_progress')) as DesktopDownloadProgress;
}

/** 用系统默认程序打开已下载的安装包（macOS 挂 DMG、Windows 执行 EXE 等）。 */
export async function openDownloadedInstaller(filePath: string): Promise<void> {
  const host = globalThis as {
    window?: { __TAURI_INTERNALS__?: TauriInternals };
  };
  const bridge = host.window?.__TAURI_INTERNALS__;
  if (bridge?.invoke === undefined) {
    throw new Error('Not running in Tauri desktop shell');
  }
  await bridge.invoke('open_downloaded_file', { filePath });
}