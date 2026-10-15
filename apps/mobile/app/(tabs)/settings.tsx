/**
 * The Settings tab (prod-deploy R6 — cloud sync is OPTIONAL; OSS
 * task 09-28 — the server addresses are USER-CONFIGURED): the 5th tab.
 * Hosts appearance/theme, notifications (task 09-30 R5 — delivery
 * status) and cloud sync.
 *
 * - appearance: system / light / dark preference selector.
 * - notifications: the OS permission state through `useReminderPermission`
 *   (never the platform modules — component-guidelines): undetermined /
 *   granted / denied per platform; denied on iOS → 「去系统设置」 button,
 *   denied on Android → text guidance (no API to jump there in v1);
 *   tauri → "follows the system settings"; plain web → "not supported".
 * - disconnected (no owner token): explains local-only mode + TWO inputs —
 *   ONE 「服务器地址」 (the `/api` + `/sync` paths are derived from it by
 *   `deriveSyncConfig`, in `packages/db`) and ONE 「连接串 / owner token」
 *   field that accepts either a pasted connection string
 *   (`<base>|<token>` or `nextdo://sync?s=&t=`) or a bare owner token — an
 *   empty token is refused by connect() with an inline error before any
 *   network. A 「高级设置」 accordion (collapsed by default) keeps the two
 *   original custom URL inputs for non-standard reverse-proxy layouts;
 *   filling BOTH makes them win over the derivation (design D2 — no
 *   extra mode toggle). A pre-existing stored config pre-fills all three
 *   address fields, so a reconnect after 断开 only needs a new token.
 *   Client-side validation (请先填写服务器地址 / 地址无效… / 请先输入
 *   owner token) runs BEFORE any network; the server three-state copy
 *   (token 不正确 / 连不上服务器，请稍后重试 / 保存失败) is unchanged.
 * - connected: status line + the two stored addresses (read-only) +
 *   断开连接 (clears the token — the addresses are KEPT; the provider's
 *   subscription then disconnects sync; local data is untouched, so no
 *   confirmation is needed in v1).
 * - update check (last card): the app version from app.json plus a manual
 *   「检查更新」 button. BOTH the version query and every installer link go
 *   through the download-proxy prefix built in `lib/app-update.ts` —
 *   nothing here touches GitHub directly. A newer version renders one
 *   button per platform-matched installer; macOS offers both
 *   architectures, because a webview's user agent reports "Intel Mac"
 *   even on Apple Silicon and guessing wrong is worse than asking.
 *   Downloads are handed to the system browser, and iOS / web — which
 *   the release pipeline ships no installer for — only get the release
 *   page link.
 *
 * All auth work goes through the `useCloudSync` UI hook (the packages/db
 * boundary); this screen owns only the form's transient state.
 */
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme, type ThemePreference } from '@/lib/theme';
import { Button, Card, cn } from '@nextdo/ui';
import { useCloudSync } from '@/hooks/use-cloud-sync';
import { useReminderPermission } from '@/hooks/use-reminder-permission';
import { useAppClock } from '@/hooks/use-app-clock';
import { useHabitReminders } from '@/hooks/use-habit-reminders';
import { PickerField } from '@/components/picker-field';
import { DateTimePicker } from '@/components/datetime-picker';
import { useAppUpdate } from '@/hooks/use-app-update';
import { formatReleaseDate, openExternalUrl, type UpdateFailureReason } from '@/lib/app-update';
import {
  formatConnectionString,
  formatDeepLink,
  parseConnectionString,
  sanitizeConnectionText,
} from '@/lib/sync-connection';
import { QRCode } from '@/components/qr-code';
import {
  clearUploadRejections,
  getRecentUploadRejections,
  subscribeToUploadRejections,
  type UploadRejectedOp,
} from '@nextdo/db';

/**
 * Recover the BASE server address from a stored `backendUrl` so the single
 * 「服务器地址」 input can be pre-filled without the user seeing the
 * derived `/api` suffix they never typed. Purely cosmetic (the input
 * still connects fine with `/api` pasted — `deriveSyncConfig` strips it),
 * but showing a value the user never entered in a field labeled 「服务器
 * 地址」 is confusing. Mirrors `deriveSyncConfig`'s tolerated suffixes;
 * kept local because it is a DISPLAY concern, not a config rule.
 */
function stripDerivedSuffix(backendUrl: string): string {
  return backendUrl.replace(/\/+$/, '').replace(/\/(api|sync)$/, '');
}

/**
 * Detect if a string looks like a plain HTTP/HTTPS server address
 * (not a connection string like `<base>|<token>` or a `nextdo://` deep link).
 */
function isPlainHttpUrl(value: string): boolean {
  const trimmed = sanitizeConnectionText(value);
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }
  if (trimmed.includes('|') || trimmed.startsWith('nextdo://')) {
    return false;
  }
  return true;
}

function isIosWebSafari(): boolean {
  if (Platform.OS !== 'web') return false;
  const host = globalThis as unknown as {
    window?: { navigator?: { userAgent?: string; standalone?: boolean } };
  };
  const ua = host.window?.navigator?.userAgent ?? '';
  return /iPad|iPhone|iPod/.test(ua) && host.window?.navigator?.standalone !== true;
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色模式' },
  { value: 'dark', label: '深色模式' },
];

