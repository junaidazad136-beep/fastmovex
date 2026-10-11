import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '@prisma/client';
import { Env } from '../../config/env';

export interface OutgoingMessage {
  to: string; // email address, E.164 phone, or device token
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** One class per channel provider. Add FCM/APNs/Infobip/etc. by implementing this. */
export abstract class ChannelSender {
  abstract readonly channel: NotificationChannel;
  abstract enabled(): boolean;
  abstract send(msg: OutgoingMessage): Promise<void>;
}

@Injectable()
export class EmailSender extends ChannelSender {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger('Email');
  constructor(private readonly config: ConfigService<Env, true>) { super(); }

  enabled() {
    const d = this.config.get('NOTIFY_EMAIL_DRIVER', { infer: true });
    return d === 'log' || (d === 'resend' && !!this.config.get('RESEND_API_KEY', { infer: true }));
  }

  async send(m: OutgoingMessage) {
    if (this.config.get('NOTIFY_EMAIL_DRIVER', { infer: true }) === 'log') {
      this.logger.log(`[dev] email to ${m.to}: ${m.title} — ${m.body}`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.get('RESEND_API_KEY', { infer: true })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.config.get('EMAIL_FROM', { infer: true }), to: [m.to], subject: m.title, text: m.body }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

@Injectable()
export class SmsSender extends ChannelSender {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger('SMS');
  constructor(private readonly config: ConfigService<Env, true>) { super(); }

  enabled() {
    const d = this.config.get('NOTIFY_SMS_DRIVER', { infer: true });
    return d === 'log' || (d === 'twilio' && !!this.config.get('TWILIO_ACCOUNT_SID', { infer: true }) && !!this.config.get('TWILIO_AUTH_TOKEN', { infer: true }));
  }

  async send(m: OutgoingMessage) {
    if (this.config.get('NOTIFY_SMS_DRIVER', { infer: true }) === 'log') {
      this.logger.log(`[dev] sms to ${m.to}: ${m.body}`);
      return;
    }
    const sid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true })!;
    const auth = Buffer.from(`${sid}:${this.config.get('TWILIO_AUTH_TOKEN', { infer: true })}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: m.to, From: this.config.get('TWILIO_FROM', { infer: true }) ?? '', Body: `FastMoveX: ${m.body}`.slice(0, 320) }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

@Injectable()
export class PushSender extends ChannelSender {
  readonly channel = 'PUSH' as const;
  private readonly logger = new Logger('Push');
  constructor(private readonly config: ConfigService<Env, true>) { super(); }
  enabled() { return this.config.get('NOTIFY_PUSH_DRIVER', { infer: true }) === 'log'; }
  async send(m: OutgoingMessage) {
    // FCM/APNs driver is added with the Flutter app (needs Firebase service-account credentials).
    this.logger.log(`[dev] push to ${m.to.slice(0, 12)}…: ${m.title} — ${m.body}`);
  }
}

/** What a WhatsApp notification carries: an approved template and its parameters, in order. */
export interface WhatsAppPayload { template: string; lang: 'en' | 'ar'; params: string[] }

/**
 * WhatsApp Business Cloud API. Messages a business starts must use templates approved in WhatsApp Manager
 * (names and texts in DEPLOYMENT.md); they go only to customers who opted in.
 */
@Injectable()
export class WhatsAppSender extends ChannelSender {
  readonly channel = 'WHATSAPP' as const;
  private readonly logger = new Logger('WhatsApp');
  constructor(private readonly config: ConfigService<Env, true>) { super(); }

  enabled() {
    const d = this.config.get('WHATSAPP_DRIVER', { infer: true });
    return d === 'log' || (d === 'cloud' && !!this.config.get('WHATSAPP_TOKEN', { infer: true }) && !!this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true }));
  }

  async send(m: OutgoingMessage) {
    const wa = (m.data as { whatsapp?: WhatsAppPayload } | undefined)?.whatsapp;
    if (!wa?.template) throw new Error('No WhatsApp template for this message');
    const to = m.to.replace(/[^\d]/g, ''); // Cloud API wants digits only: 97455555555
    if (!/^\d{8,15}$/.test(to)) throw new Error('Not a valid WhatsApp number');
    // Template parameters may not be empty or contain new lines / 4+ spaces (Cloud API rule)
    const params = wa.params.map((p) => (String(p ?? '').replace(/\s+/g, ' ').trim() || '-').slice(0, 1000));
    if (this.config.get('WHATSAPP_DRIVER', { infer: true }) === 'log') {
      this.logger.log(`[dev] whatsapp to ${to}: ${wa.template}/${wa.lang} ${JSON.stringify(params)}`);
      return;
    }
    const base = String(this.config.get('WHATSAPP_API_URL', { infer: true })).replace(/\/+$/, '');
    const res = await fetch(`${base}/${this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true })}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.get('WHATSAPP_TOKEN', { infer: true })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: wa.template, language: { code: wa.lang }, components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [] },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const e = (await res.json()) as { error?: { message?: string; code?: number } };
        if (e.error) detail = `${e.error.code ?? res.status}: ${e.error.message ?? ''}`;
      } catch { /* not JSON */ }
      throw new Error(`WhatsApp ${detail}`.slice(0, 300));
    }
  }
}
