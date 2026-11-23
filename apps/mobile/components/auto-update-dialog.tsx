/**
 * 全局自动更新检查提示弹窗与监听器（AutoUpdateNotifier & AutoUpdateDialog）。
 *
 * 设计灵感与行为对齐 tungsten-edge (SparkleUpdateService) / VS Code：
 * 1. 静默检测：若开启自动更新偏好，应用启动后低优先级检测一次，之后每
 *    `AUTO_UPDATE_CHECK_INTERVAL_MS` 复查一次 —— 长期开着的桌面应用不会错过新版本；
 * 2. 温和提醒：同一版本「稍后再说」后 24 小时内不再打扰；「跳过此版本」后
 *    该版本不再提醒（下一次更高版本会重新提醒）；
 * 3. 完整透明：在用户做决定前，先完整展示该版本的更新日志（ChangeLog / Release Notes）；
 * 4. 自动下载：开启自动下载偏好时，弹窗出现即在后台下载安装包（仅限能应用内
 *    安装的桌面壳 / 安卓），下载完成后只需一键重启安装；
 * 5. 应用内安装：桌面壳（Tauri）下载后直接替换重启，Android 下载 APK 后直接调起
 *    系统安装器 —— 两条路都不再把用户丢去浏览器自己找安装包。
 */
import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Button, cn } from '@nextdo/ui';
import {
  canInstallUpdateInApp,
  compareVersions,
  currentAppVersion,
  detectAndroidAbi,
  detectMacArch,
  detectUpdatePlatform,
  downloadAndroidUpdate,
  fetchDualChannelReleases,
  formatReleaseDate,
  getAutoDownloadPreference,
  getAutoUpdateCheckPreference,
  getUpdateChannelPreference,
  installAndroidUpdate,
  installDesktopUpdateAndRestart,
  isTauriDesktop,
  isUpdateSuppressed,
  openAndroidInstallPermissionSettings,
  openDownloadedInstaller,
  openExternalUrl,
  pickDownloads,
  pollDesktopDownloadProgress,
  releasePageUrl,
  skipUpdateVersion,
  snoozeUpdateVersion,
  startDesktopDownload,
  type AndroidAbi,
  type DesktopDownloadProgress,
  type DualChannelReleases,
  type MacArch,
  type ReleaseDownload,
  type ReleaseInfo,
  type UpdateChannelPreference,
  type UpdateFailureReason,
} from '@/lib/app-update';

/** 运行期间的后台复查间隔（启动检查之外）。 */
export const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 启动后首次检查的延迟：先让主界面渲染出来。 */
const INITIAL_CHECK_DELAY_MS = 1500;

export interface AutoUpdateDialogProps {
  visible: boolean;
  onClose: () => void;
  releases: {
    stable: ReleaseInfo | null;
    beta: ReleaseInfo | null;
  };
  preferredChannel: UpdateChannelPreference;
}

