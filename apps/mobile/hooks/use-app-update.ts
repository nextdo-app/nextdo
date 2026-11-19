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
  getAutoDownloadPreference,
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
  setAutoDownloadPreference,
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

/**
 * 应用内下载的状态（桌面端 / 安卓端使用）。
 *
 * 每个非 idle 状态都记着发起它的 release tag：安装包只对**下载它的那个
 * 版本**有效，切换选中版本后旧状态必须作废，否则「已下载完成 → 立即安装」
 * 会在用户以为自己装的是新版本时安装旧包。
 */
export type DownloadState =
  | { kind: 'idle' }
  | { kind: 'downloading'; tag: string; downloadedBytes: number; totalBytes: number }
  | { kind: 'done'; tag: string; filePath: string }
  | { kind: 'error'; tag: string; error: string };

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
  /** 是否开启自动下载更新（默认开启）。 */
  autoDownloadEnabled: boolean;
  /** 切换并持久化自动下载更新偏好。 */
  setAutoDownloadEnabled: (enabled: boolean) => Promise<void>;
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
  /**
   * 当前选中版本的下载状态。切换目标版本后，为旧版本发起的下载不再出现在
   * 这里 —— 已下载完成的安装包只属于它对应的那个版本。
   */
  download: DownloadState;
  /** 是否有应用内下载正在进行（不区分版本，供界面禁止切换目标）。 */
  downloadBusy: boolean;
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
  const [autoDownloadEnabled, setAutoDownloadEnabledState] = useState(true);

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
  /**
   * 下载 / 安装进行中（ref 版本）。
   *
   * 检查更新是异步的：请求飞行期间用户可能已经点了下载，等结果落地时闭包里的
   * `download.kind` 仍是旧值。用 ref 记录最新锁状态，保证「检查先发起、随后
   * 开始下载」的时序也会丢弃结果，而不是把选中版本重置回偏好默认值。
   */
  const updateLockedRef = useRef(false);

  useEffect(() => {
    updateLockedRef.current = download.kind === 'downloading' || installing;
  }, [download.kind, installing]);

  useEffect(() => {
    mountedRef.current = true;
    void getUpdateChannelPreference().then((pref) => {
      if (mountedRef.current) setPreferredChannelState(pref);
    });
    void getAutoUpdateCheckPreference().then((enabled) => {
      if (mountedRef.current) setAutoCheckEnabledState(enabled);
    });
    void getAutoDownloadPreference().then((enabled) => {
      if (mountedRef.current) setAutoDownloadEnabledState(enabled);
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

  const setAutoDownloadEnabled = useCallback(async (enabled: boolean) => {
    setAutoDownloadEnabledState(enabled);
    await setAutoDownloadPreference(enabled);
  }, []);

  const check = useCallback(() => {
    if (checking) return;
    // 下载 / 安装进行中不能重新检查：结果会重建 outcome 并复位选中版本，
    // 而安装包仍属于旧目标 —— 界面会进入「两版本都禁用、下载按钮却无效」的死角。
    if (updateLockedRef.current) return;
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
      // 请求飞行期间用户开始了下载 / 安装：丢弃这次结果，保持当前选择与进度。
      if (updateLockedRef.current) return;
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

  /**
   * 当前选中版本的 tag。下载 / 安装状态都绑定在它上面：切换目标版本后，
   * 为旧版本发起的下载（哪怕已完成）不再属于当前选择。
   */
  const selectedTag =
    outcome?.kind === 'available'
      ? (outcome.options.find((opt) => opt.version === outcome.selectedVersion)?.tag ?? null)
      : null;

  const selectVersion = useCallback(
    (targetVersion: string) => {
      // 下载进行中不允许换目标：安装包正在下，切换只会让用户以为下的是新版本。
      if (download.kind === 'downloading' || installing) return;
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
    [download.kind, installing],
  );

  /** 开始应用内下载：桌面端轮询 Tauri 的进度，安卓走 expo-file-system 的回调。 */
  const startDownload = useCallback(
    (url: string) => {
      if (!isDesktop && !canInstallInApp) return;
      if (download.kind === 'downloading') return;
      // 下载按钮只出现在「有新版本」的 outcome 里，拿不到 tag 说明状态已经
      // 过期（例如检查结果刚被替换），此时不发起下载。
      if (selectedTag === null) return;
      // 同步上锁：检查请求可能正在飞行，其结果必须看到这把锁。
      updateLockedRef.current = true;
      setDownload({ kind: 'downloading', tag: selectedTag, downloadedBytes: 0, totalBytes: 0 });

      if (canInstallInApp) {
        void downloadAndroidUpdate(url, (progress) => {
          if (mountedRef.current) {
            setDownload({
              kind: 'downloading',
              tag: selectedTag,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
            });
          }
        })
          .then(async (fileUri) => {
            if (mountedRef.current) {
              setDownload({ kind: 'done', tag: selectedTag, filePath: fileUri });
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
              setDownload({ kind: 'error', tag: selectedTag, error: String(e) });
            }
          });
        return;
      }

      void startDesktopDownload(url).catch((e) => {
        if (mountedRef.current) {
          setDownload({ kind: 'error', tag: selectedTag, error: String(e) });
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
              tag: selectedTag,
              downloadedBytes: p.downloaded_bytes,
              totalBytes: p.total_bytes,
            });
          } else if (p.state === 'done') {
            setDownload({ kind: 'done', tag: selectedTag, filePath: p.file_path });
            setInstallError(null);
            stopDesktopUpdatePolling();
          } else if (p.state === 'error') {
            setDownload({ kind: 'error', tag: selectedTag, error: p.error });
            stopDesktopUpdatePolling();
          }
        });
      };

      activePollTimer = setInterval(checkProgress, 400);
      checkProgress();
    },
    [canInstallInApp, isDesktop, download.kind, selectedTag],
  );

  /** 手动打开已下载的安装包（只允许打开当前选中版本的那份）。 */
  const openInstaller = useCallback(() => {
    if (download.kind !== 'done' || download.tag !== selectedTag) return;
    void openDownloadedInstaller(download.filePath);
  }, [download, selectedTag]);

  /** 一键安装：桌面端静默替换并重启，安卓调起系统安装器。 */
  const installUpdate = useCallback(() => {
    if (download.kind !== 'done' || download.tag !== selectedTag) return;
    updateLockedRef.current = true;
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

    void installDesktopUpdateAndRestart(download.filePath)
      .then(() => {
        // Linux 只是用系统安装器打开安装包（xdg-open），应用不会退出 —— 必须
        // 把按钮和版本切换解锁。macOS / Windows 的安装会让本进程退出，Promise
        // 不会回到这里。
        if (mountedRef.current && platform !== 'macos' && platform !== 'windows') {
          setInstalling(false);
        }
      })
      .catch((err) => {
        if (mountedRef.current) {
          setInstalling(false);
          setInstallError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [canInstallInApp, download, platform, selectedTag]);

  // 计算 Release 详情链接
  const activeTag =
    outcome && outcome.kind === 'available'
      ? (outcome.options.find((o) => o.version === outcome.selectedVersion)?.tag ?? `v${outcome.latestVersion}`)
      : undefined;

  // 下载状态只对下载它的版本有效：切换目标后旧状态不再展示/可用。
  const selectedDownload: DownloadState =
    download.kind !== 'idle' && download.tag === selectedTag ? download : { kind: 'idle' };

  return {
    currentVersion,
    channel,
    channelLabel,
    preferredChannel,
    setPreferredChannel,
    autoCheckEnabled,
    setAutoCheckEnabled,
    autoDownloadEnabled,
    setAutoDownloadEnabled,
    checking,
    outcome,
    selectedVersion,
    selectVersion,
    check,
    pageUrl: activeTag ? releasePageUrl(activeTag) : releasePageUrl(),
    isDesktop,
    canInstallInApp,
    download: selectedDownload,
    downloadBusy: download.kind === 'downloading',
    startDownload,
    openInstaller,
    installUpdate,
    installing,
    installError,
  };
}
