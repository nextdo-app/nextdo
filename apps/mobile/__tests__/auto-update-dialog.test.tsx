import React from 'react';
import { Button, Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AutoUpdateDialog,
  UpdatePromptProvider,
  useUpdatePrompt,
} from '@/components/auto-update-dialog';
import {
  UPDATE_PROXY_PREFIX,
  UPDATE_SNOOZE_DURATION_MS,
  isUpdateSuppressed,
  setAutoDownloadPreference,
  setAutoUpdateCheckPreference,
  setUpdateChannelPreference,
  type ReleaseInfo,
} from '@/lib/app-update';

/**
 * 安卓安装路径要用的三个原生模块。`lib/app-update` 是「按需 require」它们的
 * （web / 桌面壳里根本不加载），所以这里用工厂 mock 替掉即可，
 * 不影响同一文件里的桌面壳用例。
 */
const mockDownloadFileAsync = jest.fn();
const mockStartActivityAsync = jest.fn();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    contentUri: string;
    constructor(...uris: unknown[]) {
      const first = uris[0];
      this.uri = typeof first === 'string' ? first : 'file:///cache/nextdo-update.apk';
      // FileProvider 生成的 content:// 地址 —— 断言的就是这个值。
      this.contentUri = 'content://nextdo.file-provider/nextdo-update.apk';
    }
    static downloadFileAsync = mockDownloadFileAsync;
  }
  return { File: MockFile, Paths: { cache: { uri: 'file:///cache' } } };
});

jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: mockStartActivityAsync,
}));

jest.mock('expo-device', () => ({
  supportedCpuArchitectures: ['arm64-v8a', 'armeabi-v7a', 'armeabi'],
}));

/** Flush the storage-write promise chains triggered by fireEvent. */
async function flushPromises(rounds = 6): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

describe('AutoUpdateDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockStable: ReleaseInfo = {
    tag: 'v0.1.7',
    version: '0.1.7',
    channel: 'stable',
    channelLabel: '正式版',
    publishedAt: '2026-10-13T08:00:00Z',
    notes: '• 核心特性：自动检测更新\n• 修复若干界面交互问题',
  };

  const mockBeta: ReleaseInfo = {
    tag: 'v0.1.8-beta.1',
    version: '0.1.8-beta.1',
    channel: 'beta',
    channelLabel: '测试版',
    publishedAt: '2026-10-14T08:00:00Z',
    notes: '• 预览体验版\n• 实验性新组件',
  };

  it('renders update dialog with version, badge, and changelog', () => {
    const handleClose = jest.fn();
    render(
      <AutoUpdateDialog
        visible={true}
        onClose={handleClose}
        releases={{ stable: mockStable, beta: null }}
        preferredChannel="stable"
      />,
    );

    expect(screen.getByText('发现新版本')).toBeTruthy();
    expect(screen.getByText('v0.1.7')).toBeTruthy();
    expect(screen.getByText('正式版')).toBeTruthy();
    expect(screen.getByText('更新说明 (ChangeLog)')).toBeTruthy();
    expect(screen.getByText(/自动检测更新/)).toBeTruthy();
    expect(screen.getByText(/修复若干界面交互问题/)).toBeTruthy();

    const laterBtn = screen.getByRole('button', { name: '稍后再说' });
    expect(laterBtn).toBeTruthy();
    fireEvent.press(laterBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('allows toggling between stable and beta release tabs and updates changelog', () => {
    render(
      <AutoUpdateDialog
        visible={true}
        onClose={jest.fn()}
        releases={{ stable: mockStable, beta: mockBeta }}
        preferredChannel="stable"
      />,
    );

    // Initial preference is stable
    expect(screen.getByText('v0.1.7')).toBeTruthy();
    expect(screen.getByText(/自动检测更新/)).toBeTruthy();

    const betaTab = screen.getByRole('button', { name: '切换到测试版' });
    expect(betaTab).toBeTruthy();

    act(() => {
      fireEvent.press(betaTab);
    });

    // Switched to beta
    expect(screen.getByText('v0.1.8-beta.1')).toBeTruthy();
    expect(screen.getByText(/预览体验版/)).toBeTruthy();
    expect(screen.getByText(/实验性新组件/)).toBeTruthy();
  });

  it('renders fallback copy when no changelog notes provided', () => {
    const emptyNotesRelease: ReleaseInfo = {
      ...mockStable,
      notes: null,
    };

    render(
      <AutoUpdateDialog
        visible={true}
        onClose={jest.fn()}
        releases={{ stable: emptyNotesRelease, beta: null }}
        preferredChannel="stable"
      />,
    );

    expect(screen.getByText(/该版本暂未提供更新说明/)).toBeTruthy();
  });

  it('「稍后再说」snoozes the advertised version', async () => {
    const laterRelease: ReleaseInfo = {
      ...mockStable,
      tag: 'v0.1.9',
      version: '0.1.9',
    };
    const handleClose = jest.fn();

    render(
      <AutoUpdateDialog
        visible={true}
        onClose={handleClose}
        releases={{ stable: laterRelease, beta: null }}
        preferredChannel="stable"
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: '稍后再说' }));
    await flushPromises();

    expect(handleClose).toHaveBeenCalledTimes(1);
    // 下次启动 / 下一轮定时复查不会再为同一版本弹窗。
    expect(await isUpdateSuppressed('0.1.9')).toBe(true);
  });

  it('「跳过此版本」keeps that version quiet', async () => {
    const skippedRelease: ReleaseInfo = {
      ...mockStable,
      tag: 'v0.1.10',
      version: '0.1.10',
    };
    const handleClose = jest.fn();

    render(
      <AutoUpdateDialog
        visible={true}
        onClose={handleClose}
        releases={{ stable: skippedRelease, beta: null }}
        preferredChannel="stable"
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: '跳过此版本' }));
    await flushPromises();

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(await isUpdateSuppressed('0.1.10')).toBe(true);
  });
});

