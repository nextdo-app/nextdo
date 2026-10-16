/**
 * Unit tests — the update check's pure layer (lib/app-update).
 *
 * The contract these pin: **no GitHub URL ever leaves the app un-proxied**.
 * `viaProxy` / `latestReleaseUrl` / `releasePageUrl` / `pickDownloads` are
 * the only ways a URL reaches the user or the network, so every assertion
 * below is on the prefixed form. `fetchLatestRelease` and the runtime probes
 * (`detectUpdatePlatform` / `currentAppVersion`) are exercised end-to-end in
 * `__tests__/settings-screen.test.tsx`.
 */
import { Linking } from 'react-native';
import {
  UPDATE_PROXY_PREFIX,
  cleanAtomReleaseNotes,
  compareVersions,
  currentAppChannel,
  detectMacArch,
  fetchDualChannelReleases,
  fetchLatestRelease,
  formatReleaseDate,
  getAutoUpdateCheckPreference,
  getChannelLabel,
  getReleaseChannel,
  getUpdateChannelPreference,
  installDesktopUpdateAndRestart,
  isPrerelease,
  isTauriDesktop,
  latestReleaseUrl,
  openDownloadedInstaller,
  openExternalUrl,
  parseAtomFeedEntries,
  parseAtomFeedTags,
  parseLatestTag,
  pickAndroidAbi,
  pickDownloads,
  pickDualChannelReleases,
  pickLatestReleaseForChannel,
  pollDesktopDownloadProgress,
  releasePageUrl,
  releasesAtomUrl,
  setAutoUpdateCheckPreference,
  setUpdateChannelPreference,
  startDesktopDownload,
  viaProxy,
  type LatestRelease,
  type ReleaseInfo,
} from './app-update';

const PREFIX = UPDATE_PROXY_PREFIX;
const DOWNLOAD = 'https://github.com/nextdo-app/nextdo/releases/download';
const TAG = 'v0.1.4';

function release(tag = TAG): LatestRelease {
  return { tag, version: tag.replace(/^v/i, '') };
}

describe('proxy prefixing', () => {
  it('every URL is served through the accelerator, never straight from GitHub', () => {
    expect(PREFIX).toBe('https://proxyd.picpi.top/');
    expect(viaProxy('https://github.com/a/b')).toBe(`${PREFIX}https://github.com/a/b`);
    expect(latestReleaseUrl()).toBe(`${PREFIX}https://github.com/nextdo-app/nextdo/releases/latest`);
    expect(releasePageUrl()).toBe(`${PREFIX}https://github.com/nextdo-app/nextdo/releases/latest`);
    expect(releasePageUrl('v0.1.5-beta.3')).toBe(`${PREFIX}https://github.com/nextdo-app/nextdo/releases/tag/v0.1.5-beta.3`);
    expect(releasesAtomUrl()).toBe(`${PREFIX}https://github.com/nextdo-app/nextdo/releases.atom`);
  });

  it('the version query does NOT use the GitHub API (a shared proxy IP gets rate-limited)', () => {
    expect(latestReleaseUrl()).not.toContain('api.github.com');
  });
});

