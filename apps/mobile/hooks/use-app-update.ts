/**
 * 「检查更新」按钮背后的状态机（设置页最后一个卡片）。
 *
 * 只做一件屏幕做不了的事：把 `lib/app-update` 的双渠道请求/比较结果翻译成
 * `checking` + 渠道偏好 + 一次结论与版本选择等 UI 状态。
 * 网络调用留在 `lib/app-update`，hook 只调它。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canInstallUpdateInApp,
  compareVersions,
  currentAppVersion,
  detectAndroidAbi,
  detectMacArch,
  detectUpdatePlatform,
  downloadAndroidUpdate,
  fetchDualChannelReleases,
  getAutoUpdateCheckPreference,
  getChannelLabel,
  getReleaseChannel,
  getUpdateChannelPreference,
  installAndroidUpdate,
  installDesktopUpdateAndRestart,
  isPrerelease,
  isTauriDesktop,
  openDownloadedInstaller,
  pickDownloads,
  pollDesktopDownloadProgress,
  releasePageUrl,
  setAutoUpdateCheckPreference,
  setUpdateChannelPreference,
  startDesktopDownload,
  type AndroidAbi,
  type DesktopDownloadProgress,
  type MacArch,
  type ReleaseChannel,
  type ReleaseDownload,
  type ReleaseInfo,
  type UpdateChannelPreference,
  type UpdateFailureReason,
} from '@/lib/app-update';

/** 可用的更新版本项（展示渠道、版本号、发布日期与对应安装包）。 */
export interface AvailableUpdateOption {
  channel: ReleaseChannel;
  channelLabel: string;
  tag: string;
  version: string;
  publishedAt: string | null;
  downloads: ReleaseDownload[];
  isPreferred: boolean;
  isNewerThanCurrent: boolean;
  notes: string | null;
}

/** 一次检查的结论。 */
export type UpdateOutcome =
  /** 本机已经是最新的。 */
  | {
      kind: 'up-to-date';
      latestVersion: string;
      channel?: ReleaseChannel;
      channelLabel?: string;
      stableRelease: ReleaseInfo | null;
      betaRelease: ReleaseInfo | null;
    }
  /** 有新版本，`downloads` 是当前选中版本在当前平台能用的安装包。 */
  | {
      kind: 'available';
      latestVersion: string;
      downloads: ReleaseDownload[];
      options: AvailableUpdateOption[];
      selectedVersion: string;
      stableRelease: ReleaseInfo | null;
      betaRelease: ReleaseInfo | null;
    }
  /** 检查失败，`reason` 供屏幕选文案。 */
  | { kind: 'failed'; reason: UpdateFailureReason };

/** 桌面端应用内下载的状态（非桌面端不使用）。 */
export type DownloadState =
  | { kind: 'idle' }
  | { kind: 'downloading'; downloadedBytes: number; totalBytes: number }
  | { kind: 'done'; filePath: string }
  | { kind: 'error'; error: string };

export interface UseAppUpdateResult {
  /** 本机当前版本（app.json 的 `version`；读不到时是空串）。 */
  currentVersion: string;
  /** 当前版本所属发布渠道（stable / beta / alpha / rc / dev）。 */
  channel: ReleaseChannel;
  /** 当前发布渠道的中文标签（正式版 / 测试版 / 等）。 */
  channelLabel: string;
  /** 用户选择的更新渠道偏好（stable / beta）。 */
  preferredChannel: UpdateChannelPreference;
  /** 切换并持久化更新渠道偏好。 */
  setPreferredChannel: (pref: UpdateChannelPreference) => Promise<void>;
  /** 是否开启自动检查更新（默认开启）。 */
  autoCheckEnabled: boolean;
  /** 切换并持久化自动检查更新偏好。 */
  setAutoCheckEnabled: (enabled: boolean) => Promise<void>;
  /** 检查进行中（按钮禁用 + 「检查中…」）。 */
  checking: boolean;
  /** 上一次检查的结论；还没查过是 `null`。 */
  outcome: UpdateOutcome | null;
  /** 当前选中的更新版本号。 */
  selectedVersion: string | null;
  /** 切换选中的更新版本。 */
  selectVersion: (version: string) => void;
  /** 手动触发一次双渠道检查。 */
  check: () => void;
  /** release 页面地址（已加加速代理前缀），供「查看全部安装包」用。 */
  pageUrl: string;
  /** 是否运行在 Tauri 桌面壳中（决定是否显示应用内下载按钮）。 */
  isDesktop: boolean;
  /** 是否能走应用内安装（桌面壳或带原生模块的安卓构建）。 */
  canInstallInApp: boolean;
  /** 桌面端应用内下载状态。 */
  download: DownloadState;
  /** 桌面端启动应用内下载（传入安装包 URL）。 */
  startDownload: (url: string) => void;
  /** 桌面端打开已下载的安装包。 */
  openInstaller: () => void;
  /** 桌面端一键自动安装并重启。 */
  installUpdate: () => void;
  /** 正在执行安装重启。 */
  installing: boolean;
  /** 自动安装失败的错误信息。 */
  installError: string | null;
}