/**
 * 桌面端（Tauri 壳）的安装路径：按下「立即安装并重启」必须请求
 * `install_update_and_restart` —— Rust 侧会静默替换应用包并重启，用户不必
 * 手动退出应用。只调 `open_downloaded_file`（把 DMG/exe 丢给用户拖拽）是
 * 这次要修掉的旧行为。
 */
describe('AutoUpdateDialog - desktop in-app install', () => {
  const desktopRelease: ReleaseInfo = {
    tag: 'v0.1.7',
    version: '0.1.7',
    channel: 'stable',
    channelLabel: '正式版',
    publishedAt: '2026-10-13T08:00:00Z',
    notes: '• 常规维护与改进',
  };

  const originalOS = Platform.OS;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    (globalThis as { window?: unknown }).window = undefined;
  });

  /** Flush the download → first progress poll → install promise chain. */
  async function flush(rounds = 10): Promise<void> {
    let p: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < rounds; i++) {
      p = p.then(() => act(async () => {}));
    }
    await p;
  }

  it('auto-downloads the installer, then installs and restarts without a download click', async () => {
    jest.useFakeTimers();
    await setAutoDownloadPreference(true);
    // Jest runs the suite as iOS (no installer); pretend the webview of the
    // Tauri desktop shell on macOS, exactly like the real shell reports it.
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    const downloadedUrls: string[] = [];
    const installedPaths: string[] = [];
    const openedPaths: string[] = [];
    (globalThis as { window?: unknown }).window = {
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      __TAURI_INTERNALS__: {
        invoke: jest.fn(
          async (command: string, args?: { url?: string; filePath?: string }) => {
            if (command === 'current_arch') return 'aarch64';
            if (command === 'download_update' && args?.url !== undefined) {
              downloadedUrls.push(args.url);
            }
            if (command === 'get_download_progress') {
              return {
                state: 'done',
                downloaded_bytes: 12,
                total_bytes: 12,
                file_path: '/tmp/Nextdo_0.1.7_aarch64.dmg',
                error: '',
              };
            }
            if (command === 'install_update_and_restart' && args?.filePath !== undefined) {
              installedPaths.push(args.filePath);
            }
            if (command === 'open_downloaded_file' && args?.filePath !== undefined) {
              openedPaths.push(args.filePath);
            }
            return undefined;
          },
        ),
      },
    };

    render(
      <AutoUpdateDialog
        visible={true}
        onClose={jest.fn()}
        releases={{ stable: desktopRelease, beta: null }}
        preferredChannel="stable"
      />,
    );
    // Let the macOS arch detection, automatic download and first progress
    // poll land — no user interaction needed to reach the install state.
    await flush();

    expect(downloadedUrls).toEqual([
      `${UPDATE_PROXY_PREFIX}https://github.com/nextdo-app/nextdo/releases/download/v0.1.7/Nextdo_0.1.7_aarch64.dmg`,
    ]);
    // 下载完成 → 按钮直接是「立即安装并重启」（不用先点「立即更新」）。
    const installButton = screen.getByRole('button', { name: '立即安装并重启' });
    expect(installButton).toBeTruthy();

    fireEvent.press(installButton);
    await flush();

    expect(installedPaths).toEqual(['/tmp/Nextdo_0.1.7_aarch64.dmg']);
    // 旧行为（把安装包丢回给用户手动处理）不能再出现。
    expect(openedPaths).toEqual([]);
  });

  it('keeps the user-selected beta channel when the download finishes', async () => {
    jest.useFakeTimers();
    await setAutoDownloadPreference(false);
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    const betaRelease: ReleaseInfo = {
      ...desktopRelease,
      tag: 'v0.1.8-beta.1',
      version: '0.1.8-beta.1',
      channel: 'beta',
      channelLabel: '测试版',
    };
    const downloadedUrls: string[] = [];
    const installedPaths: string[] = [];
    let done = false;
    (globalThis as { window?: unknown }).window = {
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      __TAURI_INTERNALS__: {
        invoke: jest.fn(
          async (command: string, args?: { url?: string; filePath?: string }) => {
            if (command === 'current_arch') return 'aarch64';
            if (command === 'download_update' && args?.url !== undefined) {
              downloadedUrls.push(args.url);
            }
            if (command === 'get_download_progress') {
              return {
                state: done ? 'done' : 'downloading',
                downloaded_bytes: done ? 12 : 1,
                total_bytes: 12,
                file_path: '/tmp/Nextdo_0.1.8-beta.1_aarch64.dmg',
                error: '',
              };
            }
            if (command === 'install_update_and_restart' && args?.filePath !== undefined) {
              installedPaths.push(args.filePath);
            }
            return undefined;
          },
        ),
      },
    };

    render(
      <AutoUpdateDialog
        visible={true}
        onClose={jest.fn()}
        releases={{ stable: desktopRelease, beta: betaRelease }}
        preferredChannel="stable"
      />,
    );
    await flush();

    // 用户在弹窗里主动选 beta 并开始下载。设置页偏好仍是 stable。
    fireEvent.press(screen.getByRole('button', { name: '切换到测试版' }));
    expect(screen.getByText('v0.1.8-beta.1')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '立即更新' }));
    await flush();
    expect(downloadedUrls).toHaveLength(1);
    expect(downloadedUrls[0]).toContain('Nextdo_0.1.8-beta.1_aarch64.dmg');

    // 下载完成时，偏好 effect 重新运行也不能把用户选的 beta 切回 stable。
    done = true;
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await flush();
    expect(screen.getByText('v0.1.8-beta.1')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '立即安装并重启' }));
    await flush();
    expect(installedPaths).toEqual(['/tmp/Nextdo_0.1.8-beta.1_aarch64.dmg']);
  });
});