describe('compareVersions', () => {
  it.each([
    ['0.1.4', '0.1.3', 1],
    ['0.1.3', '0.1.4', -1],
    ['0.1.3', '0.1.3', 0],
    // The `v` tag prefix is irrelevant.
    ['v0.2.0', '0.1.9', 1],
    // Missing segments read as zeros, so short and long forms tie.
    ['0.2', '0.2.0', 0],
    ['0.2.1', '0.2', 1],
    // Ten beats nine — a plain string compare would get this wrong.
    ['0.1.10', '0.1.9', 1],
    ['0.10.0', '0.9.9', 1],
    // A release outranks its own prereleases — this app's daily case
    // (local build 0.1.3-beta.1 vs published v0.1.3).
    ['0.1.3', '0.1.3-beta.1', 1],
    ['0.1.3-beta.1', '0.1.3', -1],
    ['0.1.4-beta.2', '0.1.4-beta.1', 1],
    ['0.1.4-beta.1', '0.1.4-beta.1', 0],
  ])('compareVersions(%s, %s) = %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('release channel identification (Issue #14)', () => {
  it.each([
    ['0.1.4', 'stable'],
    ['v1.0.0', 'stable'],
    ['0.1.5-beta.1', 'beta'],
    ['v0.1.5-beta.2', 'beta'],
    ['0.2.0-alpha.1', 'alpha'],
    ['0.2.0-rc.1', 'rc'],
    ['0.2.0-preview.1', 'dev'],
  ])('getReleaseChannel(%s) returns %s', (version, expectedChannel) => {
    expect(getReleaseChannel(version)).toBe(expectedChannel);
  });

  it.each([
    ['0.1.4', false],
    ['v1.0.0', false],
    ['0.1.5-beta.1', true],
    ['0.2.0-alpha.1', true],
    ['0.2.0-rc.1', true],
  ])('isPrerelease(%s) returns %s', (version, expected) => {
    expect(isPrerelease(version)).toBe(expected);
  });

  it('getChannelLabel maps channels to user-friendly Chinese labels', () => {
    expect(getChannelLabel('stable')).toBe('正式版');
    expect(getChannelLabel('beta')).toBe('测试版');
    expect(getChannelLabel('alpha')).toBe('内测版');
    expect(getChannelLabel('rc')).toBe('候选版');
    expect(getChannelLabel('dev')).toBe('开发版');
  });

  it('currentAppChannel reads channel from currentAppVersion', () => {
    // In test environment, expoConfig.version is defined
    const channel = currentAppChannel();
    expect(['stable', 'beta', 'alpha', 'rc', 'dev']).toContain(channel);
  });
});

describe('parseLatestTag', () => {
  it('reads the tag out of the post-redirect URL, proxy prefix and all', () => {
    expect(parseLatestTag(`${PREFIX}https://github.com/nextdo-app/nextdo/releases/tag/v0.1.3`)).toBe(
      'v0.1.3',
    );
  });

  it('does not anchor on the host, so a different proxy domain still parses', () => {
    expect(parseLatestTag('https://another-proxy.example/https://github.com/a/b/releases/tag/v2.0.0')).toBe(
      'v2.0.0',
    );
  });

  it('keeps a prerelease tag intact', () => {
    expect(parseLatestTag(`${PREFIX}https://github.com/a/b/releases/tag/v1.2.3-beta.4`)).toBe(
      'v1.2.3-beta.4',
    );
  });

  it.each([
    ['the un-redirected URL', `${PREFIX}https://github.com/nextdo-app/nextdo/releases/latest`],
    ['an unrelated URL', 'https://example.com/'],
    ['a bare v tag', `${PREFIX}https://github.com/a/b/releases/tag/v`],
  ])('returns null for %s rather than throwing', (_label, url) => {
    expect(parseLatestTag(url)).toBeNull();
  });
});

describe('parseAtomFeedTags', () => {
  it('extracts unique release tags from atom xml feed in order', () => {
    const sampleXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>tag:github.com,2008:Repository/123/v0.1.5-beta.3</id>
          <link rel="alternate" type="text/html" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.5-beta.3"/>
          <title>Nextdo v0.1.5-beta.3</title>
        </entry>
        <entry>
          <id>tag:github.com,2008:Repository/123/v0.1.5-beta.2</id>
          <link rel="alternate" type="text/html" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.5-beta.2"/>
          <title>Nextdo v0.1.5-beta.2</title>
        </entry>
        <entry>
          <id>tag:github.com,2008:Repository/123/v0.1.4</id>
          <link rel="alternate" type="text/html" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.4"/>
          <title>Nextdo v0.1.4</title>
        </entry>
      </feed>
    `;
    expect(parseAtomFeedTags(sampleXml)).toEqual([
      'v0.1.5-beta.3',
      'v0.1.5-beta.2',
      'v0.1.4',
    ]);
  });

  it('handles empty feed or feed with no tags', () => {
    expect(parseAtomFeedTags('<feed></feed>')).toEqual([]);
    expect(parseAtomFeedTags('')).toEqual([]);
  });

  it('decodes url-encoded characters and deduplicates tags', () => {
    const xml = `
      <link href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.0%2Bbuild.1"/>
      <link href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.0%2Bbuild.1"/>
    `;
    expect(parseAtomFeedTags(xml)).toEqual(['v0.1.0+build.1']);
  });
});

describe('pickLatestReleaseForChannel', () => {
  const tags = ['v0.1.5-beta.3', 'v0.1.5-beta.2', 'v0.1.4', 'v0.1.3'];

  it('picks highest release matching beta channel (beta or stable)', () => {
    expect(pickLatestReleaseForChannel(tags, 'beta')).toEqual({
      tag: 'v0.1.5-beta.3',
      version: '0.1.5-beta.3',
    });
  });

  it('picks highest release matching stable channel (stable only)', () => {
    expect(pickLatestReleaseForChannel(tags, 'stable')).toEqual({
      tag: 'v0.1.4',
      version: '0.1.4',
    });
  });

  it('picks newer stable release when stable is higher than beta', () => {
    const mixedTags = ['v0.1.5-beta.1', 'v0.1.6'];
    expect(pickLatestReleaseForChannel(mixedTags, 'beta')).toEqual({
      tag: 'v0.1.6',
      version: '0.1.6',
    });
  });

  it('returns null when no candidate matches the channel', () => {
    const betaOnly = ['v0.1.5-beta.1', 'v0.1.5-beta.2'];
    expect(pickLatestReleaseForChannel(betaOnly, 'stable')).toBeNull();
    expect(pickLatestReleaseForChannel([], 'beta')).toBeNull();
  });
});

describe('pickAndroidAbi', () => {
  it('prefers the 64-bit arm ABI on a modern phone', () => {
    expect(pickAndroidAbi(['arm64-v8a', 'armeabi-v7a', 'armeabi'])).toBe('arm64-v8a');
  });

  it('falls back to the 32-bit arm ABI on a device without arm64', () => {
    expect(pickAndroidAbi(['armeabi-v7a', 'armeabi'])).toBe('armeabi-v7a');
  });

  it('picks the x86 ABI for an emulator', () => {
    expect(pickAndroidAbi(['x86_64', 'x86'])).toBe('x86_64');
    expect(pickAndroidAbi(['x86'])).toBe('x86');
  });

  it('ignores entries we cannot ship (human-readable names) and unknown lists', () => {
    expect(pickAndroidAbi(['arm64 v8', 'armeabi-v7a'])).toBe('armeabi-v7a');
    // 探测不到 / 列表为空 → 按现实中最常见的 arm64，而不是不给安装包。
    expect(pickAndroidAbi(null)).toBe('arm64-v8a');
    expect(pickAndroidAbi([])).toBe('arm64-v8a');
  });
});

describe('pickDownloads', () => {
  it('macOS gets EXACTLY ONE installer — the one matching the detected architecture', () => {
    expect(pickDownloads(release(), 'macos', 'aarch64')).toEqual([
      {
        label: 'macOS 安装包（Apple 芯片）',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_aarch64.dmg`,
      },
    ]);
    expect(pickDownloads(release(), 'macos', 'x86_64')).toEqual([
      {
        label: 'macOS 安装包（Intel）',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_x64.dmg`,
      },
    ]);
  });

  it('macOS with an UNKNOWN architecture gets NO installer — guessing wrong cannot install', () => {
    expect(pickDownloads(release(), 'macos', null)).toEqual([]);
    // 默认参数同样不能变成「给两个让用户选」。
    expect(pickDownloads(release(), 'macos')).toEqual([]);
  });

  it('Windows gets the NSIS installer, Linux gets deb + AppImage, Android the arm64 apk', () => {
    expect(pickDownloads(release(), 'windows')).toEqual([
      { label: 'Windows 安装程序', url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_x64-setup.exe` },
    ]);
    expect(pickDownloads(release(), 'linux').map((d) => d.label)).toEqual([
      'Linux · deb',
      'Linux · AppImage',
    ]);
    expect(pickDownloads(release(), 'android')).toEqual([
      {
        label: 'Android 安装包',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_android_arm64-v8a.apk`,
      },
    ]);
  });

  it('Android gets EXACTLY ONE apk — the one matching the device ABI', () => {
    expect(pickDownloads(release(), 'android', null, 'arm64-v8a')).toEqual([
      {
        label: 'Android 安装包',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_android_arm64-v8a.apk`,
      },
    ]);
    expect(pickDownloads(release(), 'android', null, 'armeabi-v7a')).toEqual([
      {
        label: 'Android 安装包（32 位）',
        url: `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_android_armeabi-v7a.apk`,
      },
    ]);
    expect(pickDownloads(release(), 'android', null, 'x86_64').map((d) => d.url)).toEqual([
      `${PREFIX}${DOWNLOAD}/v0.1.4/Nextdo_0.1.4_android_x86_64.apk`,
    ]);
  });

  it('a prerelease tag flows into the file name verbatim', () => {
    const downloads = pickDownloads(release('v0.2.0-beta.1'), 'windows');
    expect(downloads[0]!.url).toBe(
      `${PREFIX}${DOWNLOAD}/v0.2.0-beta.1/Nextdo_0.2.0-beta.1_x64-setup.exe`,
    );
  });

  it.each(['ios', 'web'] as const)('%s has no installer — the screen falls back to the release page', (platform) => {
    expect(pickDownloads(release(), platform)).toEqual([]);
  });

  it('never returns a URL without the proxy prefix', () => {
    for (const platform of ['macos', 'windows', 'linux', 'android'] as const) {
      const downloads =
        platform === 'macos'
          ? pickDownloads(release(), platform, 'aarch64')
          : pickDownloads(release(), platform);
      for (const download of downloads) {
        expect(download.url.startsWith(PREFIX)).toBe(true);
      }
    }
  });
});

