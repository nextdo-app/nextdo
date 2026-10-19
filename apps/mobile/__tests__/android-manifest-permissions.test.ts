/**
 * 回归保护：Android 的「应用内安装」与「精确闹钟」都依赖清单权限。
 *
 * 这三条权限曾写在 `expo-build-properties.android.manifestPermissions` 里 ——
 * SDK 57 的插件没有这个选项，构建时被静默忽略，发布出来的 APK 既无法调起
 * 系统安装器（点「立即安装」无响应），也只能退化成不精确的闹钟。插件不会报错，
 * 所以只能直接校验 app.json 的声明。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appConfig = JSON.parse(
  readFileSync(join(__dirname, '..', 'app.json'), 'utf8'),
) as {
  expo: { android?: { permissions?: string[] } };
};

describe('android manifest permissions', () => {
  it('declares install-package and exact-alarm permissions in expo.android.permissions', () => {
    const permissions = appConfig.expo.android?.permissions ?? [];

    expect(permissions).toEqual(
      expect.arrayContaining([
        'android.permission.REQUEST_INSTALL_PACKAGES',
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.USE_EXACT_ALARM',
      ]),
    );
  });
});
