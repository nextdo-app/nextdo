import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AutoUpdateDialog,
  resetAnnouncedVersions,
} from '@/components/auto-update-dialog';
import { UPDATE_PROXY_PREFIX, type ReleaseInfo } from '@/lib/app-update';

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

describe('AutoUpdateDialog', () => {
  beforeEach(() => {
    resetAnnouncedVersions();
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

  it('requests install_update_and_restart instead of only opening the installer', async () => {
    jest.useFakeTimers();
    // Jest runs the suite as iOS (no installer); pretend the webview of the
    // Tauri desktop shell on macOS, exactly like the real shell reports it.
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    const installedPaths: string[] = [];
    const openedPaths: string[] = [];
    (globalThis as { window?: unknown }).window = {
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      __TAURI_INTERNALS__: {
        invoke: jest.fn(async (command: string, args?: { filePath?: string }) => {
          if (command === 'current_arch') return 'aarch64';
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
        }),
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
    // Let the macOS arch detection land so the platform installer is offered.
    await flush();

    fireEvent.press(screen.getByRole('button', { name: '立即更新' }));
    await flush();
    // 下载完成 → 按钮从「立即更新」切到「立即安装并重启」。
    const installButton = screen.getByRole('button', { name: '立即安装并重启' });
    expect(installButton).toBeTruthy();

    fireEvent.press(installButton);
    await flush();

    expect(installedPaths).toEqual(['/tmp/Nextdo_0.1.7_aarch64.dmg']);
    // 旧行为（把安装包丢回给用户手动处理）不能再出现。
    expect(openedPaths).toEqual([]);
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
  async function flush(rounds = 10): Promise<void> {
    let p: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < rounds; i++) {
      p = p.then(() => act(async () => {}));
    }
    await p;
  }

  it('downloads the ABI-matched apk and hands it to the system installer', async () => {
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
    // 等 ABI 探测落地，下载地址才会是这台机器的架构。
    await flush();

    fireEvent.press(screen.getByRole('button', { name: '立即更新' }));
    await flush();

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

    // 下载完成 → 自动调起系统安装器
    expect(mockStartActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://nextdo.file-provider/nextdo-update.apk',
      type: 'application/vnd.android.package-archive',
      flags: 1,
    });

    // 界面仍提供「立即安装」按钮以备重试
    fireEvent.press(screen.getByRole('button', { name: '立即安装' }));
    await flush();

    expect(mockStartActivityAsync).toHaveBeenCalledTimes(2);
  });
});
