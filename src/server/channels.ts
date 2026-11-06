// Delivery adapters for the conversational agent. Each one runs for real when its credentials are set,
// and in simulation mode otherwise (the message is logged to the loan file but not sent).
import nodemailer from 'nodemailer';
import type { Channel } from '@/db/schema';

export interface SendResult { ok: boolean; provider: string; providerRef?: string; error?: string; simulated: boolean }

export const channelStatus = () => ({
  WHATSAPP: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  EMAIL: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  SMS: Boolean(process.env.SMS_WEBHOOK_URL),
  VOICE: Boolean(process.env.VOICE_PROVIDER_URL),
  APP: true,
});

const digits = (p: string) => p.replace(/\D/g, '').replace(/^0+/, '');
const e164 = (p: string) => { const d = digits(p); return d.length === 10 ? `91${d}` : d; };

export async function send(channel: Channel, to: { phone: string; email?: string | null; name: string }, msg: { text: string; subject?: string; language: string; callbackRef: string }): Promise<SendResult> {
  const live = channelStatus()[channel];
  if (!live) return { ok: true, provider: 'simulate', simulated: true };
  try {
    switch (channel) {
      case 'WHATSAPP': {
        // Business-initiated messages must use a template approved in WhatsApp Manager; inside the 24-hour
        // customer window a free-text message is allowed. We send text here and fall back to SMS on failure.
        const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: e164(to.phone), type: 'text', text: { body: msg.text } }),
        });
        const j = await r.json();
        if (!r.ok) return { ok: false, provider: 'whatsapp_cloud', error: j?.error?.message ?? r.statusText, simulated: false };
        return { ok: true, provider: 'whatsapp_cloud', providerRef: j?.messages?.[0]?.id, simulated: false };
      }
      case 'EMAIL': {
        if (!to.email) return { ok: false, provider: 'smtp', error: 'No email on file', simulated: false };
        const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
        const info = await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: to.email, subject: msg.subject || 'Your loan', text: msg.text, headers: { 'X-FinX-Ref': msg.callbackRef } });
        return { ok: true, provider: 'smtp', providerRef: info.messageId, simulated: false };
      }
      case 'SMS': {
        const r = await fetch(process.env.SMS_WEBHOOK_URL!, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_API_KEY ?? ''}` }, body: JSON.stringify({ to: e164(to.phone), text: msg.text, ref: msg.callbackRef }) });
        return { ok: r.ok, provider: 'sms_http', providerRef: r.headers.get('x-request-id') ?? undefined, error: r.ok ? undefined : await r.text(), simulated: false };
      }
      case 'APP':
        return { ok: true, provider: 'app', simulated: false };
      case 'VOICE': {
        // Hand the approved script to the voice-agent provider. It calls back /api/webhooks/voice with the
        // transcript and outcome, which are attached to the loan.
        const r = await fetch(process.env.VOICE_PROVIDER_URL!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VOICE_PROVIDER_KEY ?? ''}` },
          body: JSON.stringify({ to: `+${e164(to.phone)}`, name: to.name, language: msg.language, script: msg.text, ref: msg.callbackRef, callback_url: `${process.env.APP_URL}/api/webhooks/voice` }),
        });
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, provider: 'voice_http', providerRef: j?.id ?? j?.call_id, error: r.ok ? undefined : JSON.stringify(j), simulated: false };
      }
    }
  } catch (e) {
    return { ok: false, provider: channel.toLowerCase(), error: (e as Error).message, simulated: false };
  }
}
