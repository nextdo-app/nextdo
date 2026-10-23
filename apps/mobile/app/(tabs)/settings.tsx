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
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme, type ThemePreference } from '@/lib/theme';
import { Button, Card, cn, colors } from '@nextdo/ui';
import { useCloudSync } from '@/hooks/use-cloud-sync';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { useNotificationSettings } from '@/hooks/use-notification-settings';
import { useCalendarPermission } from '@/hooks/use-calendar-permission';
import type { NotificationSoundTone } from '@/lib/notification-settings';
import {
  REMINDER_DELIVERY_CHANNELS,
  type ReminderDeliveryChannel,
} from '@/lib/notification-settings';
import { playNotificationTone } from '@/lib/notification-sound';
import { useReminderPermission } from '@/hooks/use-reminder-permission';
import type { ReminderPermissionState } from '@/lib/reminders/adapters';
import { useAppClock } from '@/hooks/use-app-clock';
import { useHabitReminders } from '@/hooks/use-habit-reminders';
import { useHabits } from '@/hooks/use-habits';
import { PickerField } from '@/components/picker-field';
import { FormField } from '@/components/form-field';
import { DateTimePicker } from '@/components/datetime-picker';
import { useAppUpdate } from '@/hooks/use-app-update';
import { formatReleaseDate, openExternalUrl, type UpdateFailureReason } from '@/lib/app-update';
import {
  describeSyncFailure,
  formatLastSyncedAt,
  truncateForDisplay,
  type SyncDisplay,
} from '@/lib/sync-status';
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

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const SOUND_TONE_LABELS: Record<NotificationSoundTone, string> = {
  gentle: '轻柔',
  important: '提醒',
  alarm: '闹铃',
};

const SOUND_TONE_ICONS: Record<NotificationSoundTone, IoniconsName> = {
  gentle: 'leaf-outline',
  important: 'notifications-outline',
  alarm: 'alarm-outline',
};

const SOUND_TONES = Object.keys(SOUND_TONE_LABELS) as NotificationSoundTone[];

/** Issue #63 — the three delivery channels, in the order the picker shows them. */
const REMINDER_CHANNEL_LABELS: Record<ReminderDeliveryChannel, string> = {
  app: '应用内通知',
  calendar: '系统日历',
  both: '两者都发',
};
const REMINDER_CHANNEL_HINTS: Record<ReminderDeliveryChannel, string> = {
  app: '由 Nextdo 自己发出的通知提醒',
  calendar: '把提醒写成带闹钟的日历事件，由系统日历通知',
  both: '应用内通知和系统日历事件都发，宁可多响一次',
};
const REMINDER_CHANNEL_ICONS: Record<ReminderDeliveryChannel, IoniconsName> = {
  app: 'notifications-outline',
  calendar: 'calendar-outline',
  both: 'layers-outline',
};

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { value: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
  { value: 'light', label: '浅色模式', icon: 'sunny-outline' },
  { value: 'dark', label: '深色模式', icon: 'moon-outline' },
];