/**
 * 安卓的应用内安装路径：APK 下到应用缓存，再把 content:// 交给系统安装器。
 * 旧行为是把 APK 地址丢给浏览器 —— 用户回来还得自己在文件管理器里点安装。
 */
describe('AutoUpdateDialog - Android in-app install', () => {
  const androidRelease: ReleaseInfo = {
    tag: 'v0.1.7',
    version: '0.1.7',
    channel: 'stable',
    channelLabel: '正式版',
    publishedAt: '2026-10-13T08:00:00Z',
    notes: '• 常规维护与改进',
  };

  const originalOS = Platform.OS;

  beforeEach(() => {
    mockDownloadFileAsync.mockReset();
    mockStartActivityAsync.mockReset();
    // jest 默认按 iOS 跑；这里伪装成真实安卓机（系统报的是 arm64 ABI）。
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  /** 让 ABI 探测 / 下载 / 安装的 promise 链全部落地。 */
  async function flush(rounds = 30): Promise<void> {
    let p: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < rounds; i++) {
      p = p.then(() => act(async () => {}));
    }
    await p;
  }

  it('auto-downloads the ABI-matched apk but waits for the user before installing', async () => {
    await setAutoDownloadPreference(true);
    mockDownloadFileAsync.mockResolvedValue({
      uri: 'file:///data/cache/nextdo-update.apk',
      contentUri: 'content://nextdo.file-provider/nextdo-update.apk',
    });
    mockStartActivityAsync.mockResolvedValue({ resultCode: 0 });

    render(
      <AutoUpdateDialog
        visible={true}
        onClose={jest.fn()}
        releases={{ stable: androidRelease, beta: null }}
        preferredChannel="stable"
      />,
    );
    // The auto-download preference resolves in a microtask right after mount —
    // open an act scope before it lands so the state update is not flagged.
    await act(async () => {});
    // 等 ABI 探测落地，自动下载才会用这台机器的架构。
    await flush();

    // 后台自动下载已经开始 —— 用户没点任何按钮。
    expect(mockDownloadFileAsync).toHaveBeenCalledTimes(1);
    const [url, , options] = mockDownloadFileAsync.mock.calls[0] as [
      string,
      unknown,
      { idempotent?: boolean },
    ];
    expect(url).toBe(
      `${UPDATE_PROXY_PREFIX}https://github.com/nextdo-app/nextdo/releases/download/v0.1.7/Nextdo_0.1.7_android_arm64-v8a.apk`,
    );
    // 覆盖式下载：重试不必先清缓存。
    expect(options.idempotent).toBe(true);

    // 自动下载不自动安装：安装决定留给用户。
    expect(mockStartActivityAsync).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: '立即安装' }));
    await flush();

    expect(mockStartActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://nextdo.file-provider/nextdo-update.apk',
      type: 'application/vnd.android.package-archive',
      flags: 1,
    });
    expect(mockStartActivityAsync).toHaveBeenCalledTimes(1);
  });

  it('manual 立即更新 still downloads and opens the installer in one click when auto download is off', async () => {
    await setAutoDownloadPreference(false);
    mockDownloadFileAsync.mockResolvedValue({
      uri: 'file:///data/cache/nextdo-update.apk',
      contentUri: 'content://nextdo.file-provider/nextdo-update.apk',
    });
    mockStartActivityAsync.mockResolvedValue({ resultCode: 0 });

    render(
      <AutoUpdateDialog
        visible={true}
        onClose={jest.fn()}
        releases={{ stable: androidRelease, beta: null }}
        preferredChannel="stable"
      />,
    );
    // The auto-download preference resolves in a microtask right after mount —
    // open an act scope before it lands so the state update is not flagged.
    await act(async () => {});
    await flush();

    // 关掉自动下载后，后台不动；用户点击「立即更新」才下载并调起安装器。
    expect(mockDownloadFileAsync).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: '立即更新' }));
    await flush();

    expect(mockDownloadFileAsync).toHaveBeenCalledTimes(1);
    expect(mockStartActivityAsync).toHaveBeenCalledTimes(1);
  });
});

