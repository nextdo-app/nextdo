/**
 * 全局自动更新检查提示弹窗与监听器（AutoUpdateNotifier & AutoUpdateDialog）。
 *
 * 设计灵感与行为对齐 tungsten-edge (SparkleUpdateService)：
 * 1. 静默检测：若开启自动更新偏好，在应用启动后后台低优先级检测；
 * 2. 温和提醒：同一个版本在同一个运行会话（session）中只主动提醒一次，用户点「稍后再说」后不重复弹窗骚扰；
 * 3. 完整透明：在用户做决定前，先完整展示该版本的更新日志（ChangeLog / Release Notes）；
 * 4. 自主选择：由用户决定立即下载更新还是稍后再说；
 * 5. 应用内安装：桌面壳（Tauri）下载后直接替换重启，Android 下载 APK 后直接调起
 *    系统安装器 —— 两条路都不再把用户丢去浏览器自己找安装包。
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getAutoUpdateCheckPreference,
  getUpdateChannelPreference,
  installAndroidUpdate,
  installDesktopUpdateAndRestart,
  isTauriDesktop,
  openDownloadedInstaller,
  openExternalUrl,
  pickDownloads,
  pollDesktopDownloadProgress,
  releasePageUrl,
  startDesktopDownload,
  type AndroidAbi,
  type DesktopDownloadProgress,
  type MacArch,
  type ReleaseDownload,
  type ReleaseInfo,
  type UpdateChannelPreference,
} from '@/lib/app-update';

/** 在本次运行期间已主动提醒过的版本（内存态，重启前不重复打扰）。 */
const announcedVersions = new Set<string>();

/** 清空已提醒版本集合（测试用）。 */
export function resetAnnouncedVersions(): void {
  announcedVersions.clear();
}

/** 标记某版本为已提醒。 */
export function markVersionAnnounced(version: string): void {
  announcedVersions.add(version);
}

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

  // 初始化选中的渠道
  useEffect(() => {
    if (preferredChannel === 'beta' && betaIsNewer) {
      setSelectedChannel('beta');
    } else if (stableIsNewer) {
      setSelectedChannel('stable');
    } else if (betaIsNewer) {
      setSelectedChannel('beta');
    }
  }, [preferredChannel, stableIsNewer, betaIsNewer]);

  const activeRelease: ReleaseInfo | null =
    selectedChannel === 'beta' ? beta ?? stable : stable ?? beta;

  const downloads: ReleaseDownload[] = useMemo(() => {
    if (!activeRelease) return [];
    return pickDownloads(activeRelease, platform, macArch, androidAbi);
  }, [activeRelease, platform, macArch, androidAbi]);

  const activeDownloadUrl = downloads[0]?.url;

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

  const handleStartDownload = useCallback(() => {
    if (!activeDownloadUrl) {
      if (activeRelease) {
        void openExternalUrl(releasePageUrl(activeRelease.tag));
      }
      return;
    }

    if (canInstallInApp) {
      // 安卓：下到应用缓存，下完的「完成态」再由用户一键交给系统安装器。
      setInstallError(null);
      setDownloadState({ kind: 'downloading', downloadedBytes: 0, totalBytes: 0 });
      void downloadAndroidUpdate(activeDownloadUrl, (progress) => {
        setDownloadState({
          kind: 'downloading',
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
        });
      })
        .then((fileUri) => {
          setDownloadState({ kind: 'done', filePath: fileUri });
        })
        .catch((err) => {
          setDownloadState({ kind: 'error', error: String(err) });
        });
      return;
    }

    if (!isDesktop) {
      void openExternalUrl(activeDownloadUrl);
      return;
    }

    setDownloadState({ kind: 'downloading', downloadedBytes: 0, totalBytes: 0 });
    void startDesktopDownload(activeDownloadUrl).catch((err) => {
      setDownloadState({ kind: 'error', error: String(err) });
    });

    stopPolling();

    const checkProgress = () => {
      void pollDesktopDownloadProgress().then((p: DesktopDownloadProgress) => {
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
  }, [activeDownloadUrl, activeRelease, canInstallInApp, isDesktop, stopPolling]);

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

  if (!visible || !activeRelease) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        testID="auto-update-dialog-backdrop"
        className="flex-1 items-center justify-center bg-black/60 p-4"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭更新弹窗"
          className="absolute inset-0"
          onPress={onClose}
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
            <Text className="pb-3 font-sans text-xs text-muted dark:text-muted-dark">
              安装包已下载完成。点「立即安装」会打开系统安装程序；首次安装需允许 Nextdo
              「安装未知应用」。安装成功后应用会自动重启。
            </Text>
          ) : null}

          {installError ? (
            <View className="gap-1 pb-3">
              <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                安装启动失败：{installError}
              </Text>
              {/* 静默替换 / 调起安装器都可能失败（无写权限、ROM 限制、未授权安装
                  未知应用）；失败时留一条兜底通道，而不是把用户卡在弹窗里。 */}
              {canInstallInApp ? (
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
          <View className="flex-row items-center justify-end gap-2.5 pt-2">
            <Button
              label="稍后再说"
              variant="secondary"
              onPress={onClose}
              disabled={downloadState.kind === 'downloading' || installing}
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
                onPress={handleStartDownload}
                disabled={downloadState.kind === 'downloading'}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
});

/**
 * 自动更新监听与提醒控制器（挂载在根视图）。
 */
export function AutoUpdateNotifier() {
  const [modalVisible, setModalVisible] = useState(false);
  const [releases, setReleases] = useState<{
    stable: ReleaseInfo | null;
    beta: ReleaseInfo | null;
  }>({ stable: null, beta: null });
  const [prefChannel, setPrefChannel] = useState<UpdateChannelPreference>('stable');

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const timer = setTimeout(async () => {
      try {
        const autoCheck = await getAutoUpdateCheckPreference();
        if (!autoCheck || !mountedRef.current) return;

        const pref = await getUpdateChannelPreference();
        if (!mountedRef.current) return;
        setPrefChannel(pref);

        const result = await fetchDualChannelReleases();
        if (!result.ok || !mountedRef.current) return;

        const currentVer = currentAppVersion();
        const { stable, beta } = result.releases;

        const stableIsNewer =
          stable !== null && (currentVer === '' || compareVersions(stable.version, currentVer) > 0);
        const betaIsNewer =
          beta !== null && (currentVer === '' || compareVersions(beta.version, currentVer) > 0);

        if (!stableIsNewer && !betaIsNewer) return;

        // 挑选目标版本
        const targetRelease =
          pref === 'beta'
            ? betaIsNewer && beta
              ? beta
              : stable
            : stableIsNewer && stable
              ? stable
              : beta;

        if (!targetRelease) return;

        // 若本次会话尚未提醒过该版本，则弹出提示
        if (!announcedVersions.has(targetRelease.version)) {
          announcedVersions.add(targetRelease.version);
          setReleases({ stable, beta });
          setModalVisible(true);
        }
      } catch {
        // 静默检查，异常不阻断应用
      }
    }, 1500);

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, []);

  const handleClose = useCallback(() => {
    setModalVisible(false);
  }, []);

  return (
    <AutoUpdateDialog
      visible={modalVisible}
      onClose={handleClose}
      releases={releases}
      preferredChannel={prefChannel}
    />
  );
}