/** 检查失败的三种原因 → 提示文案（文案归屏幕，逻辑层只给 reason）。 */
const UPDATE_FAILURE_COPY: Record<UpdateFailureReason, string> = {
  network: '连不上更新服务器，请检查网络后重试。',
  http: '更新服务器暂时不可用，请稍后重试。',
  payload: '没能读到版本信息，请稍后重试。',
};

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted shadow-sm focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** Placeholders / accessibility labels — the single definitions the tests
 *  match on (a duplicated literal in the JSX is how copy drifts). */
const SERVER_ADDRESS_PLACEHOLDER = '自建服务器地址（例如：https://my-sync.workers.dev）';
/**
 * The "同步是怎么工作的？" toggle and its body (issue #15).
 *
 * Rendered in BOTH the connected and the disconnected states on purpose: the
 * person who has not connected yet is exactly the one asking "when does it
 * sync, and can I change that?" — hiding the answer behind having already
 * connected would leave the question unanswered.
 */
function SyncExplainer({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <View className="gap-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? '收起同步说明' : '同步是怎么工作的？'}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
      >
        <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
          {open ? '收起同步说明 ▴' : '同步是怎么工作的？ ▾'}
        </Text>
      </Pressable>
      {open ? (
        <View className="gap-1.5 rounded-lg border border-border/80 bg-surface p-3 dark:border-border-dark dark:bg-surface-dark">
          {SYNC_EXPLAINER.map((line) => (
            <Text
              key={line.q}
              className="font-sans text-xs leading-relaxed text-muted dark:text-muted-dark"
            >
              <Text className="font-semibold text-ink dark:text-ink-dark">{line.q}</Text>
              {'  '}
              {line.a}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const TOKEN_PLACEHOLDER = '云同步连接串（例如 https://...|token）';

/**
 * The four things users ask about sync (issue #15), stated as the code
 * actually behaves — 详见 `docs/sync.md`. Kept as data so the card renders
 * them as a list instead of four hand-written paragraphs that can drift.
 */
const SYNC_EXPLAINER: readonly { q: string; a: string }[] = [
  { q: '什么时候同步？', a: '连上之后一直在跑。你在这台设备上的每一次改动都会立刻排队上传，没有定时任务。' },
  { q: '多久一次？', a: '没有固定间隔——写入即触发上传；别的设备的改动通过长连接推过来。' },
  { q: '能自己设置频率吗？', a: '不能。只能配置服务器地址和连接凭据。' },
  { q: '失败了怎么办？', a: '网络问题由系统自动重试，数据不会丢。数据本身不合法时，服务端会拒收并在下方列出原因。' },
];
const ADVANCED_BACKEND_PLACEHOLDER = 'https://nextdo.example.com/api';
const ADVANCED_ENDPOINT_PLACEHOLDER = 'https://nextdo.example.com/sync';
const TOKEN_ACCESSIBILITY_LABEL = '云同步连接串';

type SyncMode = 'pair' | 'self_host';

export default function SettingsScreen() {
  const { preference, updatePreference } = useAppTheme();
  const { state, storedConfig, ownerToken, connect, disconnect } = useCloudSync();
  const { state: notificationPermission, openSystemSettings, requestPermission } =
    useReminderPermission();
  const now = useAppClock();
  const { options: habitReminderOptions, update: updateHabitReminders } = useHabitReminders(now);
  const [openHabitTimePicker, setOpenHabitTimePicker] = useState(false);
  const update = useAppUpdate();
  // The deep-link route (`app/sync.tsx`) hands a failed connect back here
  // as `?syncError=…` so the user SEES the reason instead of a silent
  // no-op. Read once per arrival (the value is a fresh string each time).
  const { syncError } = useLocalSearchParams<{ syncError?: string }>();
  // Mode switcher for onboarding: 'pair' (paste connection string / scan QR)
  // vs 'self_host' (first device connecting to newly self-hosted server without token).
  const [syncMode, setSyncMode] = useState<SyncMode>('pair');
  const [showTokenGuide, setShowTokenGuide] = useState(false);
  // The simple form: ONE server address (the two URLs are derived from it)
  // plus one field that accepts a connection string OR a bare owner token.
  const [serverAddress, setServerAddress] = useState('');
  const [token, setToken] = useState('');
  // The advanced form (collapsed by default): the two custom URLs. Empty
  // means "derive them"; non-empty means "use exactly these" (design D2 —
  // no extra "I am in advanced mode" toggle, which would be a second state
  // that can disagree with the fields themselves).
  const [advancedBackendUrl, setAdvancedBackendUrl] = useState('');
  const [advancedEndpoint, setAdvancedEndpoint] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Set the moment the user edits the server address: from then on the
  // prefilled advanced pair no longer takes precedence (see the prefill
  // effect + handleServerAddressChange below).
  const [addressIsAuthoritative, setAddressIsAuthoritative] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  /** The "同步是怎么工作的？" explainer inside the cloud-sync card (#15). */
  const [showSyncHelp, setShowSyncHelp] = useState(false);
  const [rejections, setRejections] = useState<UploadRejectedOp[]>([]);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getRecentUploadRejections().then(setRejections);
    return subscribeToUploadRejections(setRejections);
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const baseServerAddress = storedConfig ? stripDerivedSuffix(storedConfig.backendUrl) : '';
  const exportedConnectionString =
    storedConfig && ownerToken ? formatConnectionString(baseServerAddress, ownerToken) : '';
  const exportedDeepLink =
    storedConfig && ownerToken ? formatDeepLink(baseServerAddress, ownerToken) : '';

  const handleCopyConnectionString = async (): Promise<void> => {
    if (!exportedConnectionString) return;
    await Clipboard.setStringAsync(exportedConnectionString);
    setCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  };
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  // Pre-fill from the stored config when it exists — into EMPTY fields
  // only (a reconnect after 断开 keeps the addresses, so the user never
  // re-types them). The address input gets the BASE (the two URLs are
  // recovered by stripping a trailing `/api` / `/sync`, which
  // `deriveSyncConfig` tolerates); the advanced inputs get the raw pair so
  // a deployment with a custom path layout survives a disconnect/reconnect
  // cycle unchanged. `storedConfig` re-reads on every poke, so this also
  // runs when the block flips back to disconnected.
  //
  // Skipped entirely once `addressIsAuthoritative` is set (see below): a
  // re-read must not resurrect the prefilled advanced pair behind the
  // user's back after they deliberately chose a different address.
  useEffect(() => {
    if (storedConfig === null) return;
    setServerAddress((prev) => (prev === '' ? stripDerivedSuffix(storedConfig.backendUrl) : prev));
    if (addressIsAuthoritative) return;
    setAdvancedBackendUrl((prev) => (prev === '' ? storedConfig.backendUrl : prev));
    setAdvancedEndpoint((prev) => (prev === '' ? storedConfig.endpoint : prev));
  }, [storedConfig, addressIsAuthoritative]);

  // Editing the server address is an EXPLICIT choice of server, so the
  // prefilled advanced pair must step aside — otherwise it silently wins
  // (`hasAdvanced` only asks "are both filled?") and the user's new
  // address is ignored with no visible sign: the OLD server is contacted
  // while the field shows the NEW one. Clearing both advanced fields is
  // the only honest reading of "I typed a different address"; a
  // deployment that genuinely needs the custom pair re-fills it (or pastes
  // a connection string) afterwards.
  const handleServerAddressChange = (next: string): void => {
    setAddressIsAuthoritative(true);
    setServerAddress(next);
    setAdvancedBackendUrl('');
    setAdvancedEndpoint('');
    clearError();
  };

  // An error handed over by the deep-link route becomes this screen's inline
  // error (the same three-state copy — the route and this screen share ONE
  // connect(), so the message is literally the same string).
  useEffect(() => {
    if (typeof syncError === 'string' && syncError !== '') {
      setError(syncError);
    }
  }, [syncError]);

  // Advanced values win whenever BOTH are filled; otherwise the single
  // server address drives the derivation. Exactly one branch is taken —
  // the two inputs can never both apply. A pasted CONNECTION STRING
  // carries its own address, so it satisfies the presence check on its
  // own: the user pasted a complete instruction and should not also have
  // to retype the address into the field above.
  // When the user pastes a plain HTTP/HTTPS server address into the token
  // field, we also treat the address as present so one-tap connecting works
  // seamlessly without forcing them to manually switch tabs.
  const hasAdvanced = advancedBackendUrl.trim() !== '' && advancedEndpoint.trim() !== '';
  const connectionString = parseConnectionString(token) ?? parseConnectionString(serverAddress);
  const tokenIsPlainUrl = isPlainHttpUrl(token);
  const addressIsPlainUrl = isPlainHttpUrl(serverAddress);
  const addressPresent =
    hasAdvanced || connectionString !== null || tokenIsPlainUrl || addressIsPlainUrl || serverAddress.trim() !== '';
  // The button only checks PRESENCE, not validity: address VALIDITY and
  // the token REQUIREMENT are both left to connect's inline error, not the
  // button (the pre-existing contract).
  const canSubmit = addressPresent && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const cleanedToken = sanitizeConnectionText(token);
      const cleanedServerAddress = sanitizeConnectionText(serverAddress);
      // Smart extraction: check both inputs for connection strings (e.g. <url>|<token> or nextdo://...)
      const connStr =
        parseConnectionString(cleanedToken) ?? parseConnectionString(cleanedServerAddress);
      const tokenIsUrl = isPlainHttpUrl(cleanedToken);
      let result;
      if (connStr) {
        result = await connect({
          serverAddress: connStr.serverAddress,
          token: connStr.token,
        });
      } else if (hasAdvanced) {
        result = await connect({
          backendUrl: sanitizeConnectionText(advancedBackendUrl),
          endpoint: sanitizeConnectionText(advancedEndpoint),
          token: cleanedToken,
        });
      } else if (tokenIsUrl && cleanedServerAddress === '') {
        result = await connect({
          serverAddress: cleanedToken,
          token: '',
        });
      } else {
        result = await connect({
          serverAddress: cleanedServerAddress,
          token: cleanedToken,
        });
      }
      // ok → the hook's owner-token subscription flips the block to the
      // connected view (the inputs unmount with it).
      if (result.ok) {
        setToken('');
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const clearError = (): void => {
    if (error !== null) setError(null);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-canvas dark:bg-canvas-dark"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-5xl mx-auto">
        {/* Header block (matches the other tabs) */}
        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          设置
        </Text>
        <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
          设备与云同步。
        </Text>

        {/* Appearance / Theme block */}
        <Card className="mt-4 gap-3 p-3.5">
          <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
            外观主题
          </Text>
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">
            选择跟随系统设置，或固定使用浅色 / 深色外观。
          </Text>
          <View className="flex-row gap-2">
            {THEME_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`主题：${option.label}`}
                accessibilityState={{ selected: preference === option.value }}
                onPress={() => void updatePreference(option.value)}
                className={cn(
                  'flex-1 items-center justify-center rounded-lg border py-2.5',
                  preference === option.value
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-xs font-semibold',
                    preference === option.value
                      ? 'text-accent dark:text-accent-dark'
                      : 'text-ink dark:text-ink-dark',
                  )}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Contexts / Scene management block */}
        <Card className="mt-4 gap-2.5 p-3.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-2">
              <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                场景管理
              </Text>
              <Text className="mt-0.5 font-sans text-xs text-muted dark:text-muted-dark">
                配置行动的执行场景（如 办公室、电脑、客厅），用于推荐筛选。
              </Text>
            </View>
            <Button
              size="sm"
              variant="secondary"
              label="管理 →"
              onPress={() => router.push('/contexts')}
            />
          </View>
        </Card>

        {/* Notifications block (task 09-30 R5 — the delivery status;
         *  above cloud sync: notifications are the execution core) */}
        <Card className="mt-4 gap-3 p-3.5">
          <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
            提醒通知
          </Text>
          {notificationPermission === null ? (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              检查中…
            </Text>
          ) : notificationPermission.platform === 'web' ? (
            notificationPermission.status === 'granted' ? (
              <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                已授权 — 稍后与日历提醒会通过 Web 浏览器通知按时提醒。
              </Text>
            ) : notificationPermission.status === 'denied' ? (
              <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                通知已被拒绝 — 可在浏览器设置中允许此网站发送通知。
              </Text>
            ) : (
              <View className="gap-2">
                <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                  {isIosWebSafari()
                    ? 'iOS Safari 需将 Nextdo「添加到主屏幕」后即可接收系统通知。'
                    : '尚未授权 — 点击可开启浏览器提醒通知。'}
                </Text>
                <Button
                  label="开启通知"
                  variant="secondary"
                  onPress={() => {
                    void requestPermission();
                  }}
                />
              </View>
            )
          ) : notificationPermission.platform === 'tauri' ? (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              桌面通知跟随系统设置（当前
              {notificationPermission.status === 'granted' ? '可用' : '不可用'}
              ）。应用关闭期间不会提醒。
            </Text>
          ) : notificationPermission.status === 'granted' ? (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              已授权 — 稍后与日历提醒会按时通知。
            </Text>
          ) : notificationPermission.status === 'denied' ? (
            <View className="gap-3">
              <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                通知已被拒绝 — 稍后与日历行动仍会记录，但不会在设定时刻提醒。
              </Text>
              {Platform.OS === 'ios' ? (
                <Button
                  label="去系统设置"
                  variant="secondary"
                  onPress={openSystemSettings}
                />
              ) : (
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  可在「系统设置 → 应用 → Nextdo → 通知」中重新允许。
                </Text>
              )}
            </View>
          ) : (
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              尚未授权 — 首次「稍后」或创建限时日历行动时，会请求通知权限。
            </Text>
          )}
        </Card>

        {/* Habit Check-in Reminders (issue 32-A) */}
        <Card className="mt-4 gap-3 p-3.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-2">
              <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                习惯打卡提醒
              </Text>
              <Text className="mt-0.5 font-sans text-xs text-muted dark:text-muted-dark">
                未完成习惯到点提醒，避免漏打卡。
              </Text>
            </View>
            <Switch
              accessibilityLabel="开启习惯打卡提醒"
              value={habitReminderOptions?.enabled ?? true}
              onValueChange={(val) => void updateHabitReminders({ enabled: val })}
              trackColor={{ false: '#716b64', true: '#c85a17' }}
            />
          </View>

          {habitReminderOptions?.enabled ? (
            <View className="gap-2.5 border-t border-border/40 pt-2.5 dark:border-border-dark/40">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-2">
                  <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
                    全天习惯提醒时刻
                  </Text>
                  <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">
                    无时间窗口的习惯在此刻提醒；有窗口的在窗口结束时提醒。
                  </Text>
                </View>
                <View className="w-28">
                  <PickerField
                    label="全天提醒时刻"
                    value={habitReminderOptions.allDayReminderHhmm}
                    placeholder="21:00"
                    onPress={() => setOpenHabitTimePicker(true)}
                  />
                </View>
              </View>
            </View>
          ) : null}
        </Card>

        {/* Cloud sync block (R6) */}
        <Card className="mt-4 gap-3 p-3.5">
        <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
          云同步
        </Text>
        {state === 'loading' ? (
          <Text className="font-sans text-sm text-muted dark:text-muted-dark">
            检查中…
          </Text>
        ) : state === 'connected' ? (
          <View className="gap-3">
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              已连接 — 数据在这台设备与服务器之间自动同步。
            </Text>
            {/* The four questions users actually ask about sync (issue #15).
                Answered from the code's real behaviour, not a design doc —
                see docs/sync.md, which is the long version. */}
            <SyncExplainer
              open={showSyncHelp}
              onToggle={() => setShowSyncHelp((prev) => !prev)}
            />
            {storedConfig !== null ? (
              <View className="gap-1">
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  后端地址：{storedConfig.backendUrl}
                </Text>
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  同步流地址：{storedConfig.endpoint}
                </Text>
              </View>
            ) : null}
            {rejections.length > 0 && rejections[rejections.length - 1] ? (
              <View className="gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans text-xs font-semibold text-red-500 dark:text-red-400">
                    ⚠️ 发现 {rejections.length} 条操作被服务端拒绝同步
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清除同步异常警告"
                    onPress={() => {
                      void clearUploadRejections();
                    }}
                  >
                    <Text className="font-sans text-xs text-muted underline dark:text-muted-dark">
                      清除警告
                    </Text>
                  </Pressable>
                </View>
                <Text className="font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
                  最近异常：[{rejections[rejections.length - 1]?.code}]{' '}
                  {rejections[rejections.length - 1]?.message}
                </Text>
              </View>
            ) : null}
            {storedConfig !== null && ownerToken !== null ? (
              <View className="gap-2 pt-1">
                <View className="flex-row gap-2">
                  <Button
                    label={copied ? '已复制' : '复制连接串'}
                    variant="secondary"
                    onPress={() => {
                      void handleCopyConnectionString();
                    }}
                  />
                  <Button
                    label={showQrCode ? '收起二维码' : '扫码配对'}
                    variant="secondary"
                    onPress={() => {
                      setShowQrCode((prev) => !prev);
                    }}
                  />
                </View>
                {showQrCode && exportedDeepLink ? (
                  <View className="items-center gap-2 rounded-xl border border-border/80 bg-surface p-4 dark:border-border-dark dark:bg-surface-dark">
                    <QRCode value={exportedDeepLink} size={180} />
                    <Text className="text-center font-sans text-xs text-muted dark:text-muted-dark">
                      使用其他设备扫码，即可一键配对并连接此同步服务
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Button
              label="断开连接"
              variant="secondary"
              onPress={() => {
                void disconnect();
              }}
            />
          </View>
        ) : (
          <View className="gap-3">
            <Text className="font-sans text-sm text-muted dark:text-muted-dark">
              未连接 — 数据仅保存在这台设备上。粘贴来自其他设备或服务器的云同步连接串，或填写自建服务器地址开启同步。
            </Text>

            {/* Same explainer as the connected state — the unconnected reader
                is the one who most needs to know what connecting would do. */}
            <SyncExplainer
              open={showSyncHelp}
              onToggle={() => setShowSyncHelp((prev) => !prev)}
            />

            <Pressable
              accessibilityRole="link"
              accessibilityLabel="打开云同步搭建教程"
              onPress={() => {
                void openExternalUrl(
                  'https://my.feishu.cn/wiki/FDWJwoCHsiBgltk0sW4cKs47nKb?from=from_copylink',
                );
              }}
              className="flex-row items-center gap-1.5 self-start py-0.5"
            >
              <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                📖 查看 3 分钟零成本多端云同步教程 (飞书文档·纯网页) →
              </Text>
            </Pressable>

            {/* 场景分流选择器 */}
            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="模式：连接串配对"
                accessibilityState={{ selected: syncMode === 'pair' }}
                onPress={() => {
                  setSyncMode('pair');
                  clearError();
                }}
                className={cn(
                  'flex-1 items-center justify-center rounded-lg border py-2',
                  syncMode === 'pair'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-xs font-semibold',
                    syncMode === 'pair'
                      ? 'text-accent dark:text-accent-dark'
                      : 'text-ink dark:text-ink-dark',
                  )}
                >
                  连接串配对
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="模式：自建服务器"
                accessibilityState={{ selected: syncMode === 'self_host' }}
                onPress={() => {
                  setSyncMode('self_host');
                  clearError();
                }}
                className={cn(
                  'flex-1 items-center justify-center rounded-lg border py-2',
                  syncMode === 'self_host'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-xs font-semibold',
                    syncMode === 'self_host'
                      ? 'text-accent dark:text-accent-dark'
                      : 'text-ink dark:text-ink-dark',
                  )}
                >
                  自建服务器
                </Text>
              </Pressable>
            </View>

            {/* 对应模式下的主输入区域 */}
            {syncMode === 'pair' ? (
              <View className="gap-2">
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  粘贴来自其他设备的云同步连接串，或直接填入自建 Workers 网址：
                </Text>
                <TextInput
                  className={INPUT_CLASS}
                  placeholder={TOKEN_PLACEHOLDER}
                  value={token}
                  onChangeText={(next) => {
                    setToken(next);
                    clearError();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    void handleSubmit();
                  }}
                  accessibilityLabel={TOKEN_ACCESSIBILITY_LABEL}
                />
              </View>
            ) : (
              <View className="gap-2">
                <Text className="font-sans text-xs font-medium text-accent dark:text-accent-dark">
                  💡 首台免密绑定：只需输入自建服务器地址，连接后自动生成密钥完成绑定，无需寻找 Token。
                </Text>
                <TextInput
                  className={INPUT_CLASS}
                  placeholder={SERVER_ADDRESS_PLACEHOLDER}
                  value={serverAddress}
                  onChangeText={handleServerAddressChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    void handleSubmit();
                  }}
                  accessibilityLabel="服务器地址"
                />
              </View>
            )}

            {/* 常见疑问引导卡片：什么是连接串？去哪里找？ */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="什么是 Token 指引"
              onPress={() => {
                setShowTokenGuide((prev) => !prev);
              }}
              className="flex-row items-center justify-between rounded-lg border border-border/60 bg-surface/50 p-2.5 dark:border-border-dark/60 dark:bg-surface-dark/50"
            >
              <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
                💡 什么是连接串？去哪里找？
              </Text>
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                {showTokenGuide ? '收起 ▴' : '查看说明 ▾'}
              </Text>
            </Pressable>
            {showTokenGuide ? (
              <View className="gap-2 rounded-lg border border-border/40 bg-surface/30 p-3 dark:border-border-dark/40 dark:bg-surface-dark/30">
                <View className="gap-0.5">
                  <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                    1. 首台绑定（自己部署的 Workers 服务端）
                  </Text>
                  <Text className="font-sans text-xs text-muted dark:text-muted-dark leading-relaxed">
                    按照教程部署完 Workers 后，打开 Workers 看板复制「云同步连接串」（或直接点击网页上的「在 Nextdo App 中打开」），也可仅输入自建服务器地址一键免密认领绑定。
                  </Text>
                </View>
                <View className="gap-0.5">
                  <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                    2. 后续设备（多端同步配对）
                  </Text>
                  <Text className="font-sans text-xs text-muted dark:text-muted-dark leading-relaxed">
                    无需手动输入密钥。在已连接的设备设置中点击「扫码配对」或「复制连接串」，手机扫码或粘贴该连接串（包含服务器地址与密钥）即可秒级加入。
                  </Text>
                </View>
                <View className="gap-0.5">
                  <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                    3. 零成本·纯网页搭建
                  </Text>
                  <Text className="font-sans text-xs text-muted dark:text-muted-dark leading-relaxed">
                    无需下载源代码，无需自备服务器，利用主流云平台永久免费套餐全程在网页中点选即可搭建，数据完全属于你自己。
                  </Text>
                </View>
              </View>
            ) : null}

            {/* 高级设置手风琴 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="高级设置"
              accessibilityState={{ expanded: advancedOpen }}
              onPress={() => {
                setAdvancedOpen((prev) => !prev);
              }}
              className="flex-row items-center gap-1 py-1"
            >
              <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                {advancedOpen ? '收起高级设置' : '高级设置与手动输入'}
              </Text>
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                {advancedOpen ? '▴' : '▾'}
              </Text>
            </Pressable>
            {advancedOpen ? (
              <View className="gap-3 pt-1">
                {syncMode === 'pair' ? (
                  <>
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                      手动输入服务器基础地址（未粘贴完整连接串时使用）：
                    </Text>
                    <TextInput
                      className={INPUT_CLASS}
                      placeholder={SERVER_ADDRESS_PLACEHOLDER}
                      value={serverAddress}
                      onChangeText={handleServerAddressChange}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      accessibilityLabel="服务器地址"
                    />
                  </>
                ) : (
                  <>
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                      静态部署 Owner Token（仅当服务器预设了环境变量时填写，通常留空）：
                    </Text>
                    <TextInput
                      className={INPUT_CLASS}
                      placeholder="静态部署的 64-hex Token（选填）"
                      value={token}
                      onChangeText={(next) => {
                        setToken(next);
                        clearError();
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      accessibilityLabel="手动 Owner Token"
                    />
                  </>
                )}
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  自定义反代路径时才需要：两项都填写时优先于上面的服务器地址。
                </Text>
                <TextInput
                  className={INPUT_CLASS}
                  placeholder={ADVANCED_BACKEND_PLACEHOLDER}
                  value={advancedBackendUrl}
                  onChangeText={(next) => {
                    setAdvancedBackendUrl(next);
                    clearError();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  accessibilityLabel="后端地址"
                />
                <TextInput
                  className={INPUT_CLASS}
                  placeholder={ADVANCED_ENDPOINT_PLACEHOLDER}
                  value={advancedEndpoint}
                  onChangeText={(next) => {
                    setAdvancedEndpoint(next);
                    clearError();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  accessibilityLabel="同步流地址"
                />
              </View>
            ) : null}
            {error !== null ? (
              <Text className="font-sans text-sm text-danger dark:text-danger-dark">
                {error}
              </Text>
            ) : null}
            <Button
              label={submitting ? '连接中…' : '连接'}
              disabled={!canSubmit}
              onPress={() => {
                void handleSubmit();
              }}
            />
          </View>
        )}
      </Card>

        {/* 检查更新：版本查询与安装包下载都走加速代理前缀，不直连 GitHub
            （地址拼接见 lib/app-update.ts）。发现新版本后按当前平台给出
            安装包，点击交给系统浏览器下载。 */}
        <Card className="mt-4 gap-3 p-3.5">
          <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
            应用更新
          </Text>
          {/* 版本号与发布渠道标识（Issue #14：明确区分正式版与测试版） */}
          <View className="flex-row items-center gap-2">
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              当前版本 {update.currentVersion === '' ? '未知' : update.currentVersion}
            </Text>
            {update.currentVersion !== '' ? (
              <View
                className={cn(
                  'rounded-full px-2 py-0.5',
                  update.channel === 'stable'
                    ? 'bg-surface-container dark:bg-surface-container-dark'
                    : 'bg-accent/15 dark:bg-accent-dark/20',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-[11px] font-semibold',
                    update.channel === 'stable'
                      ? 'text-muted dark:text-muted-dark'
                      : 'text-accent dark:text-accent-dark',
                  )}
                >
                  {update.channelLabel}
                </Text>
              </View>
            ) : null}
          </View>
          {/* 更新渠道偏好切换（Issue #18：用户自主设定默认接收更新的渠道） */}
          <View className="gap-1.5 pt-0.5">
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              更新渠道偏好
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="偏好正式版渠道"
                accessibilityState={{ selected: update.preferredChannel === 'stable' }}
                onPress={() => {
                  void update.setPreferredChannel('stable');
                }}
                className={cn(
                  'flex-1 items-center justify-center rounded-lg border py-2 px-1',
                  update.preferredChannel === 'stable'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-xs font-semibold',
                    update.preferredChannel === 'stable'
                      ? 'text-accent dark:text-accent-dark'
                      : 'text-ink dark:text-ink-dark',
                  )}
                >
                  正式版（稳定推荐）
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="偏好测试版渠道"
                accessibilityState={{ selected: update.preferredChannel === 'beta' }}
                onPress={() => {
                  void update.setPreferredChannel('beta');
                }}
                className={cn(
                  'flex-1 items-center justify-center rounded-lg border py-2 px-1',
                  update.preferredChannel === 'beta'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-xs font-semibold',
                    update.preferredChannel === 'beta'
                      ? 'text-accent dark:text-accent-dark'
                      : 'text-ink dark:text-ink-dark',
                  )}
                >
                  测试版（优先尝鲜）
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 自动检查更新开关 */}
          <View className="flex-row items-center justify-between py-1 border-t border-border/40 dark:border-border-dark/40 pt-2">
            <View className="gap-0.5 flex-1 pr-3">
              <Text className="font-sans text-xs font-semibold text-ink dark:text-ink-dark">
                自动检查更新
              </Text>
              <Text className="font-sans text-[11px] text-muted dark:text-muted-dark leading-tight">
                开启后应用启动时自动检测新版本，若有更新将展示更新说明供您确认
              </Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="自动检查更新"
              accessibilityState={{ checked: update.autoCheckEnabled }}
              onPress={() => {
                void update.setAutoCheckEnabled(!update.autoCheckEnabled);
              }}
              className={cn(
                'h-6 w-11 rounded-full p-0.5 justify-center',
                update.autoCheckEnabled
                  ? 'bg-accent dark:bg-accent-dark'
                  : 'bg-muted/40 dark:bg-muted-dark/40',
              )}
            >
              <View
                className={cn(
                  'h-5 w-5 rounded-full bg-white shadow-sm',
                  update.autoCheckEnabled ? 'self-end' : 'self-start',
                )}
              />
            </Pressable>
          </View>

          <Button
            label={update.checking ? '检查中…' : '检查更新'}
            disabled={update.checking}
            onPress={update.check}
          />
          {update.outcome?.kind === 'up-to-date' ? (
            <View className="gap-1">
              <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                已是最新版本（{update.outcome.channel === 'beta' ? `测试版 ${update.outcome.latestVersion}` : `正式版 ${update.outcome.latestVersion}`}）。
              </Text>
              {update.outcome.stableRelease || update.outcome.betaRelease ? (
                <Text className="font-sans text-xs text-muted/80 dark:text-muted-dark/80">
                  {update.outcome.stableRelease ? `正式版：v${update.outcome.stableRelease.version}` : ''}
                  {update.outcome.stableRelease && update.outcome.betaRelease ? ' · ' : ''}
                  {update.outcome.betaRelease ? `测试版：v${update.outcome.betaRelease.version}` : ''}
                </Text>
              ) : null}
            </View>
          ) : null}
          {update.outcome?.kind === 'failed' ? (
            <Text className="font-sans text-sm text-danger dark:text-danger-dark">
              {UPDATE_FAILURE_COPY[update.outcome.reason]}
            </Text>
          ) : null}
          {update.outcome?.kind === 'available' ? (
            <View className="gap-3">
              {/* 多版本选择：当有两个或以上更新可用时让用户自主点选目标版本 */}
              {update.outcome.options.length > 1 ? (
                <View className="gap-2">
                  <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                    发现可用新版本，请选择要更新的目标：
                  </Text>
                  <View className="gap-2">
                    {update.outcome.options.map((opt) => {
                      const isSelected = opt.version === update.selectedVersion;
                      return (
                        <Pressable
                          key={opt.version}
                          accessibilityRole="button"
                          accessibilityLabel={`选择更新至 ${opt.channelLabel} v${opt.version}`}
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => {
                            update.selectVersion(opt.version);
                          }}
                          className={cn(
                            'rounded-xl border p-3 flex-row items-center justify-between',
                            isSelected
                              ? 'border-accent bg-accent/10 dark:border-accent-dark dark:bg-accent-dark/15'
                              : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                          )}
                        >
                          <View className="gap-1">
                            <View className="flex-row items-center gap-2">
                              <View
                                className={cn(
                                  'rounded-full px-2 py-0.5',
                                  opt.channel === 'stable'
                                    ? 'bg-surface-container dark:bg-surface-container-dark'
                                    : 'bg-accent/20 dark:bg-accent-dark/25',
                                )}
                              >
                                <Text
                                  className={cn(
                                    'font-sans text-[11px] font-semibold',
                                    opt.channel === 'stable'
                                      ? 'text-muted dark:text-muted-dark'
                                      : 'text-accent dark:text-accent-dark',
                                  )}
                                >
                                  {opt.channelLabel}
                                </Text>
                              </View>
                              <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                                v{opt.version}
                              </Text>
                              {opt.isPreferred ? (
                                <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">
                                  (偏好)
                                </Text>
                              ) : null}
                            </View>
                            {opt.publishedAt ? (
                              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                                发布于 {formatReleaseDate(opt.publishedAt)}
                              </Text>
                            ) : null}
                          </View>
                          <View
                            className={cn(
                              'h-5 w-5 rounded-full border items-center justify-center',
                              isSelected
                                ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
                                : 'border-muted/40 dark:border-muted-dark/40',
                            )}
                          >
                            {isSelected ? (
                              <Text className="text-white text-[10px] font-bold">✓</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : (
                <View className="gap-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                      发现新版本 v{update.outcome.latestVersion}
                    </Text>
                    {update.outcome.options[0] ? (
                      <View
                        className={cn(
                          'rounded-full px-2 py-0.5',
                          update.outcome.options[0].channel === 'stable'
                            ? 'bg-surface-container dark:bg-surface-container-dark'
                            : 'bg-accent/15 dark:bg-accent-dark/20',
                        )}
                      >
                        <Text
                          className={cn(
                            'font-sans text-[11px] font-semibold',
                            update.outcome.options[0].channel === 'stable'
                              ? 'text-muted dark:text-muted-dark'
                              : 'text-accent dark:text-accent-dark',
                          )}
                        >
                          {update.outcome.options[0].channelLabel}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {update.outcome.options[0]?.publishedAt ? (
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                      发布于 {formatReleaseDate(update.outcome.options[0].publishedAt)}
                    </Text>
                  ) : null}
                  {update.preferredChannel === 'stable' &&
                  update.outcome.options[0]?.channel !== 'stable' ? (
                    <Text className="font-sans text-xs text-muted/90 dark:text-muted-dark/90 mt-0.5">
                      提示：正式版当前已是最新，发现更高版本的测试版可供尝鲜。
                    </Text>
                  ) : null}
                </View>
              )}
              {/* 当前选定版本的 ChangeLog 更新说明展示 */}
              {(() => {
                const selectedOpt =
                  update.outcome.options.find((opt) => opt.version === update.selectedVersion) ??
                  update.outcome.options[0];
                if (!selectedOpt?.notes) return null;
                return (
                  <View className="gap-1 rounded-xl border border-border/70 bg-surface-container/30 p-3 dark:border-border-dark/70 dark:bg-surface-container-dark/30">
                    <Text className="font-sans text-xs font-semibold text-ink dark:text-ink-dark">
                      版本更新说明 (v{selectedOpt.version})
                    </Text>
                    <ScrollView nestedScrollEnabled className="max-h-40">
                      <Text className="font-sans text-xs leading-relaxed text-ink dark:text-ink-dark whitespace-pre-wrap">
                        {selectedOpt.notes}
                      </Text>
                    </ScrollView>
                  </View>
                );
              })()}
              {update.outcome.downloads.length === 0 ? (
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  没能识别你的设备型号，请在下方 release 页面选择安装包。
                </Text>
              ) : (
                <View className="gap-2">
                  {/* 桌面端应用内下载进度条 */}
                  {update.isDesktop && update.download.kind === 'downloading' ? (
                    <View className="gap-1.5">
                      <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                        正在下载…{' '}
                        {update.download.downloadedBytes > 0
                          ? `${(update.download.downloadedBytes / 1024 / 1024).toFixed(1)} MB`
                          : ''}
                      </Text>
                      <View className="h-2 overflow-hidden rounded-full bg-muted/20 dark:bg-muted-dark/20">
                        {/* 总大小未知时用不确定态（宽度 30% 动画），已知时按比例 */}
                        <View
                          className="h-full rounded-full bg-accent dark:bg-accent-dark"
                          style={{
                            width:
                              update.download.totalBytes > 0
                                ? `${Math.min(100, (update.download.downloadedBytes / update.download.totalBytes) * 100)}%`
                                : '30%',
                          }}
                        />
                      </View>
                    </View>
                  ) : null}
                  {update.isDesktop && update.download.kind === 'done' ? (
                    <View className="gap-1.5">
                      <Text className="font-sans text-xs text-accent dark:text-accent-dark">
                        ✓ 新版本已下载完成，可立即安装更新
                      </Text>
                      {update.installError ? (
                        <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                          自动安装失败：{update.installError}
                        </Text>
                      ) : null}
                      <Button
                        label={update.installing ? '正在安装并重启…' : '立即安装并重启'}
                        variant="secondary"
                        onPress={update.installUpdate}
                      />
                      <Button
                        label="手动打开安装包"
                        variant="ghost"
                        onPress={update.openInstaller}
                      />
                    </View>
                  ) : null}
                  {update.isDesktop && update.download.kind === 'error' ? (
                    <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                      下载失败：{update.download.error}
                    </Text>
                  ) : null}
                  {/* 下载按钮：桌面端走应用内下载，其他端走浏览器 */}
                  {update.download.kind !== 'downloading' && update.download.kind !== 'done'
                    ? update.outcome.downloads.map((dl) => (
                        <Button
                          key={dl.url}
                          label={
                            update.isDesktop
                              ? `下载并安装 ${dl.label}`
                              : `下载 ${dl.label}`
                          }
                          variant="secondary"
                          onPress={() => {
                            if (update.isDesktop) {
                              update.startDownload(dl.url);
                            } else {
                              void openExternalUrl(dl.url);
                            }
                          }}
                        />
                      ))
                    : null}
                </View>
              )}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="查看全部安装包"
                onPress={() => {
                  void openExternalUrl(update.pageUrl);
                }}
                className="self-start py-0.5"
              >
                <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                  查看全部安装包 →
                </Text>
              </Pressable>
            </View>
          ) : null}
        </Card>
        </View>
      </ScrollView>
          {openHabitTimePicker && habitReminderOptions ? (
        <DateTimePicker
          mode="time"
          title="选择全天习惯提醒时刻"
          value={habitReminderOptions.allDayReminderHhmm}
          now={now}
          onConfirm={(val) => {
            void updateHabitReminders({ allDayReminderHhmm: val });
            setOpenHabitTimePicker(false);
          }}
          onClose={() => setOpenHabitTimePicker(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
