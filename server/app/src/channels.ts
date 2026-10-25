/**
 * External reminder channel adapters (design.md "通道适配器").
 *
 * An adapter turns one due reminder into exactly one HTTP request
 * (url + init). The dispatcher (reminder-dispatcher.ts) performs the send
 * and owns dedupe and retry, so an adapter stays a pure function of its
 * inputs — no network, no clock of its own, no database — and is
 * unit-testable directly.
 *
 * Credentials come from the deployment environment only. They are never
 * logged and never stored in Postgres (design.md "凭证 = 服务端 secret").
 *
 * Capabilities below come from each vendor's own documentation:
 *   - Feishu custom bot: POST https://open.feishu.cn/open-apis/bot/v2/hook/<key>,
 *     JSON body under 20 KB; optional signature where the signed string is
 *     EMPTY and the HMAC key is `<timestamp>\n<secret>`.
 *   - Server 酱 Turbo: POST https://sctapi.ftqq.com/<SendKey>.send,
 *     form-encoded `title` + `desp`.
 *   - PushPlus: POST https://www.pushplus.plus/send, JSON `token` + `title` +
 *     `content` + `template`. It answers HTTP 200 even for a rejected push and
 *     reports the real outcome in the body's `code` (200 = accepted), which is
 *     why adapters may carry their own `verify`.
 */
export interface DueReminder {
  id: string;
  actionKind: string;
  actionId: string;
  /** ISO-8601 UTC instant the reminder is due. */
  firesAt: string;
  intensity: string;
  /** The action's title; orphan reminders are filtered out before delivery. */
  title: string;
}

export interface ChannelRequest {
  url: string;
  init: RequestInit;
}

export interface ReminderChannel {
  readonly kind: 'feishu' | 'serverchan' | 'pushplus';
  buildRequest(reminder: DueReminder, now: Date): Promise<ChannelRequest>;
  /**
   * Optional extra acceptance check for vendors that report failure inside a
   * 2xx body. Return an error message to mark the delivery failed, or null to
   * accept it. The dispatcher owns retry and recording either way.
   */
  verify?(response: Response): Promise<string | null>;
}

export interface ChannelEnv {
  NEXTDO_FEISHU_WEBHOOK?: string;
  NEXTDO_FEISHU_SECRET?: string;
  NEXTDO_SERVERCHAN_SENDKEY?: string;
  NEXTDO_PUSHPLUS_TOKEN?: string;
  NEXTDO_TIME_ZONE?: string;
}

/**
 * Render one reminder for a chat client: a short title plus the local due
 * time. Pure and locale-stable — callers pass an explicit time zone, so
 * tests never depend on the machine's own zone.
 */
export function renderReminder(
  reminder: DueReminder,
  timeZone: string,
): { title: string; body: string } {
  return {
    title: `⏰ ${reminder.title}`,
    body: `到点时间：${formatLocalTime(reminder.firesAt, timeZone)}`,
  };
}

/**
 * Time zone used when `NEXTDO_TIME_ZONE` is unset. Nextdo is built for a
 * zh-CN audience, so a deployment that forgets the variable still renders
 * reminder times in Beijing time instead of silently showing UTC.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

/**
 * Format an ISO instant in `timeZone`; falls back to the default zone when
 * the configured one is missing or not a valid IANA name (a bad configuration
 * value must not break delivery).
 */
function formatLocalTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  for (const zone of [timeZone, DEFAULT_TIME_ZONE, 'UTC']) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: zone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch {
      // Invalid zone — try the next candidate.
    }
  }
  return iso;
}

/**
 * The HMAC-SHA256 signature a Feishu custom bot verifies when the bot is
 * configured with secret-based security. The string to sign is EMPTY and
 * the key is `<timestamp>\n<secret>` (Feishu's documented scheme).
 */
export async function feishuSignature(timestamp: number, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${timestamp}\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new Uint8Array(0));
  return Buffer.from(signature).toString('base64');
}

/**
 * Feishu custom bot channel. The webhook URL is used verbatim — the
 * operator configures the full URL, so no path shape is assumed here.
 */
function createFeishuChannel(
  webhookUrl: string,
  secret: string | null,
  timeZone: string,
): ReminderChannel {
  return {
    kind: 'feishu',
    async buildRequest(reminder, now) {
      const rendered = renderReminder(reminder, timeZone);
      const payload: Record<string, unknown> = {
        msg_type: 'text',
        content: { text: `${rendered.title}\n${rendered.body}` },
      };

      if (secret !== null) {
        const timestamp = Math.floor(now.getTime() / 1000);
        payload.timestamp = String(timestamp);
        payload.sign = await feishuSignature(timestamp, secret);
      }

      return {
        url: webhookUrl,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      };
    },
  };
}

/**
 * Server 酱 Turbo channel — the personal-WeChat relay. The SendKey is a
 * path segment; the title is capped because the vendor truncates an
 * over-long one itself and a bounded title keeps the push readable.
 */
function createServerChanChannel(sendKey: string, timeZone: string): ReminderChannel {
  return {
    kind: 'serverchan',
    async buildRequest(reminder) {
      const rendered = renderReminder(reminder, timeZone);
      const body = new URLSearchParams();
      body.set('title', rendered.title.slice(0, 32));
      body.set('desp', rendered.body);

      return {
        url: `https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        },
      };
    },
  };
}

/**
 * PushPlus channel — the personal-WeChat relay with a larger free quota than
 * Server 酱 (200 WeChat pushes/day for a verified free account, 5 requests per
 * minute). `template: 'txt'` keeps the reminder text verbatim instead of
 * letting the default HTML template reflow it.
 *
 * PushPlus accepts `token` either in the JSON body or as a path segment; the
 * body form is used here so the credential never lands in a URL that a proxy
 * log might record.
 */
function createPushPlusChannel(token: string, timeZone: string): ReminderChannel {
  return {
    kind: 'pushplus',
    async buildRequest(reminder) {
      const rendered = renderReminder(reminder, timeZone);

      return {
        url: 'https://www.pushplus.plus/send',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token,
            title: rendered.title.slice(0, 100),
            content: rendered.body,
            template: 'txt',
          }),
        },
      };
    },
    async verify(response) {
      // HTTP 200 only means "request received"; the real outcome is `code`.
      const payload = (await response.json().catch(() => null)) as { code?: unknown } | null;
      if (payload?.code === 200) {
        return null;
      }
      return `pushplus rejected the message (code=${String(payload?.code ?? 'unreadable')})`;
    },
  };
}

/**
 * Build the channel list for this deployment. A channel whose credential is
 * unset is omitted entirely, so "no external reminders configured" and
 * "configured but mis-spelled" stay distinguishable in the cron logs.
 */
export function createChannels(env: ChannelEnv): ReminderChannel[] {
  const timeZone = env.NEXTDO_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
  const channels: ReminderChannel[] = [];

  const feishuWebhook = env.NEXTDO_FEISHU_WEBHOOK?.trim();
  if (feishuWebhook) {
    const secret = env.NEXTDO_FEISHU_SECRET?.trim() || null;
    channels.push(createFeishuChannel(feishuWebhook, secret, timeZone));
  }

  const sendKey = env.NEXTDO_SERVERCHAN_SENDKEY?.trim();
  if (sendKey) {
    channels.push(createServerChanChannel(sendKey, timeZone));
  }

  const pushPlusToken = env.NEXTDO_PUSHPLUS_TOKEN?.trim();
  if (pushPlusToken) {
    channels.push(createPushPlusChannel(pushPlusToken, timeZone));
  }

  return channels;
}
