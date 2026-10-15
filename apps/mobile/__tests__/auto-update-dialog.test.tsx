import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AutoUpdateDialog,
  resetAnnouncedVersions,
} from '@/components/auto-update-dialog';
import type { ReleaseInfo } from '@/lib/app-update';

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