describe('detectMacArch', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('asks the Tauri shell first — the only source that works inside WKWebView', async () => {
    const invoke = jest.fn().mockResolvedValue('aarch64');
    setWindow({ __TAURI_INTERNALS__: { invoke } });
    await expect(detectMacArch()).resolves.toBe('aarch64');
    expect(invoke).toHaveBeenCalledWith('current_arch');
  });

  it('normalizes the shapes both sources use (Rust ARCH / UA high-entropy)', async () => {
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn().mockResolvedValue('x86_64') } });
    await expect(detectMacArch()).resolves.toBe('x86_64');

    setWindow({
      navigator: { userAgentData: { getHighEntropyValues: async () => ({ architecture: 'arm' }) } },
    });
    await expect(detectMacArch()).resolves.toBe('aarch64');

    setWindow({
      navigator: { userAgentData: { getHighEntropyValues: async () => ({ architecture: 'x86' }) } },
    });
    await expect(detectMacArch()).resolves.toBe('x86_64');
  });

  it('resolves null — never rejects — when the source is missing or fails', async () => {
    // Safari: no userAgentData at all.
    setWindow({ navigator: {} });
    await expect(detectMacArch()).resolves.toBeNull();

    // Nothing at all (SSR / bare test env).
    setWindow(undefined);
    await expect(detectMacArch()).resolves.toBeNull();

    // Desktop shell too old to expose the command → falls through, still null.
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn().mockRejectedValue(new Error('not found')) } });
    await expect(detectMacArch()).resolves.toBeNull();

    // API present but throws (some Chromium builds gate the high-entropy API).
    setWindow({
      navigator: { userAgentData: { getHighEntropyValues: async () => { throw new Error('denied'); } } },
    });
    await expect(detectMacArch()).resolves.toBeNull();
  });

  it('an unrecognized architecture string is null, not a coin flip', async () => {
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn().mockResolvedValue('riscv64') } });
    await expect(detectMacArch()).resolves.toBeNull();
  });
});

