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
  readonly kind: 'feishu' | 'serverchan';
  buildRequest(reminder: DueReminder, now: Date): Promise<ChannelRequest>;
}

export interface ChannelEnv {
  NEXTDO_FEISHU_WEBHOOK?: string;
  NEXTDO_FEISHU_SECRET?: string;
  NEXTDO_SERVERCHAN_SENDKEY?: string;
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
 * Format an ISO instant in `timeZone`; falls back to UTC when the zone is
 * missing or not a valid IANA name (a bad configuration value must not
 * break delivery).
 */
function formatLocalTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  for (const zone of [timeZone, 'UTC']) {
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
 * Build the channel list for this deployment. A channel whose credential is
 * unset is omitted entirely, so "no external reminders configured" and
 * "configured but mis-spelled" stay distinguishable in the cron logs.
 */
export function createChannels(env: ChannelEnv): ReminderChannel[] {
  const timeZone = env.NEXTDO_TIME_ZONE?.trim() || 'UTC';
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

  return channels;
}