/**
 * 后台监听器：启动检查之外，运行期间按周期复查；「稍后再说」在静默期内
 * 不重复弹窗，静默期过后重新提醒。
 */
describe('UpdatePromptProvider - periodic background checks', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });

  /** Flush the storage + fetch promise chains under fake timers. */
  async function flush(rounds = 12): Promise<void> {
    let p: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < rounds; i++) {
      p = p.then(() => act(async () => {}));
    }
    await p;
  }

  const atomXml = `
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v9.9.0"/>
        <updated>2026-11-19T00:00:00Z</updated>
        <content type="html">&lt;p&gt;nightly build&lt;/p&gt;</content>
      </entry>
    </feed>
  `;

  it('checks at startup, re-checks while running, and respects the snooze window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-19T00:00:00Z'));
    await setAutoUpdateCheckPreference(true);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => atomXml,
    }) as unknown as typeof fetch;

    render(<UpdatePromptProvider />);

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await flush();
    expect(screen.getByText('发现新版本')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '稍后再说' }));
    await flush();
    expect(screen.queryByText('发现新版本')).toBeNull();

    const callsAfterPrompt = (globalThis.fetch as jest.Mock).mock.calls.length;

    // 6 小时后复查照常发出请求，但同一版本仍在 24 小时静默期内。
    await act(async () => {
      jest.advanceTimersByTime(AUTO_UPDATE_CHECK_INTERVAL_MS);
    });
    await flush();
    expect((globalThis.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(callsAfterPrompt);
    expect(screen.queryByText('发现新版本')).toBeNull();

    // 静默期结束后，下一轮复查重新提醒。
    await act(async () => {
      jest.advanceTimersByTime(UPDATE_SNOOZE_DURATION_MS);
    });
    await flush();
    expect(screen.getByText('发现新版本')).toBeTruthy();
  });
});