describe('openExternalUrl', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('calls Tauri open_url command when running in desktop shell', async () => {
    const invokeMock = jest.fn().mockResolvedValue(undefined);
    setWindow({ __TAURI_INTERNALS__: { invoke: invokeMock } });
    const linkingSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    await openExternalUrl('https://example.com/test');

    expect(invokeMock).toHaveBeenCalledWith('open_url', { url: 'https://example.com/test' });
    expect(linkingSpy).not.toHaveBeenCalled();
    linkingSpy.mockRestore();
  });

  it('falls back to Linking.openURL when not in desktop shell or when invoke fails', async () => {
    setWindow(undefined);
    const linkingSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    await openExternalUrl('https://example.com/fallback');
    expect(linkingSpy).toHaveBeenCalledWith('https://example.com/fallback');

    // With failing Tauri invoke
    const failingInvoke = jest.fn().mockRejectedValue(new Error('command failed'));
    setWindow({ __TAURI_INTERNALS__: { invoke: failingInvoke } });

    await openExternalUrl('https://example.com/invoke-error');
    expect(linkingSpy).toHaveBeenCalledWith('https://example.com/invoke-error');
    linkingSpy.mockRestore();
  });
});

describe('isTauriDesktop', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('returns true when __TAURI_INTERNALS__ with invoke is present', () => {
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn() } });
    expect(isTauriDesktop()).toBe(true);
  });

  it('returns false when window is undefined', () => {
    setWindow(undefined);
    expect(isTauriDesktop()).toBe(false);
  });

  it('returns false when __TAURI_INTERNALS__ is missing', () => {
    setWindow({ navigator: {} });
    expect(isTauriDesktop()).toBe(false);
  });
});

