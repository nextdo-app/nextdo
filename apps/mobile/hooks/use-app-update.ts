/**
 * 「应用更新」卡片背后的偏好状态。
 *
 * 版本检查、更新说明、下载与安装全部由 `components/auto-update-dialog.tsx`
 * 的共享更新弹窗负责 —— 后台定时检查与设置页手动「检查更新」共用同一个
 * 弹窗和交互。本 hook 只保存卡片需要展示与切换的内容：当前版本、渠道，
 * 以及三个设备本地偏好（渠道偏好、自动检查、自动下载）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canInstallUpdateInApp,
  currentAppVersion,
  getAutoDownloadPreference,
  getAutoUpdateCheckPreference,
  getChannelLabel,
  getReleaseChannel,
  getUpdateChannelPreference,
  isTauriDesktop,
  setAutoDownloadPreference,
  setAutoUpdateCheckPreference,
  setUpdateChannelPreference,
  type ReleaseChannel,
  type UpdateChannelPreference,
} from '@/lib/app-update';

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
  /** 是否运行在 Tauri 桌面壳中（决定是否显示自动下载开关）。 */
  isDesktop: boolean;
  /** 是否能走应用内安装（桌面壳或带原生模块的安卓构建）。 */
  canInstallInApp: boolean;
}

export function useAppUpdate(): UseAppUpdateResult {
  // 版本号 / 平台在一次会话里不变，所以不是 state——避免无谓的重渲染。
  const currentVersion = currentAppVersion();
  const channel = getReleaseChannel(currentVersion);
  const channelLabel = getChannelLabel(channel);
  const isDesktop = isTauriDesktop();
  // 安卓构建：下载 APK 后直接调起系统安装器（模块缺失时退回浏览器下载）。
  const canInstallInApp = canInstallUpdateInApp();

  const [preferredChannel, setPreferredChannelState] = useState<UpdateChannelPreference>(
    channel !== 'stable' ? 'beta' : 'stable',
  );
  const [autoCheckEnabled, setAutoCheckEnabledState] = useState(true);
  const [autoDownloadEnabled, setAutoDownloadEnabledState] = useState(true);

  const mountedRef = useRef(true);

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
    };
  }, []);

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
    isDesktop,
    canInstallInApp,
  };
}
