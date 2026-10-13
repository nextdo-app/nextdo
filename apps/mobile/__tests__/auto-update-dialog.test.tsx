import React from 'react';
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