describe('startDesktopDownload', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('calls Tauri download_update with the url', async () => {
    const invokeMock = jest.fn().mockResolvedValue(undefined);
    setWindow({ __TAURI_INTERNALS__: { invoke: invokeMock } });

    await startDesktopDownload('https://example.com/Nextdo_0.1.5.dmg');
    expect(invokeMock).toHaveBeenCalledWith('download_update', {
      url: 'https://example.com/Nextdo_0.1.5.dmg',
    });
  });

  it('throws when not in Tauri shell', async () => {
    setWindow(undefined);
    await expect(startDesktopDownload('https://example.com/file')).rejects.toThrow(
      'Not running in Tauri desktop shell',
    );
  });
});

describe('pollDesktopDownloadProgress', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('returns the progress from Tauri invoke', async () => {
    const progress = {
      state: 'downloading' as const,
      downloaded_bytes: 1024,
      total_bytes: 4096,
      file_path: '',
      error: '',
    };
    setWindow({ __TAURI_INTERNALS__: { invoke: jest.fn().mockResolvedValue(progress) } });

    const result = await pollDesktopDownloadProgress();
    expect(result.state).toBe('downloading');
    expect(result.downloaded_bytes).toBe(1024);
  });

  it('returns idle when not in Tauri shell', async () => {
    setWindow(undefined);
    const result = await pollDesktopDownloadProgress();
    expect(result.state).toBe('idle');
  });
});

describe('openDownloadedInstaller', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('calls Tauri open_downloaded_file with the filePath', async () => {
    const invokeMock = jest.fn().mockResolvedValue(undefined);
    setWindow({ __TAURI_INTERNALS__: { invoke: invokeMock } });

    await openDownloadedInstaller('/tmp/Nextdo.dmg');
    expect(invokeMock).toHaveBeenCalledWith('open_downloaded_file', {
      filePath: '/tmp/Nextdo.dmg',
    });
  });

  it('throws when not in Tauri shell', async () => {
    setWindow(undefined);
    await expect(openDownloadedInstaller('/tmp/Nextdo.dmg')).rejects.toThrow(
      'Not running in Tauri desktop shell',
    );
  });
});

