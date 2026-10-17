/**
 * Settings notifications block — the two PURE presentation helpers
 * (issue #45): the effective state wording and the single platform action.
 *
 * Why unit-test the helpers instead of driving every combination through the
 * screen: the matrix is 2 (switch) × 3 (status) × 3 (platform) = 18 cells,
 * and the rule under test — 「未授权不得显示为已开启」 — is a pure function of
 * (switch, permission). The screen's own wiring is covered by
 * `settings-screen.test.tsx` (native undetermined / granted / denied).
 */
import { describeNotificationState, notificationActionFor } from '../app/(tabs)/settings';
import type { ReminderPermissionState } from '../lib/reminders/adapters';

const native = (status: ReminderPermissionState['status']): ReminderPermissionState => ({
  platform: 'native',
  status,
  canAskAgain: status !== 'denied',
});
const web = (status: ReminderPermissionState['status']): ReminderPermissionState => ({
  platform: 'web',
  status,
  canAskAgain: status !== 'denied',
});
const tauri = (status: ReminderPermissionState['status']): ReminderPermissionState => ({
  platform: 'tauri',
  status,
  canAskAgain: true,
});

describe('describeNotificationState — the effective state (issue #45 R5)', () => {
  it('never claims 已开启 while the OS permission is not granted', () => {
    for (const permission of [native('undetermined'), native('denied'), web('undetermined'), web('denied')]) {
      expect(describeNotificationState(true, permission).title).not.toBe('已开启');
    }
  });

  it('granted + switch on → 已开启', () => {
    const state = describeNotificationState(true, native('granted'));
    expect(state.title).toBe('已开启');
    expect(state.detail).toContain('稍后、日历与习惯提醒');
  });

  it('undetermined → 等待系统授权 and explains the app asks by itself', () => {
    const state = describeNotificationState(true, native('undetermined'));
    expect(state.title).toBe('等待系统授权');
    expect(state.detail).toContain('首次真正需要提醒时');
  });

  it('denied → 系统权限未开启 and says reminders are recorded but not delivered', () => {
    const state = describeNotificationState(true, native('denied'));
    expect(state.title).toBe('系统权限未开启');
    expect(state.detail).toContain('不会按时送达');
  });

  it('switch off → 已在应用内关闭 (regardless of the OS grant)', () => {
    expect(describeNotificationState(false, native('granted')).title).toBe('已在应用内关闭');
    expect(describeNotificationState(false, native('undetermined')).title).toBe('已在应用内关闭');
    // Both layers off is stated, not hidden behind the OS state.
    expect(describeNotificationState(false, native('undetermined')).detail).toContain('均未开启');
  });

  it('grants on web / tauri keep their platform caveat', () => {
    expect(describeNotificationState(true, web('granted')).detail).toContain('Web 浏览器通知');
    expect(describeNotificationState(true, tauri('granted')).detail).toContain('应用关闭期间不会提醒');
  });

  it('loading (either side still null) → 检查中, with no claim either way', () => {
    expect(describeNotificationState(null, native('granted')).detail).toBe('检查中…');
    expect(describeNotificationState(true, null).detail).toBe('检查中…');
  });
});

describe('notificationActionFor — who gets a button (issue #45 R4/R6)', () => {
  it('native undetermined → NO button (the app asks at the first real need)', () => {
    expect(notificationActionFor(native('undetermined'))).toBeNull();
  });

  it('native granted → NO button', () => {
    expect(notificationActionFor(native('granted'))).toBeNull();
  });

  it('native denied → NO request button (only iOS deep-links to system settings)', () => {
    // jest runs as iOS; Android yields null (text guidance instead).
    expect(notificationActionFor(native('denied'))).toBe('open-system-settings');
  });

  it('web undetermined / denied → the gesture button (browsers require a tap)', () => {
    expect(notificationActionFor(web('undetermined'))).toBe('web-request');
    expect(notificationActionFor(web('denied'))).toBe('web-request');
  });

  it('tauri → NO button (no request model)', () => {
    expect(notificationActionFor(tauri('granted'))).toBeNull();
    expect(notificationActionFor(tauri('undetermined'))).toBeNull();
  });

  it('loading → NO button', () => {
    expect(notificationActionFor(null)).toBeNull();
  });
});
