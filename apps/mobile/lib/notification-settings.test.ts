/**
 * Issue #100: the import switch is a persisted notification-settings field
 * (the same device-local store as the calendar export switch). These tests
 * pin the two easy-to-break parts: parsing an older blob that has no field,
 * and a later partial save that must not reset it.
 */
import {
  __setNotificationSettingsStoreForTests,
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  parseNotificationSettings,
  saveNotificationSettings,
} from './notification-settings';

function memoryStore(): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  raw(): string | null;
} {
  let raw: string | null = null;
  return {
    async getItem() {
      return raw;
    },
    async setItem(_key: string, value: string) {
      raw = value;
    },
    raw() {
      return raw;
    },
  };
}

describe('notification settings — calendar import switch (issue #100)', () => {
  afterEach(() => {
    __setNotificationSettingsStoreForTests(null);
  });

  it('defaults the import switch to off', () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.calendarImportEnabled).toBe(false);
    expect(parseNotificationSettings(null).calendarImportEnabled).toBe(false);
  });

  it('reads a stored true, and an unreadable value keeps the default', () => {
    expect(
      parseNotificationSettings(JSON.stringify({ calendarImportEnabled: true }))
        .calendarImportEnabled,
    ).toBe(true);
    expect(
      parseNotificationSettings(JSON.stringify({ calendarImportEnabled: 'yes' }))
        .calendarImportEnabled,
    ).toBe(false);
  });

  it('a partial save of another field preserves the import switch', async () => {
    const store = memoryStore();
    __setNotificationSettingsStoreForTests(store);

    await saveNotificationSettings({ calendarImportEnabled: true });
    const saved = await saveNotificationSettings({ masterEnabled: false });

    expect(saved.calendarImportEnabled).toBe(true);
    expect(saved.masterEnabled).toBe(false);
    expect(await loadNotificationSettings()).toEqual(saved);
    expect(store.raw()).toContain('"calendarImportEnabled":true');
  });
});