/**
 * 手动入口的完整下载保护场景：stable 安装包还在下载时，用户「稍后再说」
 * 关闭弹窗、把渠道改成 beta、再次手动检查。原生下载仍是 stable 任务，因此
 * 弹窗重新打开的是该任务而不是 beta；旧下载的进度 / 完成态不得写回，也
 * 绝不能让「立即安装并重启」拿到 stable 的安装包。
 */
describe('UpdatePromptProvider - manual recheck during an active download', () => {
  const originalOS = Platform.OS;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    (globalThis as { window?: unknown }).window = undefined;
    await setAutoDownloadPreference(true);
    await setUpdateChannelPreference('stable');
  });

  /** Flush the provider check + desktop download promise chains. */
  async function flush(rounds = 25): Promise<void> {
    let p: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < rounds; i++) {
      p = p.then(() => act(async () => {}));
    }
    await p;
  }

  function ManualCheckButton() {
    const prompt = useUpdatePrompt();
    return <Button title="manual-check" onPress={prompt.checkForUpdates} />;
  }

  it('never installs the stable package after switching to beta mid-download', async () => {
    jest.useFakeTimers();
    await setAutoDownloadPreference(false);
    await setAutoUpdateCheckPreference(false);
    await setUpdateChannelPreference('stable');
    // Tauri 桌面壳的 webview：同一套 IPC 命令，可精确控制下载何时完成。
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    const downloadedUrls: string[] = [];
    const installedPaths: string[] = [];
    let downloadDone = false;
    (globalThis as { window?: unknown }).window = {
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      __TAURI_INTERNALS__: {
        invoke: jest.fn(async (command: string, args?: { url?: string; filePath?: string }) => {
          if (command === 'current_arch') return 'aarch64';
          if (command === 'download_update' && args?.url !== undefined) {
            downloadedUrls.push(args.url);
          }
          if (command === 'get_download_progress') {
            return {
              state: downloadDone ? 'done' : 'downloading',
              downloaded_bytes: downloadDone ? 100 : 10,
              total_bytes: 100,
              file_path: '/tmp/Nextdo_9.9.0_aarch64.dmg',
              error: '',
            };
          }
          if (command === 'install_update_and_restart' && args?.filePath !== undefined) {
            installedPaths.push(args.filePath);
          }
          return undefined;
        }),
      },
    };

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v9.9.0"/>
            <updated>2026-11-20T00:00:00Z</updated>
            <content type="html">stable notes</content>
          </entry>
          <entry>
            <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v9.9.1-beta.1"/>
            <updated>2026-11-21T00:00:00Z</updated>
            <content type="html">beta notes</content>
          </entry>
        </feed>
      `,
    }) as unknown as typeof fetch;

    render(
      <UpdatePromptProvider>
        <ManualCheckButton />
      </UpdatePromptProvider>,
    );

    // 1. 手动检查出 stable，点「立即更新」开始下载。
    fireEvent.press(screen.getByText('manual-check'));
    await flush();
    expect(screen.getByText('v9.9.0')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '立即更新' }));
    await flush();
    expect(downloadedUrls).toHaveLength(1);
    expect(downloadedUrls[0]).toContain('Nextdo_9.9.0_aarch64.dmg');

    // 2. 下载未结束时关闭弹窗，改渠道为 beta，再次手动检查。
    fireEvent.press(screen.getByRole('button', { name: '稍后再说' }));
    await flush(6);
    await setUpdateChannelPreference('beta');
    fireEvent.press(screen.getByText('manual-check'));
    await flush();

    // 原生桌面下载是全局单槽：任务未结束时手动入口重新打开的是**该任务**，
    // 不是 beta。此时不能出现可点的「立即更新」，也不会发起第二次下载。
    expect(screen.getByText('v9.9.0')).toBeTruthy();
    expect(screen.queryByText('v9.9.1-beta.1')).toBeNull();
    expect(screen.queryByRole('button', { name: '立即更新' })).toBeNull();
    expect(downloadedUrls).toHaveLength(1);

    // 3. stable 的下载此时才完成。任务结束后才允许切到 beta；旧任务的结果
    //    不得变成 beta 的安装包，「立即安装并重启」也不能出现。
    downloadDone = true;
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await flush();
    expect(screen.getByText('v9.9.1-beta.1')).toBeTruthy();
    expect(screen.queryByText(/正在下载/)).toBeNull();
    expect(screen.queryByRole('button', { name: '立即安装并重启' })).toBeNull();
    expect(installedPaths).toEqual([]);
  });
});