describe('installDesktopUpdateAndRestart', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
  }

  it('calls Tauri install_update_and_restart with the filePath', async () => {
    const invokeMock = jest.fn().mockResolvedValue(undefined);
    setWindow({ __TAURI_INTERNALS__: { invoke: invokeMock } });

    await installDesktopUpdateAndRestart('/tmp/Nextdo.dmg');
    expect(invokeMock).toHaveBeenCalledWith('install_update_and_restart', {
      filePath: '/tmp/Nextdo.dmg',
    });
  });

  it('throws when not in Tauri shell', async () => {
    setWindow(undefined);
    await expect(installDesktopUpdateAndRestart('/tmp/Nextdo.dmg')).rejects.toThrow(
      'Not running in Tauri desktop shell',
    );
  });
});

describe('fetchLatestRelease', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('queries /releases/latest directly for stable channel', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      url: `${PREFIX}https://github.com/nextdo-app/nextdo/releases/tag/v0.1.4`,
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchLatestRelease('stable');
    expect(result).toEqual({
      ok: true,
      release: { tag: 'v0.1.4', version: '0.1.4' },
    });
    expect(mockFetch).toHaveBeenCalledWith(latestReleaseUrl(), expect.any(Object));
  });

  it('queries releases.atom feed for beta channel and detects beta.4 when available', async () => {
    const atomXml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.5-beta.4"/>
        </entry>
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.5-beta.3"/>
        </entry>
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.4"/>
        </entry>
      </feed>
    `;
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => atomXml,
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchLatestRelease('beta');
    expect(result).toEqual({
      ok: true,
      release: { tag: 'v0.1.5-beta.4', version: '0.1.5-beta.4' },
    });
    expect(mockFetch).toHaveBeenCalledWith(releasesAtomUrl(), expect.any(Object));
  });

  it('falls back to /releases/latest if releases.atom fails for beta channel', async () => {
    const mockFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === releasesAtomUrl()) {
        return { ok: false, status: 500 };
      }
      return {
        ok: true,
        url: `${PREFIX}https://github.com/nextdo-app/nextdo/releases/tag/v0.1.4`,
      };
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchLatestRelease('beta');
    expect(result).toEqual({
      ok: true,
      release: { tag: 'v0.1.4', version: '0.1.4' },
    });
    expect(mockFetch).toHaveBeenCalledWith(releasesAtomUrl(), expect.any(Object));
    expect(mockFetch).toHaveBeenCalledWith(latestReleaseUrl(), expect.any(Object));
  });

  it('returns ok: false with error reason when network fails', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network offline'));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchLatestRelease('beta');
    expect(result).toEqual({
      ok: false,
      reason: 'network',
    });
  });
});

