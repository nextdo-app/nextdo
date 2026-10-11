/**
 * 「检查更新」按钮背后的状态机（设置页最后一个卡片）。
 *
 * 只做一件屏幕做不了的事：把 `lib/app-update` 的请求/比较结果翻译成
 * `checking` + 一次结论这两个 UI 状态。请求本身在
 * `fetchLatestRelease()` 里（hook-guidelines 的禁令是「hook 里不许直接
 * fetch」，所以网络调用留在 lib，hook 只调它）。
 *
 * 当前版本号与平台在挂载时读一次（它们在一次会话里不会变——版本号来自
 * app.json，平台来自 `Platform.OS`），所以不是 state，避免无谓重渲染。
 *
 * 屏幕负责把 `outcome` 翻成中文文案；hook 不持有任何文案。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  compareVersions,
  currentAppVersion,
  detectMacArch,
  detectUpdatePlatform,
  fetchLatestRelease,
  getChannelLabel,
  getReleaseChannel,
  isTauriDesktop,
  openDownloadedInstaller,
  pickDownloads,
  pollDesktopDownloadProgress,
  releasePageUrl,
  startDesktopDownload,
  type DesktopDownloadProgress,
  type MacArch,
  type ReleaseChannel,
  type ReleaseDownload,
  type UpdateFailureReason,
} from '@/lib/app-update';

/** 一次检查的结论。 */
export type UpdateOutcome =
  /** 本机已经是最新的。 */
  | { kind: 'up-to-date'; latestVersion: string }
  /** 有新版本，`downloads` 是当前平台能用的安装包（可能为空，见设置页文案）。 */
  | { kind: 'available'; latestVersion: string; downloads: ReleaseDownload[] }
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
  /** 检查进行中（按钮禁用 + 「检查中…」）。 */
  checking: boolean;
  /** 上一次检查的结论；还没查过是 `null`。 */
  outcome: UpdateOutcome | null;
  /** 手动触发一次检查（重复点由按钮的 `disabled` 挡住，这里也守一道）。 */
  check: () => void;
  /** release 页面地址（已加加速代理前缀），供「查看全部安装包」用。 */
  pageUrl: string;
  /** 是否运行在 Tauri 桌面壳中（决定是否显示应用内下载按钮）。 */
  isDesktop: boolean;
  /** 桌面端应用内下载状态。 */
  download: DownloadState;
  /** 桌面端启动应用内下载（传入安装包 URL）。 */
  startDownload: (url: string) => void;
  /** 桌面端打开已下载的安装包。 */
  openInstaller: () => void;
}

export function useAppUpdate(): UseAppUpdateResult {
  // 版本号 / 平台在一次会话里不变，所以不是 state——避免无谓的重渲染。
  const currentVersion = currentAppVersion();
  const channel = getReleaseChannel(currentVersion);
  const channelLabel = getChannelLabel(channel);
  const platform = detectUpdatePlatform();
  const isDesktop = isTauriDesktop();
  // 架构要问系统（桌面壳走 IPC，浏览器走 UA 高熵字段），是异步的，所以是
  // state。macOS 上一次会话只探测一次；其他平台根本不探测。
  const [macArch, setMacArch] = useState<MacArch | null>(null);
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const [download, setDownload] = useState<DownloadState>({ kind: 'idle' });
  // 请求在途时卸载（用户直接退出设置页）不要再写 state。
  const mountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current !== null) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (platform !== 'macos') return;
    void detectMacArch().then((arch) => {
      if (mountedRef.current) setMacArch(arch);
    });
  }, [platform]);

  const check = useCallback(() => {
    if (checking) return;
    setChecking(true);
    void Promise.all([
      fetchLatestRelease(channel),
      macArch !== null ? Promise.resolve(macArch) : platform === 'macos' ? detectMacArch() : Promise.resolve(null),
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
      const { release } = result;
      const downloads = pickDownloads(release, platform, resolvedArch);
      // 拿不到本机版本号时不做「有新版 / 无新版」的判断——直接把查到的
      // 最新版本和安装包摆出来，避免把一个未知值当成升级依据。
      const isNewer =
        currentVersion !== '' && compareVersions(release.version, currentVersion) > 0;
      setOutcome(
        isNewer || currentVersion === ''
          ? { kind: 'available', latestVersion: release.version, downloads }
          : { kind: 'up-to-date', latestVersion: release.version },
      );
    });
  }, [channel, checking, currentVersion, macArch, platform]);

  /** 开始桌面端应用内下载，并启动进度轮询。 */
  const startDownload = useCallback(
    (url: string) => {
      if (!isDesktop) return;
      if (download.kind === 'downloading') return;
      setDownload({ kind: 'downloading', downloadedBytes: 0, totalBytes: 0 });
      void startDesktopDownload(url).catch((e) => {
        if (mountedRef.current) {
          setDownload({ kind: 'error', error: String(e) });
        }
      });

      // 开始轮询进度
      if (pollTimerRef.current !== null) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => {
        void pollDesktopDownloadProgress().then((p: DesktopDownloadProgress) => {
          if (!mountedRef.current) return;
          if (p.state === 'downloading') {
            setDownload({
              kind: 'downloading',
              downloadedBytes: p.downloaded_bytes,
              totalBytes: p.total_bytes,
            });
          } else if (p.state === 'done') {
            setDownload({ kind: 'done', filePath: p.file_path });
            if (pollTimerRef.current !== null) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            // 下载完成后自动打开安装程序
            void openDownloadedInstaller(p.file_path).catch(() => {
              // 打开失败不影响 done 状态，用户可以手动点「打开安装包」
            });
          } else if (p.state === 'error') {
            setDownload({ kind: 'error', error: p.error });
            if (pollTimerRef.current !== null) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
          }
        });
      }, 400);
    },
    [isDesktop, download.kind],
  );

  /** 手动打开已下载的安装包。 */
  const openInstaller = useCallback(() => {
    if (download.kind !== 'done') return;
    void openDownloadedInstaller(download.filePath);
  }, [download]);

  return {
    currentVersion,
    channel,
    channelLabel,
    checking,
    outcome,
    check,
    pageUrl:
      outcome && outcome.kind === 'available' && channel !== 'stable'
        ? releasePageUrl(`v${outcome.latestVersion}`)
        : releasePageUrl(),
    isDesktop,
    download,
    startDownload,
    openInstaller,
  };
}