let activePollTimer: ReturnType<typeof setInterval> | null = null;
let currentPollId = 0;

/** 停止当前的桌面端下载进度轮询（跨测试/跨组件实例清理用）。 */
export function stopDesktopUpdatePolling(): void {
  if (activePollTimer !== null) {
    clearInterval(activePollTimer);
    activePollTimer = null;
  }
  currentPollId++;
}

export function useAppUpdate(): UseAppUpdateResult {
  // 版本号 / 平台在一次会话里不变，所以不是 state——避免无谓的重渲染。
  const currentVersion = currentAppVersion();
  const channel = getReleaseChannel(currentVersion);
  const channelLabel = getChannelLabel(channel);
  const platform = detectUpdatePlatform();
  const isDesktop = isTauriDesktop();
  // 安卓构建：下载 APK 后直接调起系统安装器（模块缺失时退回浏览器下载）。
  const canInstallInApp = canInstallUpdateInApp();

  const [preferredChannel, setPreferredChannelState] = useState<UpdateChannelPreference>(
    channel !== 'stable' ? 'beta' : 'stable',
  );
  const [autoCheckEnabled, setAutoCheckEnabledState] = useState(true);

  // 架构要问系统（桌面壳走 IPC，浏览器走 UA 高熵字段），是异步的，所以是 state。
  const [macArch, setMacArch] = useState<MacArch | null>(null);
  // 安卓的 CPU ABI（决定下载哪个 .apk）；探测前默认 arm64-v8a。
  const [androidAbi, setAndroidAbi] = useState<AndroidAbi>('arm64-v8a');
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState>({ kind: 'idle' });
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void getUpdateChannelPreference().then((pref) => {
      if (mountedRef.current) setPreferredChannelState(pref);
    });
    void getAutoUpdateCheckPreference().then((enabled) => {
      if (mountedRef.current) setAutoCheckEnabledState(enabled);
    });
    return () => {
      mountedRef.current = false;
      stopDesktopUpdatePolling();
    };
  }, []);

  useEffect(() => {
    if (platform === 'android') {
      void detectAndroidAbi().then((abi) => {
        if (mountedRef.current) setAndroidAbi(abi);
      });
    }
  }, [platform]);

  useEffect(() => {
    if (platform !== 'macos') return;
    void detectMacArch().then((arch) => {
      if (mountedRef.current) setMacArch(arch);
    });
  }, [platform]);

  const setPreferredChannel = useCallback(async (pref: UpdateChannelPreference) => {
    setPreferredChannelState(pref);
    await setUpdateChannelPreference(pref);
  }, []);

  const setAutoCheckEnabled = useCallback(async (enabled: boolean) => {
    setAutoCheckEnabledState(enabled);
    await setAutoUpdateCheckPreference(enabled);
  }, []);

  const check = useCallback(() => {
    if (checking) return;
    setChecking(true);
    void Promise.all([
      fetchDualChannelReleases(),
      macArch !== null
        ? Promise.resolve(macArch)
        : platform === 'macos'
          ? detectMacArch()
          : Promise.resolve(null),
    ]).then(([result, resolvedArch]) => {
      if (!mountedRef.current) return;
      setChecking(false);
      if (resolvedArch !== null && macArch === null) {
        setMacArch(resolvedArch);
      }
      if (!result.ok) {
        setOutcome({ kind: 'failed', reason: result.reason });
        return;
      }

      const { stable, beta } = result.releases;
      const stableDownloads =
        stable !== null ? pickDownloads(stable, platform, resolvedArch, androidAbi) : [];
      const betaDownloads =
        beta !== null ? pickDownloads(beta, platform, resolvedArch, androidAbi) : [];

      const stableIsNewer =
        stable !== null && (currentVersion === '' || compareVersions(stable.version, currentVersion) > 0);
      const betaIsNewer =
        beta !== null && (currentVersion === '' || compareVersions(beta.version, currentVersion) > 0);

      const options: AvailableUpdateOption[] = [];
      if (stableIsNewer && stable !== null) {
        options.push({
          channel: 'stable',
          channelLabel: '正式版',
          tag: stable.tag,
          version: stable.version,
          publishedAt: stable.publishedAt,
          downloads: stableDownloads,
          isPreferred: preferredChannel === 'stable',
          isNewerThanCurrent: true,
          notes: stable.notes,
        });
      }
      if (betaIsNewer && beta !== null) {
        options.push({
          channel: beta.channel,
          channelLabel: beta.channelLabel,
          tag: beta.tag,
          version: beta.version,
          publishedAt: beta.publishedAt,
          downloads: betaDownloads,
          isPreferred: preferredChannel === 'beta',
          isNewerThanCurrent: true,
          notes: beta.notes,
        });
      }

      if (options.length === 0) {
        // 两个渠道均无更高新版本
        const isBetaPreferred = preferredChannel === 'beta';
        const targetRelease = isBetaPreferred ? (beta ?? stable) : (stable ?? beta);
        const targetChannel: ReleaseChannel = isBetaPreferred
          ? (beta?.channel ?? (isPrerelease(currentVersion) ? getReleaseChannel(currentVersion) : 'beta'))
          : (stable?.channel ?? 'stable');
        const targetChannelLabel = getChannelLabel(targetChannel);

        let latestVersion = targetRelease?.version ?? currentVersion;
        if (isBetaPreferred) {
          if (beta !== null) {
            latestVersion = beta.version;
            if (isPrerelease(currentVersion) && compareVersions(currentVersion, latestVersion) > 0) {
              latestVersion = currentVersion;
            }
          } else if (isPrerelease(currentVersion)) {
            latestVersion = currentVersion;
          }
        } else {
          if (stable !== null) {
            latestVersion = stable.version;
            if (!isPrerelease(currentVersion) && compareVersions(currentVersion, latestVersion) > 0) {
              latestVersion = currentVersion;
            }
          }
        }

        setOutcome({
          kind: 'up-to-date',
          latestVersion,
          channel: targetChannel,
          channelLabel: targetChannelLabel,
          stableRelease: stable,
          betaRelease: beta,
        });
        setSelectedVersion(null);
        return;
      }

      // 默认选中项：优先用户设定的偏好渠道，若偏好渠道无新版则选另一渠道
      const defaultOption =
        options.find((opt) => (preferredChannel === 'beta' ? opt.channel === 'beta' : opt.channel === 'stable')) ??
        options[0]!;

      setSelectedVersion(defaultOption.version);
      setOutcome({
        kind: 'available',
        latestVersion: defaultOption.version,
        downloads: defaultOption.downloads,
        options,
        selectedVersion: defaultOption.version,
        stableRelease: stable,
        betaRelease: beta,
      });
    });
  }, [androidAbi, checking, currentVersion, macArch, platform, preferredChannel]);

  const selectVersion = useCallback(
    (targetVersion: string) => {
      setSelectedVersion(targetVersion);
      setOutcome((prev) => {
        if (!prev || prev.kind !== 'available') return prev;
        const matching = prev.options.find((opt) => opt.version === targetVersion);
        if (!matching) return prev;
        return {
          ...prev,
          selectedVersion: matching.version,
          latestVersion: matching.version,
          downloads: matching.downloads,
        };
      });
    },
    [],
  );

  /** 开始应用内下载：桌面端轮询 Tauri 的进度，安卓走 expo-file-system 的回调。 */
  const startDownload = useCallback(
    (url: string) => {
      if (!isDesktop && !canInstallInApp) return;
      if (download.kind === 'downloading') return;
      setDownload({ kind: 'downloading', downloadedBytes: 0, totalBytes: 0 });

      if (canInstallInApp) {
        void downloadAndroidUpdate(url, (progress) => {
          if (mountedRef.current) {
            setDownload({
              kind: 'downloading',
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
            });
          }
        })
          .then(async (fileUri) => {
            if (mountedRef.current) {
              setDownload({ kind: 'done', filePath: fileUri });
              setInstallError(null);
              // 安卓端下载完成自动调起系统安装器
              setInstalling(true);
              try {
                await installAndroidUpdate(fileUri);
              } catch (err) {
                if (mountedRef.current) {
                  setInstallError(err instanceof Error ? err.message : String(err));
                }
              } finally {
                if (mountedRef.current) {
                  setInstalling(false);
                }
              }
            }
          })
          .catch((e) => {
            if (mountedRef.current) {
              setDownload({ kind: 'error', error: String(e) });
            }
          });
        return;
      }

      void startDesktopDownload(url).catch((e) => {
        if (mountedRef.current) {
          setDownload({ kind: 'error', error: String(e) });
        }
      });

      // 停止任何先前的轮询，分配新的 pollId
      stopDesktopUpdatePolling();
      const pollId = currentPollId;

      // 开始轮询进度
      const checkProgress = () => {
        if (!isTauriDesktop() || currentPollId !== pollId) {
          stopDesktopUpdatePolling();
          return;
        }

        void pollDesktopDownloadProgress().then((p: DesktopDownloadProgress) => {
          if (!mountedRef.current || currentPollId !== pollId) return;
          if (p.state === 'downloading') {
            setDownload({
              kind: 'downloading',
              downloadedBytes: p.downloaded_bytes,
              totalBytes: p.total_bytes,
            });
          } else if (p.state === 'done') {
            setDownload({ kind: 'done', filePath: p.file_path });
            setInstallError(null);
            stopDesktopUpdatePolling();
          } else if (p.state === 'error') {
            setDownload({ kind: 'error', error: p.error });
            stopDesktopUpdatePolling();
          }
        });
      };

      activePollTimer = setInterval(checkProgress, 400);
      checkProgress();
    },
    [canInstallInApp, isDesktop, download.kind],
  );

  /** 手动打开已下载的安装包。 */
  const openInstaller = useCallback(() => {
    if (download.kind !== 'done') return;
    void openDownloadedInstaller(download.filePath);
  }, [download]);

  /** 一键安装：桌面端静默替换并重启，安卓调起系统安装器。 */
  const installUpdate = useCallback(() => {
    if (download.kind !== 'done') return;
    setInstalling(true);
    setInstallError(null);

    if (canInstallInApp) {
      void installAndroidUpdate(download.filePath)
        .catch((err) => {
          if (mountedRef.current) {
            setInstallError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          // 安装器关掉（装完/取消）后都能再点一次；装成功时本进程已被替换。
          if (mountedRef.current) setInstalling(false);
        });
      return;
    }

    void installDesktopUpdateAndRestart(download.filePath).catch((err) => {
      if (mountedRef.current) {
        setInstalling(false);
        setInstallError(err instanceof Error ? err.message : String(err));
      }
    });
  }, [canInstallInApp, download]);

  // 计算 Release 详情链接
  const activeTag =
    outcome && outcome.kind === 'available'
      ? (outcome.options.find((o) => o.version === outcome.selectedVersion)?.tag ?? `v${outcome.latestVersion}`)
      : undefined;

  return {
    currentVersion,
    channel,
    channelLabel,
    preferredChannel,
    setPreferredChannel,
    autoCheckEnabled,
    setAutoCheckEnabled,
    checking,
    outcome,
    selectedVersion,
    selectVersion,
    check,
    pageUrl: activeTag ? releasePageUrl(activeTag) : releasePageUrl(),
    isDesktop,
    canInstallInApp,
    download,
    startDownload,
    openInstaller,
    installUpdate,
    installing,
    installError,
  };
}