describe('parseAtomFeedEntries & pickDualChannelReleases (Issue #18)', () => {
  it('parses entries with tag, channel, and published timestamp', () => {
    const atomXml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.5-beta.2"/>
          <updated>2026-10-12T08:00:00Z</updated>
        </entry>
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.4"/>
          <updated>2026-10-10T12:00:00Z</updated>
        </entry>
      </feed>
    `;

    const entries = parseAtomFeedEntries(atomXml);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      tag: 'v0.1.5-beta.2',
      version: '0.1.5-beta.2',
      channel: 'beta',
      channelLabel: '测试版',
      publishedAt: '2026-10-12T08:00:00Z',
      notes: null,
    });
    expect(entries[1]).toEqual({
      tag: 'v0.1.4',
      version: '0.1.4',
      channel: 'stable',
      channelLabel: '正式版',
      publishedAt: '2026-10-10T12:00:00Z',
      notes: null,
    });
  });

  it('parses content HTML into clean release notes', () => {
    const atomWithContent = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.6"/>
          <updated>2026-10-13T08:00:00Z</updated>
          <content type="html">&lt;h2&gt;What's Changed&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;feat: add auto update check by @alice&lt;/li&gt;&lt;li&gt;fix: desktop window layout&lt;/li&gt;&lt;/ul&gt;</content>
        </entry>
      </feed>
    `;
    const entries = parseAtomFeedEntries(atomWithContent);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.notes).toContain("What's Changed");
    expect(entries[0]?.notes).toContain('• feat: add auto update check by @alice');
    expect(entries[0]?.notes).toContain('• fix: desktop window layout');
  });

  it('cleanAtomReleaseNotes strips HTML tags and normalizes list and headings', () => {
    expect(cleanAtomReleaseNotes('')).toBeNull();
    const html = '<p>Hello <strong>World</strong></p><ul><li>First Item</li><li>Second Item</li></ul>';
    const cleaned = cleanAtomReleaseNotes(html);
    expect(cleaned).toBe('Hello World\n\n• First Item\n• Second Item');
  });

  it('persists and retrieves auto update check preference', async () => {
    // 默认开启
    expect(await getAutoUpdateCheckPreference()).toBe(true);

    await setAutoUpdateCheckPreference(false);
    expect(await getAutoUpdateCheckPreference()).toBe(false);

    await setAutoUpdateCheckPreference(true);
    expect(await getAutoUpdateCheckPreference()).toBe(true);
  });

  it('pickDualChannelReleases identifies latest stable and beta separately', () => {
    const entries: ReleaseInfo[] = [
      {
        tag: 'v0.1.5-beta.1',
        version: '0.1.5-beta.1',
        channel: 'beta',
        channelLabel: '测试版',
        publishedAt: '2026-10-11T00:00:00Z',
        notes: null,
      },
      {
        tag: 'v0.1.5-beta.2',
        version: '0.1.5-beta.2',
        channel: 'beta',
        channelLabel: '测试版',
        publishedAt: '2026-10-12T00:00:00Z',
        notes: null,
      },
      {
        tag: 'v0.1.4',
        version: '0.1.4',
        channel: 'stable',
        channelLabel: '正式版',
        publishedAt: '2026-10-10T00:00:00Z',
        notes: null,
      },
      {
        tag: 'v0.1.3',
        version: '0.1.3',
        channel: 'stable',
        channelLabel: '正式版',
        publishedAt: '2026-10-01T00:00:00Z',
        notes: null,
      },
    ];

    const dual = pickDualChannelReleases(entries);
    expect(dual.stable?.version).toBe('0.1.4');
    expect(dual.beta?.version).toBe('0.1.5-beta.2');
  });

  it('formatReleaseDate formats ISO date to YYYY-MM-DD or empty', () => {
    expect(formatReleaseDate('2026-10-12T08:00:00Z')).toBe('2026-10-12');
    expect(formatReleaseDate('2026-05-01')).toBe('2026-05-01');
    expect(formatReleaseDate(null)).toBe('');
  });
});

describe('update channel preference storage (Issue #18)', () => {
  it('defaults to stable channel for stable current version', async () => {
    const pref = await getUpdateChannelPreference();
    expect(pref).toBe('stable');
  });

  it('saves and reads user channel preference', async () => {
    await setUpdateChannelPreference('beta');
    const pref = await getUpdateChannelPreference();
    expect(pref).toBe('beta');

    await setUpdateChannelPreference('stable');
    const reset = await getUpdateChannelPreference();
    expect(reset).toBe('stable');
  });
});

describe('fetchDualChannelReleases (Issue #18)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches both channels from atom feed successfully', async () => {
    const atomXml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.5-beta.1"/>
          <updated>2026-10-12T00:00:00Z</updated>
        </entry>
        <entry>
          <link rel="alternate" href="https://github.com/nextdo-app/nextdo/releases/tag/v0.1.4"/>
          <updated>2026-10-10T00:00:00Z</updated>
        </entry>
      </feed>
    `;

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => atomXml,
    }) as unknown as typeof fetch;

    const res = await fetchDualChannelReleases();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.releases.stable?.version).toBe('0.1.4');
      expect(res.releases.beta?.version).toBe('0.1.5-beta.1');
    }
  });

  it('falls back to latestReleaseUrl when atom fails', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === releasesAtomUrl()) {
        return { ok: false, status: 500 };
      }
      return {
        ok: true,
        url: `${PREFIX}https://github.com/nextdo-app/nextdo/releases/tag/v0.1.4`,
      };
    }) as unknown as typeof fetch;

    const res = await fetchDualChannelReleases();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.releases.stable?.version).toBe('0.1.4');
      expect(res.releases.beta).toBeNull();
    }
  });
});