/** 小节标题（语义分组，静雅克制） */
function SectionHeader({
  title,
  icon,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { isDark } = useAppTheme();
  return (
    <View className="flex-row items-center gap-1.5 mt-7 mb-2 px-1">
      <Ionicons name={icon} size={14} color={isDark ? colors.mutedDark : colors.muted} />
      <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
        {title}
      </Text>
    </View>
  );
}

/** 检查失败的三种原因 → 提示文案（文案归屏幕，逻辑层只给 reason）。 */
const UPDATE_FAILURE_COPY: Record<UpdateFailureReason, string> = {
  network: '连不上更新服务器，请检查网络后重试。',
  http: '更新服务器暂时不可用，请稍后重试。',
  payload: '没能读到版本信息，请稍后重试。',
};

/**
 * 云同步状态文案（issue #22）——逻辑层只给 `kind` 与数据，句子归屏幕。
 *
 * `offline` 那条只会在「已配置同步但流断了」时渲染（完全未连接走的是卡片
 * 另一套文案），所以它是「正在重连」，而不是「数据只在本地」。
 */
function syncStatusLabel(display: SyncDisplay): string {
  switch (display.kind) {
    case 'offline':
      return '未连接 — 正在重试连接同步服务器。';
    case 'syncing':
      return '同步中…';
    case 'pending':
      return `有 ${display.pendingUploads} 条改动待上传。`;
    case 'synced':
      return '已同步 — 数据在这台设备与服务器之间自动同步。';
    case 'failed': {
      // 认证类失败是部署侧的配置问题，重试不会自愈：标题只说清是哪一层被拒，
      // 绝不把服务端那段 JSON 直接当文案（展开与处置见 syncFailureHint）。
      const failure = describeSyncFailure(display.error);
      if (failure?.kind === 'auth') return '同步凭据被同步服务拒绝';
      return `同步失败：${truncateForDisplay(display.error ?? '未知原因')}`;
    }
    default: {
      const exhaustive: never = display.kind;
      return exhaustive;
    }
  }
}

/**
 * 认证类失败的第二行：告诉用户去哪改什么。
 *
 * 自建与 Cloud 两套部署都由 server/app 以**固定的 kid** 签发 JWT
 * （`server/app/src/credentials.ts` 的 `nextdo-dev`），同步服务的 keystore
 * 里必须有同 kid 的密钥 —— 少一个就正好是 PowerSync 的 PSYNC_S2101。
 */
function syncFailureHint(display: SyncDisplay): string | null {
  if (display.kind !== 'failed') return null;
  const failure = describeSyncFailure(display.error);
  if (failure?.kind !== 'auth') return null;
  const code = failure.code ?? 'AuthorizationError';
  if (failure.code === 'PSYNC_S2103') {
    return `同步凭据已过期（${code}）—— 点「立即同步」会重新取一次凭据。`;
  }
  return `同步服务的密钥与后端签发的 JWT 不匹配（${code}）：请在 PowerSync 的 Authentication 把 HS256 密钥的 kid 设为 nextdo-dev，保存后点「立即同步」重试。`;
}

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

/**
 * The Settings card's EFFECTIVE state (issue #45 R5): delivery needs the
 * in-app switch AND the OS grant, so the headline must not claim 「已开启」
 * while the system permission is missing. Pure — two independent layers in,
 * one sentence out; the screen renders it and nothing else decides the
 * wording.
 */
export interface NotificationEffectiveState {
  title: string;
  detail: string;
}

export function describeNotificationState(
  masterEnabled: boolean | null,
  permission: ReminderPermissionState | null,
): NotificationEffectiveState {
  // null = still loading — say so instead of guessing either way.
  if (permission === null || masterEnabled === null) {
    return { title: '通知状态', detail: '检查中…' };
  }
  if (!masterEnabled) {
    return {
      title: '已在应用内关闭',
      detail:
        permission.status === 'granted'
          ? '已排入系统的提醒已撤销；重新打开后按提醒数据重新排程。'
          : '应用内与系统权限均未开启，提醒不会送达。',
    };
  }
  const platformNote =
    permission.platform === 'web'
      ? '将通过 Web 浏览器通知送达。'
      : permission.platform === 'tauri'
        ? '应用关闭期间不会提醒。'
        : '';
  switch (permission.status) {
    case 'granted':
      return {
        title: '已开启',
        detail: `稍后、日历与习惯提醒会按时送达。${platformNote}`,
      };
    case 'denied':
      if (permission.platform === 'native' && permission.canAskAgain) {
        return {
          title: '等待系统授权',
          detail: '点下方按钮开启通知，准时接收稍后与习惯提醒。',
        };
      }
      return {
        title: '系统权限未开启',
        detail: '提醒会照常记录，但不会按时送达 —— 需要到系统设置里允许。',
      };
    default:
      return {
        title: '等待系统授权',
        detail:
          permission.platform === 'native'
            ? '点下方按钮开启通知，准时接收稍后与习惯提醒。'
            : '首次真正需要提醒时，Nextdo 会请求通知权限。',
      };
  }
}

/** The single platform action row under the switch, if any (issue #45 R4/R6). */
export type NotificationAction = 'native-request' | 'web-request' | 'open-system-settings' | null;

export function notificationActionFor(
  permission: ReminderPermissionState | null,
): NotificationAction {
  if (permission === null) return null;
  if (permission.status !== 'undetermined' && permission.status !== 'denied') return null;
  // On native: if undetermined or denied with canAskAgain, we can request permission
  if (
    permission.platform === 'native' &&
    (permission.status === 'undetermined' || (permission.status === 'denied' && permission.canAskAgain))
  ) {
    return 'native-request';
  }
  // Browsers require a user gesture — that button is the ONLY viable entry
  // there, not a redundant manual step.
  if (permission.platform === 'web') return 'web-request';
  // Once denied and can no longer prompt in-app, deep-link to system settings.
  if (permission.platform === 'native' && permission.status === 'denied' && !permission.canAskAgain) {
    return 'open-system-settings';
  }
  return null;
}

export default function SettingsScreen() {
  const { preference, updatePreference, isDark } = useAppTheme();
  const switchTrackColor = {
    false: isDark ? colors.borderDark : colors.border,
    true: isDark ? colors.accentDark : colors.accent,
  };
  const switchThumbColor = '#ffffff';
  const { state, storedConfig, ownerToken, connect, disconnect } = useCloudSync();
  // 同步状态（issue #22）：已配置同步时才去读队列深度（断开态没有可展示的号）。
  const {
    display: syncDisplay,
    manual: manualSync,
    syncNow,
    lastSyncedAt,
  } = useSyncStatus(state === 'connected');
  const { state: notificationPermission, openSystemSettings, requestPermission } =
    useReminderPermission();
  const {
    settings: notificationSettings,
    masterEnabled,
    updateSettings,
    setMasterEnabled,
  } = useNotificationSettings();
  const calendarPermission = useCalendarPermission();
  // 有效状态（issue #45 R5）：开关 ∧ 系统授权 —— 两个纯函数决定文案与平台动作。
  const notificationState = describeNotificationState(masterEnabled, notificationPermission);
  const notificationAction = notificationActionFor(notificationPermission);
  const now = useAppClock();
  const lastSyncedLabel = formatLastSyncedAt(now, lastSyncedAt);
  const syncHint = syncFailureHint(syncDisplay);
  const { data: habitRows } = useHabits(now);
  const activeHabits = (habitRows ?? []).map((r) => r.habit).filter(
    (h) => h.deletedAt === null && h.status === 'active',
  );
  const hasAllDayHabits = activeHabits.some((h) => !h.windowStart || !h.windowEnd);
  const allWindowedHabits = activeHabits.length > 0 && !hasAllDayHabits;
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
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-4xl mx-auto pb-12">
        {/* Header block (matches the other tabs) */}
        <View className="mb-1">
          <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
            设置
          </Text>
          <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
            设备与云同步。
          </Text>
        </View>

        {/* Section 1: 通用与偏好 */}
        <SectionHeader title="通用与偏好" icon="options-outline" />
        <Card className="gap-3.5 p-4">
          <View className="gap-1">
            <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
              外观主题
            </Text>
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              选择跟随系统设置，或固定使用浅色 / 深色外观。
            </Text>
          </View>
          <View className="flex-row gap-2">
            {THEME_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`主题：${option.label}`}
                accessibilityState={{ selected: preference === option.value }}
                onPress={() => void updatePreference(option.value)}
                className={cn(
                  'flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border py-2.5 px-2 active:opacity-80',
                  preference === option.value
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={
                    preference === option.value
                      ? isDark
                        ? colors.accentDark
                        : colors.accent
                      : isDark
                        ? colors.mutedDark
                        : colors.muted
                  }
                />
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

        {/* Section 2: 提醒与通知 */}
        <SectionHeader title="提醒与通知" icon="notifications-outline" />
        <Card className="gap-3.5 p-4">
          {/* 1) 有效状态先行（issue #45 R5）：应用内开关 ∧ 系统授权，未授权绝不显示为「已开启」。 */}
          <View className="flex-row items-center gap-3">
            <View className="h-8 w-8 rounded-lg bg-surface-container/60 dark:bg-surface-container-dark/60 items-center justify-center shrink-0">
              <Ionicons name="notifications-outline" size={16} color={isDark ? colors.mutedDark : colors.muted} />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                {notificationState.title}
              </Text>
              <Text className="mt-0.5 font-sans text-[11px] leading-tight text-muted dark:text-muted-dark">
                {notificationState.detail}
              </Text>
            </View>
          </View>

          {/* 2) 应用内开关（与系统权限相互独立）。 */}
          <View className="flex-row items-center justify-between gap-2 border-t border-border/40 pt-3 dark:border-border-dark/40">
            <View className="flex-1 min-w-0 pr-2">
              <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                应用内提醒
              </Text>
              <Text className="mt-0.5 font-sans text-[11px] leading-tight text-muted dark:text-muted-dark">
                应用内偏好，与系统权限相互独立；关掉后已排入系统的提醒会立即撤销。
              </Text>
            </View>
            <View className="shrink-0">
              <Switch
                accessibilityLabel="应用内通知总开关"
                value={masterEnabled ?? true}
                onValueChange={(val) => {
                  void setMasterEnabled(val);
                  if (val && notificationPermission?.status === 'undetermined') {
                    void requestPermission();
                  }
                }}
                trackColor={switchTrackColor}
                thumbColor={switchThumbColor}
                {...({ activeThumbColor: switchThumbColor } as object)}
              />
            </View>
          </View>

          {/* 3) 平台动作：native 提供开启通知按钮，被拒后引导至设置；
           *    web 受浏览器机制所限，保留手势入口。 */}
          {notificationAction === null ? null : (
            <View className="border-t border-border/40 pt-2.5 dark:border-border-dark/40">
              {notificationAction === 'native-request' ? (
                <View className="gap-2">
                  <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                    开启系统通知权限后，任务到期与习惯打卡将准时提醒。
                  </Text>
                  <Button
                    label="开启通知"
                    variant="secondary"
                    onPress={() => {
                      void requestPermission();
                    }}
                  />
                </View>
              ) : notificationAction === 'web-request' ? (
                <View className="gap-2">
                  <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                    {isIosWebSafari()
                      ? 'iOS Safari 需将 Nextdo「添加到主屏幕」后即可接收系统通知。'
                      : '浏览器要求由你手动开启一次：点下方按钮允许此网站发送通知。'}
                  </Text>
                  <Button
                    label="开启浏览器通知"
                    variant="secondary"
                    onPress={() => {
                      void requestPermission();
                    }}
                  />
                </View>
              ) : (
                <View className="gap-3">
                  <Text className="font-sans text-sm text-muted dark:text-muted-dark">
                    {Platform.OS === 'ios'
                      ? '已拒绝过系统权限 — 只能到系统设置里重新允许。'
                      : '系统通知权限已被拒绝 — 到系统设置里为 Nextdo 重新开启即可。'}
                  </Text>
                  <Button label="去系统设置" variant="secondary" onPress={openSystemSettings} />
                </View>
              )}
            </View>
          )}

          {/* Habit Check-in Reminders inside Notification card */}
          <View className="border-t border-border/40 pt-3 dark:border-border-dark/40">
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-row items-center gap-3 flex-1 min-w-0 pr-1">
                <View className="h-8 w-8 rounded-lg bg-surface-container/60 dark:bg-surface-container-dark/60 items-center justify-center shrink-0">
                  <Ionicons name="calendar-outline" size={16} color={isDark ? colors.mutedDark : colors.muted} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                    习惯打卡提醒
                  </Text>
                  <Text className="mt-0.5 font-sans text-xs text-muted dark:text-muted-dark leading-tight">
                    未完成习惯到点提醒，避免漏打卡。
                  </Text>
                </View>
              </View>
              <View className="shrink-0">
                <Switch
                  accessibilityLabel="开启习惯打卡提醒"
                  value={habitReminderOptions?.enabled ?? true}
                  onValueChange={(val) => void updateHabitReminders({ enabled: val })}
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
                  {...({ activeThumbColor: switchThumbColor } as object)}
                />
              </View>
            </View>

            {habitReminderOptions?.enabled ? (
              <View className="gap-2.5 pt-3">
                {allWindowedHabits ? (
                  <View className="gap-1 rounded-lg bg-surface-container/30 p-2.5 dark:bg-surface-container-dark/30">
                    <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
                      时间窗口提醒已就绪
                    </Text>
                    <Text className="font-sans text-[11px] leading-relaxed text-muted dark:text-muted-dark">
                      当前所有习惯均已设置时间窗口，将在各自时间窗口开始前与结束前（未打卡时）自动提醒，无需配置全天提醒时刻。
                    </Text>
                  </View>
                ) : (
                  <View className="flex-row items-center justify-between rounded-lg bg-surface-container/20 p-2.5 dark:bg-surface-container-dark/20">
                    <View className="flex-1 pr-2">
                      <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
                        全天习惯提醒时刻
                      </Text>
                      <Text className="font-sans text-[11px] leading-relaxed text-muted dark:text-muted-dark">
                        无时间窗口的习惯在此刻提醒；有窗口的在窗口开始前与结束前提醒。
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
                )}
              </View>
            ) : null}
          </View>
        </Card>

        {/* Section 3: 声音与日历（issue #54） */}
        <SectionHeader title="声音与日历" icon="volume-high-outline" />
        <Card className="gap-3.5 p-4">
          {/* 1) 提醒提示音开关。 */}
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-1 min-w-0 pr-2">
              <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                提醒音效
              </Text>
              <Text className="mt-0.5 font-sans text-[11px] leading-tight text-muted dark:text-muted-dark">
                提醒触发时播放提示音（音量跟随系统音量）。
              </Text>
            </View>
            <View className="shrink-0">
              <Switch
                accessibilityLabel="提醒音效"
                value={notificationSettings?.reminderSoundEnabled ?? true}
                onValueChange={(val) => void updateSettings({ reminderSoundEnabled: val })}
                trackColor={switchTrackColor}
                thumbColor={switchThumbColor}
                {...({ activeThumbColor: switchThumbColor } as object)}
              />
            </View>
          </View>

          {/* 2) 专注结束音效开关。 */}
          <View className="flex-row items-center justify-between gap-2 border-t border-border/40 pt-3 dark:border-border-dark/40">
            <View className="flex-1 min-w-0 pr-2">
              <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                专注结束音效
              </Text>
              <Text className="mt-0.5 font-sans text-[11px] leading-tight text-muted dark:text-muted-dark">
                计时结束时播放提示音，避免错过收尾。
              </Text>
            </View>
            <View className="shrink-0">
              <Switch
                accessibilityLabel="专注结束音效"
                value={notificationSettings?.focusSoundEnabled ?? true}
                onValueChange={(val) => void updateSettings({ focusSoundEnabled: val })}
                trackColor={switchTrackColor}
                thumbColor={switchThumbColor}
                {...({ activeThumbColor: switchThumbColor } as object)}
              />
            </View>
          </View>

          {/* 3) 音色选择：点击即试听并保存。 */}
          <View className="rounded-xl bg-surface-container/30 p-2.5 dark:bg-surface-container-dark/30">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">音色</Text>
              <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">点击可试听</Text>
            </View>
            <View className="mt-2 flex-row gap-2">
              {SOUND_TONES.map((tone) => (
                <Pressable
                  key={tone}
                  accessibilityLabel={`音色：${SOUND_TONE_LABELS[tone]}`}
                  accessibilityHint="双击试听并设为当前音色"
                  accessibilityRole="button"
                  onPress={() => {
                    void updateSettings({ soundTone: tone });
                    void playNotificationTone(tone);
                  }}
                  className={cn(
                    'flex-1 items-center gap-1.5 rounded-xl border px-2 py-2.5',
                    notificationSettings?.soundTone === tone
                      ? 'border-accent bg-accent/10'
                      : 'border-border/60 dark:border-border-dark/60',
                  )}
                >
                  <Ionicons
                    name={SOUND_TONE_ICONS[tone]}
                    size={18}
                    color={
                      notificationSettings?.soundTone === tone
                        ? isDark
                          ? colors.accentDark
                          : colors.accent
                        : isDark
                          ? colors.mutedDark
                          : colors.muted
                    }
                  />
                  <Text
                    className={cn(
                      'font-sans text-xs font-semibold',
                      notificationSettings?.soundTone === tone
                        ? 'text-accent dark:text-accent-dark'
                        : 'text-ink dark:text-ink-dark',
                    )}
                  >
                    {SOUND_TONE_LABELS[tone]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 4) 提醒方式（issue #63）：决定提醒由谁发出。 */}
          <View className="border-t border-border/40 pt-3 dark:border-border-dark/40">
            <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
              提醒方式
            </Text>
            <Text className="mt-0.5 font-sans text-[11px] leading-tight text-muted dark:text-muted-dark">
              {calendarPermission.supported
                ? '系统日历会把提醒写成带闹钟的日历事件，应用被划掉也能响；应用内通知依赖后台调度。'
                : '当前平台不支持系统日历，提醒由应用内通知发出。'}
            </Text>
            <View className="mt-2 flex-row gap-2">
              {REMINDER_DELIVERY_CHANNELS.filter(
                (channel) => channel !== 'calendar' || calendarPermission.supported,
              ).map((channel) => (
                <Pressable
                  key={channel}
                  accessibilityRole="button"
                  accessibilityLabel={`提醒方式：${REMINDER_CHANNEL_LABELS[channel]}`}
                  accessibilityHint={REMINDER_CHANNEL_HINTS[channel]}
                  accessibilityState={{ selected: (notificationSettings?.reminderChannel ?? 'app') === channel }}
                  onPress={() => {
                    // The calendar channels need the OS permission first —
                    // the same request path the sync switch below uses, so
                    // the user sees one intent prompt, not two.
                    if (channel === 'app') {
                      void updateSettings({ reminderChannel: channel });
                      return;
                    }
                    void calendarPermission.requestAccess().then((next) => {
                      if (next === 'granted') {
                        void updateSettings({ reminderChannel: channel });
                      }
                    });
                  }}
                  className={cn(
                    'flex-1 items-center gap-1 rounded-xl border px-2 py-2.5',
                    (notificationSettings?.reminderChannel ?? 'app') === channel
                      ? 'border-accent bg-accent/10'
                      : 'border-border/60 dark:border-border-dark/60',
                  )}
                >
                  <Ionicons
                    name={REMINDER_CHANNEL_ICONS[channel]}
                    size={18}
                    color={
                      (notificationSettings?.reminderChannel ?? 'app') === channel
                        ? isDark
                          ? colors.accentDark
                          : colors.accent
                        : isDark
                          ? colors.mutedDark
                          : colors.muted
                    }
                  />
                  <Text
                    className={cn(
                      'font-sans text-xs font-semibold',
                      (notificationSettings?.reminderChannel ?? 'app') === channel
                        ? 'text-accent dark:text-accent-dark'
                        : 'text-ink dark:text-ink-dark',
                    )}
                  >
                    {REMINDER_CHANNEL_LABELS[channel]}
                  </Text>
                </Pressable>
              ))}
            </View>
            {notificationSettings?.reminderChannel !== undefined &&
            notificationSettings.reminderChannel !== 'app' &&
            calendarPermission.permission === 'denied' ? (
              <Text className="mt-2 font-sans text-[11px] leading-relaxed text-danger dark:text-danger-dark">
                日历权限已被拒绝，提醒会退回应用内通知。请允许 Nextdo 访问日历后重新选择。
              </Text>
            ) : null}
          </View>

          {/* 5) 系统日历同步（issue #54）：仅原生平台提供；web 明确说明。 */}
          <View className="border-t border-border/40 pt-3 dark:border-border-dark/40">
            {calendarPermission.supported ? (
              <>
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-1 min-w-0 pr-2">
                    <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                      写入系统日历
                    </Text>
                    <Text className="mt-0.5 font-sans text-[11px] leading-tight text-muted dark:text-muted-dark">
                      把有明确起止时间的行动同步为系统日历事件，由系统原生提醒；关闭后会清理已经写入的事件。
                    </Text>
                  </View>
                  <View className="shrink-0">
                    <Switch
                      accessibilityLabel="写入系统日历"
                      value={notificationSettings?.calendarEnabled ?? false}
                      onValueChange={(val) => {
                        if (!val) {
                          void updateSettings({ calendarEnabled: false });
                          return;
                        }
                        void calendarPermission.requestAccess().then((next) => {
                          if (next === 'granted') {
                            void updateSettings({ calendarEnabled: true });
                          }
                        });
                      }}
                      trackColor={switchTrackColor}
                      thumbColor={switchThumbColor}
                      {...({ activeThumbColor: switchThumbColor } as object)}
                    />
                  </View>
                </View>

                {!notificationSettings?.calendarEnabled &&
                calendarPermission.permission === 'denied' ? (
                  <View className="mt-2.5 gap-2">
                    <Text className="font-sans text-[11px] leading-relaxed text-muted dark:text-muted-dark">
                      未获得日历权限。请在系统设置中允许 Nextdo 访问日历，然后重新开启。
                    </Text>
                    <Button
                      label="去系统设置开启日历"
                      variant="secondary"
                      onPress={() => void calendarPermission.openSystemSettings()}
                    />
                  </View>
                ) : null}
              </>
            ) : (
              <View className="flex-row items-start gap-3">
                <View className="h-8 w-8 rounded-lg bg-surface-container/60 dark:bg-surface-container-dark/60 items-center justify-center shrink-0">
                  <Ionicons name="calendar-outline" size={16} color={isDark ? colors.mutedDark : colors.muted} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                    系统日历同步
                  </Text>
                  <Text className="mt-0.5 font-sans text-[11px] leading-tight text-muted dark:text-muted-dark">
                    当前平台不支持系统日历，仍可使用应用内提醒。
                  </Text>
                </View>
              </View>
            )}
          </View>
        </Card>

        {/* Section 4: 数据与同步 */}
        <SectionHeader title="数据与同步" icon="cloud-outline" />
        <Card className="gap-3.5 p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
              云同步
            </Text>
          </View>
          {state === 'connected' ? (
            <View className="flex-row items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 dark:bg-accent-dark/20">
              <View className="h-2 w-2 rounded-full bg-accent dark:bg-accent-dark" />
              <Text className="font-sans text-[11px] font-semibold text-accent dark:text-accent-dark">
                已连接
              </Text>
            </View>
          ) : (
            <View className="flex-row items-center gap-1.5 rounded-full bg-surface-container px-2.5 py-0.5 dark:bg-surface-container-dark">
              <View className="h-2 w-2 rounded-full bg-muted dark:bg-muted-dark" />
              <Text className="font-sans text-[11px] font-medium text-muted dark:text-muted-dark">
                仅本地
              </Text>
            </View>
          )}
        </View>
        {state === 'loading' ? (
          <Text className="font-sans text-sm text-muted dark:text-muted-dark">
            检查中…
          </Text>
        ) : state === 'connected' ? (
          <View className="gap-3">
            {/* 同步状态 + 立即同步 + 上次同步时间（issue #22）。状态派生在
                lib/sync-status.ts（纯函数），句子留在屏幕。 */}
            <View className="gap-1.5">
              <Text
                className={cn(
                  'font-sans text-sm',
                  syncDisplay.kind === 'failed'
                    ? 'text-danger dark:text-danger-dark'
                    : 'text-muted dark:text-muted-dark',
                )}
              >
                {syncStatusLabel(syncDisplay)}
              </Text>
              {syncHint !== null ? (
                <Text className="font-sans text-xs leading-relaxed text-danger dark:text-danger-dark">
                  {syncHint}
                </Text>
              ) : null}
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                {lastSyncedLabel === null
                  ? '尚未完成过同步'
                  : `上次同步时间：${lastSyncedLabel}`}
              </Text>
              <View className="flex-row items-center gap-2 pt-1">
                <Button
                  label={syncDisplay.kind === 'syncing' ? '正在同步…' : '立即同步'}
                  variant="secondary"
                  disabled={syncDisplay.kind === 'syncing'}
                  onPress={() => {
                    void syncNow();
                  }}
                />
                {manualSync?.kind === 'ok' ? (
                  <Text className="font-sans text-xs text-accent dark:text-accent-dark">
                    ✓ 同步完成
                  </Text>
                ) : null}
              </View>
            </View>
            {/* The four questions users actually ask about sync (issue #15).
                Answered from the code's real behaviour, not a design doc —
                see docs/sync.md, which is the long version. */}
            <SyncExplainer
              open={showSyncHelp}
              onToggle={() => setShowSyncHelp((prev) => !prev)}
            />
            {storedConfig !== null ? (
              <View className="gap-1.5 rounded-xl border border-border/60 bg-surface-container/30 p-3 dark:border-border-dark/60 dark:bg-surface-container-dark/30">
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="server-outline" size={13} color={isDark ? colors.mutedDark : colors.muted} />
                  <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                    后端地址：{storedConfig.backendUrl}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="git-network-outline" size={13} color={isDark ? colors.mutedDark : colors.muted} />
                  <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                    同步流地址：{storedConfig.endpoint}
                  </Text>
                </View>
              </View>
            ) : null}
            {rejections.length > 0 && rejections[rejections.length - 1] ? (
              <View className="gap-1.5 rounded-lg border border-danger/30 bg-danger/10 p-3 dark:border-danger-dark/30 dark:bg-danger-dark/15">
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans text-xs font-semibold text-danger dark:text-danger-dark">
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
            <View className="pt-1 border-t border-border/40 dark:border-border-dark/40">
              <Button
                label="断开连接"
                variant="secondary"
                onPress={() => {
                  void disconnect();
                }}
              />
            </View>
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
              className="flex-row items-center justify-between rounded-xl border border-border/80 bg-surface-container/40 p-3.5 dark:border-border-dark/80 dark:bg-surface-container-dark/30 active:opacity-85"
            >
              <View className="flex-row items-center gap-3 flex-1 min-w-0 pr-2">
                <View className="h-8 w-8 rounded-lg bg-accent/10 dark:bg-accent-dark/15 items-center justify-center shrink-0">
                  <Ionicons name="book-outline" size={16} color={isDark ? colors.accentDark : colors.accent} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="font-sans text-xs font-semibold text-ink dark:text-ink-dark">
                    📖 查看 3 分钟零成本多端云同步教程 (飞书文档·纯网页) →
                  </Text>
                  <Text className="mt-0.5 font-sans text-[11px] text-muted dark:text-muted-dark leading-tight">
                    无需自备服务器，全流程在网页中点选即可搭建专属同步服务
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={14} color={isDark ? colors.mutedDark : colors.muted} />
            </Pressable>

            {/* 同步方式选择器 */}
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
                  'flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2.5 active:opacity-80',
                  syncMode === 'pair'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Ionicons
                  name="key-outline"
                  size={14}
                  color={
                    syncMode === 'pair'
                      ? isDark
                        ? colors.accentDark
                        : colors.accent
                      : isDark
                        ? colors.mutedDark
                        : colors.muted
                  }
                />
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
                  'flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2.5 active:opacity-80',
                  syncMode === 'self_host'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Ionicons
                  name="server-outline"
                  size={14}
                  color={syncMode === 'self_host' ? '#c85a17' : '#716b64'}
                />
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
                <FormField label="后端地址">
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
                </FormField>
                <FormField label="同步流地址">
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
                </FormField>
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

        {/* Section 4: 关于与更新 */}
        <SectionHeader title="关于与更新" icon="information-circle-outline" />
        <Card className="gap-3.5 p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2.5">
              <View className="h-8 w-8 rounded-lg bg-surface-container/60 dark:bg-surface-container-dark/60 items-center justify-center shrink-0">
                <Ionicons name="sparkles-outline" size={16} color={isDark ? '#9b948a' : '#716b64'} />
              </View>
              <View>
                <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                  应用更新
                </Text>
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                  当前版本 {update.currentVersion === '' ? '未知' : update.currentVersion}
                </Text>
              </View>
            </View>
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
                  'flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2.5 px-1 active:opacity-80',
                  update.preferredChannel === 'stable'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={14}
                  color={
                    update.preferredChannel === 'stable'
                      ? isDark
                        ? colors.accentDark
                        : colors.accent
                      : isDark
                        ? colors.mutedDark
                        : colors.muted
                  }
                />
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
                  'flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2.5 px-1 active:opacity-80',
                  update.preferredChannel === 'beta'
                    ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/20'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Ionicons
                  name="flask-outline"
                  size={14}
                  color={
                    update.preferredChannel === 'beta'
                      ? isDark
                        ? colors.accentDark
                        : colors.accent
                      : isDark
                        ? colors.mutedDark
                        : colors.muted
                  }
                />
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
            <View className="gap-0.5 flex-1 min-w-0 pr-3">
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
                'h-6 w-11 rounded-full p-0.5 justify-center shrink-0',
                update.autoCheckEnabled
                  ? 'bg-accent dark:bg-accent-dark'
                  : 'bg-surface-container dark:bg-surface-container-dark',
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
                  {/* 应用内下载进度条（桌面端及支持应用内安装的安卓端） */}
                  {(update.isDesktop || update.canInstallInApp) && update.download.kind === 'downloading' ? (
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
                  {(update.isDesktop || update.canInstallInApp) && update.download.kind === 'done' ? (
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
                        label={
                          update.isDesktop
                            ? update.installing
                              ? '正在安装并重启…'
                              : '立即安装并重启'
                            : update.installing
                              ? '正在打开安装程序…'
                              : '立即安装'
                        }
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
                  {(update.isDesktop || update.canInstallInApp) && update.download.kind === 'error' ? (
                    <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                      下载失败：{update.download.error}
                    </Text>
                  ) : null}
                  {/* 下载按钮：桌面端及安卓端走应用内下载，其他端走浏览器 */}
                  {update.download.kind !== 'downloading' && update.download.kind !== 'done'
                    ? update.outcome.downloads.map((dl) => (
                        <Button
                          key={dl.url}
                          label={
                            update.isDesktop || update.canInstallInApp
                              ? `下载并安装 ${dl.label}`
                              : `下载 ${dl.label}`
                          }
                          variant="secondary"
                          onPress={() => {
                            if (update.isDesktop || update.canInstallInApp) {
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