export const AutoUpdateDialog = memo(function AutoUpdateDialog({
  visible,
  onClose,
  releases,
  preferredChannel,
}: AutoUpdateDialogProps) {
  const currentVersion = currentAppVersion();
  const platform = detectUpdatePlatform();
  const isDesktop = isTauriDesktop();
  // 安卓：下载 APK 后直接调起系统安装器（模块缺失 / 非安卓时为 false，退回浏览器下载）。
  const canInstallInApp = useMemo(() => canInstallUpdateInApp(), []);

  const [macArch, setMacArch] = useState<MacArch | null>(null);
  const [androidAbi, setAndroidAbi] = useState<AndroidAbi>('arm64-v8a');
  const [selectedChannel, setSelectedChannel] = useState<'stable' | 'beta'>('stable');
  const [downloadState, setDownloadState] = useState<
    | { kind: 'idle' }
    | { kind: 'downloading'; downloadedBytes: number; totalBytes: number }
    | { kind: 'done'; filePath: string }
    | { kind: 'error'; error: string }
  >({ kind: 'idle' });
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  /** 是否在弹窗出现后自动后台下载（默认开，设置页可关）。 */
  const [autoDownload, setAutoDownload] = useState(false);
  /** 自动下载只触发一次（同一个版本）。 */
  const autoDownloadStartedRef = useRef(false);
  /**
   * 桌面壳的原生下载是全局单槽（`download_update` 在 downloading 时直接
   * 返回 Ok，`get_download_progress` 读的是同一个任务）。下载 / 安装未结束
   * 时切换目标再发起下载，会读到旧任务的文件。任务期间锁定发起它的
   * release，直到任务结束才允许切目标。
   */
  const taskReleaseRef = useRef<ReleaseInfo | null>(null);
  /** 任务期间渠道偏好真的发生变化时置位，任务结束后再应用。 */
  const pendingChannelPreferenceRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    // 纯浏览器 / iOS 没有应用内安装，读取这个偏好没有意义。
    if (!isDesktop && !canInstallInApp) return;
    void getAutoDownloadPreference().then(setAutoDownload);
  }, [visible, isDesktop, canInstallInApp]);

  useEffect(() => {
    if (platform === 'macos') {
      void detectMacArch().then(setMacArch);
    }
    if (platform === 'android') {
      // 下错 ABI 的 APK 在安卓上根本装不上（解析失败），所以先问系统架构。
      void detectAndroidAbi().then(setAndroidAbi);
    }
  }, [platform]);

  const { stable, beta } = releases;

  // 判定哪些 release 属于比本机版本更新的新版本
  const stableIsNewer =
    stable !== null && (currentVersion === '' || compareVersions(stable.version, currentVersion) > 0);
  const betaIsNewer =
    beta !== null && (currentVersion === '' || compareVersions(beta.version, currentVersion) > 0);

  // 下载 / 安装任务进行中：锁定发起时的 release，不允许目标切换。
  const downloadTaskActive = downloadState.kind === 'downloading' || installing;

  // 渠道偏好（或可用渠道）变化时应用新的默认渠道。任务期间原生下载槽仍在
  // 为旧版本工作，先记下这次变化，等任务结束后再应用。
  useEffect(() => {
    if (downloadTaskActive) {
      pendingChannelPreferenceRef.current = true;
      return;
    }
    if (preferredChannel === 'beta' && betaIsNewer) {
      setSelectedChannel('beta');
    } else if (stableIsNewer) {
      setSelectedChannel('stable');
    } else if (betaIsNewer) {
      setSelectedChannel('beta');
    }
  }, [preferredChannel, stableIsNewer, betaIsNewer]);

  // 只应用任务期间真正发生过的偏好变化。任务完成本身不是重置用户选择的
  // 理由：用户在弹窗里主动选了 beta 并下载完成时，必须继续显示 beta。
  useEffect(() => {
    if (downloadTaskActive || !pendingChannelPreferenceRef.current) return;
    pendingChannelPreferenceRef.current = false;
    if (preferredChannel === 'beta' && betaIsNewer) {
      setSelectedChannel('beta');
    } else if (stableIsNewer) {
      setSelectedChannel('stable');
    } else if (betaIsNewer) {
      setSelectedChannel('beta');
    }
  }, [downloadTaskActive, preferredChannel, stableIsNewer, betaIsNewer]);

  const inferredRelease: ReleaseInfo | null =
    selectedChannel === 'beta' ? beta ?? stable : stable ?? beta;
  const activeRelease: ReleaseInfo | null = downloadTaskActive
    ? taskReleaseRef.current ?? inferredRelease
    : inferredRelease;

  const downloads: ReleaseDownload[] = useMemo(() => {
    if (!activeRelease) return [];
    return pickDownloads(activeRelease, platform, macArch, androidAbi);
  }, [activeRelease, platform, macArch, androidAbi]);

  const activeDownloadUrl = downloads[0]?.url;

  /** 当前选中的 release 是否确实比本机版本新（旧版本永远不自动下载）。 */
  const activeIsNewer =
    activeRelease !== null &&
    (currentVersion === '' || compareVersions(activeRelease.version, currentVersion) > 0);

  // 桌面端下载轮询
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  /**
   * 当前弹窗展示的 release tag。下载是异步的，用户可能先关掉弹窗、去设置页
   * 切换渠道，再手动检查出另一个目标版本；这时旧下载的回调不允许再改状态，
   * 否则会把旧安装包的进度 / 完成态显示在新版本上。
   */
  const activeReleaseTagRef = useRef<string | null>(null);
  useEffect(() => {
    activeReleaseTagRef.current = activeRelease?.tag ?? null;
  }, [activeRelease?.tag]);

  // 换版本（或切换渠道）时丢弃上一份下载状态，避免把旧安装包当成新版本安装。
  useEffect(() => {
    stopPolling();
    setDownloadState({ kind: 'idle' });
    setInstallError(null);
    autoDownloadStartedRef.current = false;
    taskReleaseRef.current = null;
  }, [activeRelease?.tag, stopPolling]);

  /**
   * 开始下载安装包。`autoInstall` 为 true 时（用户点了「立即更新」）安卓下载
   * 完成后直接调起系统安装器；自动后台下载传 false，把安装决定留给用户。
   */
  const handleStartDownload = useCallback(
    (autoInstall = true) => {
      if (!activeDownloadUrl) {
        if (activeRelease) {
          void openExternalUrl(releasePageUrl(activeRelease.tag));
        }
        return;
      }

      // 这次下载属于哪个版本。目标版本一变（例如关掉弹窗、切换渠道后手动
      // 重查），旧下载的异步回调就必须作废。
      const startedTag = activeRelease?.tag ?? null;
      const stillCurrent = () => activeReleaseTagRef.current === startedTag;

      if (canInstallInApp) {
        // 安卓：下到应用缓存，下完的「完成态」再由用户一键交给系统安装器。
        setInstallError(null);
        taskReleaseRef.current = activeRelease;
        setDownloadState({ kind: 'downloading', downloadedBytes: 0, totalBytes: 0 });
        void downloadAndroidUpdate(activeDownloadUrl, (progress) => {
          if (!stillCurrent()) return;
          setDownloadState({
            kind: 'downloading',
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
          });
        })
          .then(async (fileUri) => {
            if (!stillCurrent()) return;
            setDownloadState({ kind: 'done', filePath: fileUri });
            if (!autoInstall) return;
            // 安卓端下载完成自动调起系统安装器，无需等待用户二次点击
            try {
              setInstalling(true);
              await installAndroidUpdate(fileUri);
            } catch (e) {
              if (stillCurrent()) setInstallError(String(e));
            } finally {
              setInstalling(false);
            }
          })
          .catch((err) => {
            if (!stillCurrent()) return;
            setDownloadState({ kind: 'error', error: String(err) });
          });
        return;
      }

      if (!isDesktop) {
        void openExternalUrl(activeDownloadUrl);
        return;
      }

      taskReleaseRef.current = activeRelease;
      setDownloadState({ kind: 'downloading', downloadedBytes: 0, totalBytes: 0 });
      void startDesktopDownload(activeDownloadUrl).catch((err) => {
        if (!stillCurrent()) return;
        setDownloadState({ kind: 'error', error: String(err) });
      });

      stopPolling();

      const checkProgress = () => {
        void pollDesktopDownloadProgress().then((p: DesktopDownloadProgress) => {
          if (!stillCurrent()) return;
          if (p.state === 'downloading') {
            setDownloadState({
              kind: 'downloading',
              downloadedBytes: p.downloaded_bytes,
              totalBytes: p.total_bytes,
            });
          } else if (p.state === 'done') {
            setDownloadState({ kind: 'done', filePath: p.file_path });
            stopPolling();
          } else if (p.state === 'error') {
            setDownloadState({ kind: 'error', error: p.error });
            stopPolling();
          }
        });
      };

      pollTimerRef.current = setInterval(checkProgress, 400);
      // 与设置页一致：立刻取一次进度，完成态不必等第一个 400ms 周期。
      checkProgress();
    },
    [activeDownloadUrl, activeRelease, canInstallInApp, isDesktop, stopPolling],
  );

  // 自动后台下载：弹窗一出现就开始下（仅限能应用内安装的桌面壳 / 安卓）。
  // 用户只需在读更新说明的这段时间里等它下完，再决定何时重启安装。
  useEffect(() => {
    if (!visible || !autoDownload || !activeIsNewer) return;
    if (!isDesktop && !canInstallInApp) return;
    if (downloadState.kind !== 'idle' || activeDownloadUrl === undefined) return;
    if (autoDownloadStartedRef.current) return;
    autoDownloadStartedRef.current = true;
    handleStartDownload(false);
  }, [
    visible,
    autoDownload,
    activeIsNewer,
    isDesktop,
    canInstallInApp,
    downloadState.kind,
    activeDownloadUrl,
    handleStartDownload,
  ]);

  /**
   * 一键安装（安卓：把已下好的 APK 交给系统安装器；桌面：替换应用包并重启）。
   */
  const handleInstall = useCallback(async () => {
    if (downloadState.kind !== 'done') return;
    setInstalling(true);
    setInstallError(null);

    if (canInstallInApp) {
      try {
        await installAndroidUpdate(downloadState.filePath);
        // 安装器可能已经被用户取消，或装完后本应用被替换掉（那时这段不会再执行）；
        // 两种情况都把按钮恢复成可再点一次，而不是卡在「正在安装」。
        setInstalling(false);
      } catch (e) {
        setInstallError(String(e));
        setInstalling(false);
      }
      return;
    }

    try {
      // Tauri 侧的自动安装命令：macOS 静默挂载 DMG、由后台脚本在本进程退出后
      // 覆盖 /Applications 下的 .app 并重启，Windows 直接启动 NSIS 安装程序。
      // 两条路都会由 Rust 优雅退出本应用 —— 用户不必再手动关闭应用。
      await installDesktopUpdateAndRestart(downloadState.filePath);
      // macOS / Windows 上进程已经退出（这个 Promise 不会再回来）；Linux 只是
      // 用系统安装器打开安装包、不退出应用，所以要把按钮从「正在安装并重启…」恢复。
      if (platform !== 'macos' && platform !== 'windows') setInstalling(false);
    } catch (e) {
      setInstallError(String(e));
      setInstalling(false);
    }
  }, [canInstallInApp, downloadState, platform]);

  /** 「稍后再说」：24 小时内不再提醒同一版本。 */
  const handleLater = useCallback(() => {
    if (activeRelease) void snoozeUpdateVersion(activeRelease.version);
    onClose();
  }, [activeRelease, onClose]);

  /** 「跳过此版本」：该版本不再提醒；出现更高版本时会重新提醒。 */
  const handleSkip = useCallback(() => {
    if (activeRelease) void skipUpdateVersion(activeRelease.version);
    onClose();
  }, [activeRelease, onClose]);

  if (!visible || !activeRelease) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleLater}>
      <View
        testID="auto-update-dialog-backdrop"
        className="flex-1 items-center justify-center bg-black/60 p-4"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭更新弹窗"
          className="absolute inset-0"
          onPress={handleLater}
        />
        <View
          testID="auto-update-dialog-card"
          className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/80 bg-surface p-5 shadow-2xl dark:border-border-dark dark:bg-surface-dark"
        >
          {/* Header */}
          <View className="gap-1.5 pb-3 border-b border-border/60 dark:border-border-dark/60">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Text className="font-display text-lg font-bold text-ink dark:text-ink-dark">
                  发现新版本
                </Text>
                <View
                  className={cn(
                    'rounded-full px-2.5 py-0.5',
                    activeRelease.channel === 'stable'
                      ? 'bg-surface-container dark:bg-surface-container-dark'
                      : 'bg-accent/15 dark:bg-accent-dark/20',
                  )}
                >
                  <Text
                    className={cn(
                      'font-sans text-xs font-semibold',
                      activeRelease.channel === 'stable'
                        ? 'text-muted dark:text-muted-dark'
                        : 'text-accent dark:text-accent-dark',
                    )}
                  >
                    {activeRelease.channelLabel}
                  </Text>
                </View>
              </View>
              <Text className="font-sans text-base font-bold text-accent dark:text-accent-dark">
                v{activeRelease.version}
              </Text>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                当前版本：{currentVersion || '0.0.0'}
              </Text>
              {activeRelease.publishedAt ? (
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  发布于 {formatReleaseDate(activeRelease.publishedAt)}
                </Text>
              ) : null}
            </View>

            {/* 多渠道切换 pill */}
            {stableIsNewer && betaIsNewer && stable && beta ? (
              <View className="flex-row gap-2 pt-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="切换到正式版"
                  onPress={() => setSelectedChannel('stable')}
                  disabled={downloadState.kind === 'downloading' || installing}
                  className={cn(
                    'flex-1 items-center justify-center rounded-lg border py-1.5 px-2',
                    selectedChannel === 'stable'
                      ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                      : 'border-border/60 bg-surface dark:border-border-dark dark:bg-surface-dark',
                  )}
                >
                  <Text
                    className={cn(
                      'font-sans text-xs font-semibold',
                      selectedChannel === 'stable'
                        ? 'text-accent dark:text-accent-dark'
                        : 'text-muted dark:text-muted-dark',
                    )}
                  >
                    正式版 v{stable.version}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="切换到测试版"
                  onPress={() => setSelectedChannel('beta')}
                  disabled={downloadState.kind === 'downloading' || installing}
                  className={cn(
                    'flex-1 items-center justify-center rounded-lg border py-1.5 px-2',
                    selectedChannel === 'beta'
                      ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                      : 'border-border/60 bg-surface dark:border-border-dark dark:bg-surface-dark',
                  )}
                >
                  <Text
                    className={cn(
                      'font-sans text-xs font-semibold',
                      selectedChannel === 'beta'
                        ? 'text-accent dark:text-accent-dark'
                        : 'text-muted dark:text-muted-dark',
                    )}
                  >
                    测试版 v{beta.version}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* ChangeLog 内容区 */}
          <View className="py-3 gap-1.5">
            <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
              更新说明 (ChangeLog)
            </Text>
            <View
              testID="changelog-scroll-container"
              className="max-h-60 rounded-xl border border-border/70 bg-canvas/60 p-3 dark:border-border-dark/70 dark:bg-canvas-dark/60"
            >
              <ScrollView
                className="max-h-52"
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
              >
                {activeRelease.notes ? (
                  <Text className="font-sans text-xs leading-relaxed text-ink dark:text-ink-dark whitespace-pre-wrap">
                    {activeRelease.notes}
                  </Text>
                ) : (
                  <Text className="font-sans text-xs italic text-muted dark:text-muted-dark">
                    该版本暂未提供更新说明，您可以直接下载或前往 GitHub Releases 查看。
                  </Text>
                )}
              </ScrollView>
            </View>
          </View>

          {/* 桌面端下载进度或错误展示 */}
          {downloadState.kind === 'downloading' ? (
            <View className="gap-1.5 pb-3">
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                正在下载…{' '}
                {downloadState.downloadedBytes > 0
                  ? `${(downloadState.downloadedBytes / 1024 / 1024).toFixed(1)} MB`
                  : ''}
              </Text>
              <View className="h-2 overflow-hidden rounded-full bg-muted/20 dark:bg-muted-dark/20">
                <View
                  className="h-full rounded-full bg-accent dark:bg-accent-dark"
                  style={{
                    width:
                      downloadState.totalBytes > 0
                        ? `${Math.min(100, (downloadState.downloadedBytes / downloadState.totalBytes) * 100)}%`
                        : '40%',
                  }}
                />
              </View>
            </View>
          ) : null}

          {downloadState.kind === 'error' ? (
            <Text className="pb-3 font-sans text-xs text-danger dark:text-danger-dark">
              下载失败：{downloadState.error}
            </Text>
          ) : null}

          {downloadState.kind === 'done' && canInstallInApp ? (
            <View className="gap-1 pb-3">
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                安装包已下载完成。点「立即安装」会打开系统安装程序；首次安装需允许 Nextdo
                「安装未知应用」。安装成功后应用会自动重启。
              </Text>
              {/* 无响应时的自救入口：缺安装权限/未打开开关时系统会静默拦下安装器。 */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="去允许安装未知应用"
                onPress={() => {
                  void openAndroidInstallPermissionSettings();
                }}
                className="self-start"
              >
                <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                  没有弹出安装界面？去允许「安装未知应用」→
                </Text>
              </Pressable>
            </View>
          ) : null}

          {installError ? (
            <View className="gap-1 pb-3">
              <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                安装启动失败：{installError}
              </Text>
              {/* 静默替换 / 调起安装器都可能失败（无写权限、ROM 限制、未授权安装
                  未知应用）；失败时留一条兜底通道，而不是把用户卡在弹窗里。 */}
              {canInstallInApp ? (
                <View className="gap-1">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="去允许安装未知应用"
                    onPress={() => {
                      void openAndroidInstallPermissionSettings();
                    }}
                    className="self-start"
                  >
                    <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                      去系统设置允许 Nextdo「安装未知应用」→
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="改用浏览器下载安装包"
                    onPress={() => {
                      void openExternalUrl(
                        activeDownloadUrl ?? releasePageUrl(activeRelease?.tag),
                      );
                    }}
                    className="self-start"
                  >
                    <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                      改用浏览器下载安装包 →
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="手动打开安装包"
                  onPress={() => {
                    if (downloadState.kind === 'done') {
                      void openDownloadedInstaller(downloadState.filePath);
                    }
                  }}
                  className="self-start"
                >
                  <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                    手动打开安装包 →
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {/* Footer 按钮操作区 */}
          <View className="flex-row items-center justify-between gap-2.5 pt-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="跳过此版本"
              onPress={handleSkip}
              disabled={installing}
              className="shrink-0 active:opacity-70"
            >
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">跳过此版本</Text>
            </Pressable>
            <View className="flex-row items-center gap-2.5">
              <Button
                label="稍后再说"
                variant="secondary"
                onPress={handleLater}
                disabled={installing}
              />
              {downloadState.kind === 'done' ? (
                <Button
                  label={
                    canInstallInApp
                      ? installing
                        ? '正在打开安装程序…'
                        : '立即安装'
                      : installing
                        ? '正在安装并重启…'
                        : '立即安装并重启'
                  }
                  variant="primary"
                  onPress={() => {
                    void handleInstall();
                  }}
                  disabled={installing}
                />
              ) : (
                <Button
                  label={
                    isDesktop || canInstallInApp
                      ? downloadState.kind === 'downloading'
                        ? '下载中…'
                        : '立即更新'
                      : '前往下载'
                  }
                  variant="primary"
                  onPress={() => {
                    handleStartDownload(true);
                  }}
                  disabled={downloadState.kind === 'downloading'}
                />
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
});

/* ------------------------------------------------------------------ *
 * 手动检查 + 后台检查共用的更新弹窗
 *
 * 设置页的「检查更新」不再把结果渲染成一张内联卡片，而是调用这里的
 * `checkForUpdates()`：同一个弹窗先显示「正在检查更新…」，再落到
 * 发现新版本 / 已是最新版本 / 检查失败三种结果。后台定时检查也走同一个
 * 状态机，所以用户从两个入口看到的界面与交互完全一致。
 * ------------------------------------------------------------------ */

/** 弹窗当前展示的内容。 */
type UpdatePromptStatus = 'checking' | 'available' | 'up-to-date' | 'failed';

/** 检查失败的三种原因 → 提示文案（文案归 UI，逻辑层只给 reason）。 */
const UPDATE_FAILURE_COPY: Record<UpdateFailureReason, string> = {
  network: '连不上更新服务器，请检查网络后重试。',
  http: '更新服务器暂时不可用，请稍后重试。',
  payload: '没能读到版本信息，请稍后重试。',
};

export interface UseUpdatePromptResult {
  /** 手动检查更新：立即打开更新弹窗并展示检查结果。 */
  checkForUpdates: () => void;
  /** 手动检查请求进行中（设置页按钮据此禁用）。 */
  checking: boolean;
}

const UpdatePromptContext = createContext<UseUpdatePromptResult | null>(null);

/** 读取共享的更新弹窗入口；必须挂载在 `UpdatePromptProvider` 内。 */
export function useUpdatePrompt(): UseUpdatePromptResult {
  const value = useContext(UpdatePromptContext);
  if (value === null) {
    throw new Error('useUpdatePrompt must be used inside UpdatePromptProvider');
  }
  return value;
}

interface UpdateStatusDialogProps {
  visible: boolean;
  status: 'checking' | 'up-to-date' | 'failed';
  currentVersion: string;
  releases: DualChannelReleases;
  failureReason: UpdateFailureReason | null;
  onClose: () => void;
  onRetry: () => void;
}

/**
 * 检查中 / 已是最新 / 检查失败时的弹窗。外壳与 `AutoUpdateDialog` 保持同一套
 * 卡片样式，让手动检查和后台提醒看起来就是同一个提示。
 */
function UpdateStatusDialog({
  visible,
  status,
  currentVersion,
  releases,
  failureReason,
  onClose,
  onRetry,
}: UpdateStatusDialogProps) {
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 p-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭更新弹窗"
          className="absolute inset-0"
          onPress={onClose}
        />
        <View
          testID="update-check-status-dialog"
          className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/80 bg-surface p-5 shadow-2xl dark:border-border-dark dark:bg-surface-dark"
        >
          <View className="gap-1.5 border-b border-border/60 pb-3 dark:border-border-dark/60">
            <Text className="font-display text-lg font-bold text-ink dark:text-ink-dark">
              应用更新
            </Text>
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              当前版本：{currentVersion || '0.0.0'}
            </Text>
          </View>

          {status === 'checking' ? (
            <View className="gap-1.5 py-5">
              <Text className="font-sans text-base font-bold text-ink dark:text-ink-dark">
                正在检查更新…
              </Text>
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                正在获取最新版本信息，请稍候。
              </Text>
            </View>
          ) : status === 'up-to-date' ? (
            <View className="gap-1.5 py-5">
              <Text className="font-sans text-base font-bold text-ink dark:text-ink-dark">
                已是最新版本（当前版本 {currentVersion || '0.0.0'}）
              </Text>
              {releases.stable !== null || releases.beta !== null ? (
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  {releases.stable !== null ? `正式版：v${releases.stable.version}` : ''}
                  {releases.stable !== null && releases.beta !== null ? ' · ' : ''}
                  {releases.beta !== null ? `测试版：v${releases.beta.version}` : ''}
                </Text>
              ) : null}
            </View>
          ) : (
            <View className="gap-1.5 py-5">
              <Text className="font-sans text-base font-bold text-ink dark:text-ink-dark">
                检查更新失败
              </Text>
              <Text
                testID="update-check-error"
                className="font-sans text-sm text-danger dark:text-danger-dark"
              >
                {failureReason === null ? UPDATE_FAILURE_COPY.network : UPDATE_FAILURE_COPY[failureReason]}
              </Text>
            </View>
          )}

          <View className="flex-row items-center justify-end gap-2.5 pt-2">
            {status === 'failed' ? <Button label="重试" onPress={onRetry} /> : null}
            <Button
              label={status === 'checking' ? '取消' : '关闭'}
              variant="secondary"
              onPress={onClose}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * 自动更新监听与提醒控制器，同时向设置页提供手动检查入口。
 *
 * 一个状态机、一个弹窗：后台检查只在「确实有更新且未被跳过/稍后提醒」时打开
 * 弹窗；手动检查无论结果如何都打开同一个弹窗（包括已是最新和失败），因为
 * 用户明确点了按钮。
 */
export function UpdatePromptProvider({ children }: { children?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<UpdatePromptStatus>('checking');
  const [releases, setReleases] = useState<DualChannelReleases>({ stable: null, beta: null });
  const [preferredChannel, setPreferredChannelState] = useState<UpdateChannelPreference>('stable');
  const [failureReason, setFailureReason] = useState<UpdateFailureReason | null>(null);
  const [checking, setChecking] = useState(false);

  const mountedRef = useRef(true);
  const visibleRef = useRef(false);
  const checkingRef = useRef(false);
  /** 每次发起检查自增；较旧的异步结果据此丢弃。 */
  const requestRef = useRef(0);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    checkingRef.current = checking;
  }, [checking]);

  const runCheck = useCallback(async (manual: boolean) => {
    if (!manual) {
      // 弹窗已经打开时（人工正在读更新说明 / 手动检查结果），后台检查不打扰。
      if (visibleRef.current) return;
      try {
        if (!(await getAutoUpdateCheckPreference())) return;
      } catch {
        return;
      }
      if (visibleRef.current) return;
    } else {
      // 手动检查：先打开弹窗的「检查中」态，请求结束再落到结果。
      if (checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);
      setFailureReason(null);
      setStatus('checking');
      setVisible(true);
    }

    const requestId = ++requestRef.current;
    try {
      const pref = await getUpdateChannelPreference();
      const result = await fetchDualChannelReleases();
      if (!mountedRef.current || requestId !== requestRef.current) return;

      if (!result.ok) {
        if (manual) {
          setFailureReason(result.reason);
          setStatus('failed');
        }
        return;
      }

      const { stable, beta } = result.releases;
      const currentVer = currentAppVersion();
      const stableIsNewer =
        stable !== null && (currentVer === '' || compareVersions(stable.version, currentVer) > 0);
      const betaIsNewer =
        beta !== null && (currentVer === '' || compareVersions(beta.version, currentVer) > 0);

      setReleases(result.releases);
      setPreferredChannelState(pref);

      if (!stableIsNewer && !betaIsNewer) {
        // 手动检查明确告诉用户「已是最新」；后台检查保持安静。
        if (manual) setStatus('up-to-date');
        return;
      }

      if (!manual) {
        // 后台提醒遵守「稍后再说 / 跳过此版本」。手动检查是用户的明确动作，
        // 不因静默记录而隐藏结果。
        const targetRelease =
          pref === 'beta'
            ? betaIsNewer && beta !== null
              ? beta
              : stable
            : stableIsNewer && stable !== null
              ? stable
              : beta;
        if (targetRelease === null) return;
        if (await isUpdateSuppressed(targetRelease.version)) return;
        // 等待期间用户可能已经打开/关闭弹窗，或发起了新的检查。
        if (!mountedRef.current || requestId !== requestRef.current || visibleRef.current) return;
      }

      setStatus('available');
      setVisible(true);
    } finally {
      // 手动检查的按钮锁只在「这次请求仍是最新」时释放；关闭弹窗或新检查
      // 已经重置过锁时不要覆盖它们。
      if (manual && mountedRef.current && requestId === requestRef.current) {
        checkingRef.current = false;
        setChecking(false);
      }
    }
  }, []);

  const checkForUpdates = useCallback(() => {
    void runCheck(true);
  }, [runCheck]);

  const close = useCallback(() => {
    // 取消正在进行的检查：请求继续跑完也不会再改弹窗，按钮立刻恢复可用。
    if (checkingRef.current) {
      requestRef.current += 1;
      checkingRef.current = false;
      setChecking(false);
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const initialTimer = setTimeout(() => {
      void runCheck(false);
    }, INITIAL_CHECK_DELAY_MS);
    // 长期运行的桌面应用不会错过发版：启动检查之后每 6 小时复查一次。
    // 每次复查都会重新读取设置，用户中途关掉「自动检查更新」会立即生效。
    const intervalTimer = setInterval(() => {
      void runCheck(false);
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [runCheck]);

  const contextValue = useMemo<UseUpdatePromptResult>(
    () => ({ checkForUpdates, checking }),
    [checkForUpdates, checking],
  );

  return (
    <UpdatePromptContext.Provider value={contextValue}>
      {children}
      <AutoUpdateDialog
        visible={visible && status === 'available'}
        onClose={close}
        releases={releases}
        preferredChannel={preferredChannel}
      />
      <UpdateStatusDialog
        visible={visible && status !== 'available'}
        status={status === 'available' ? 'checking' : status}
        currentVersion={currentAppVersion()}
        releases={releases}
        failureReason={failureReason}
        onClose={close}
        onRetry={checkForUpdates}
      />
    </UpdatePromptContext.Provider>
  );
}
