// Send a test alert to ALERT_WEBHOOK_URL.   npm run alert:test
import { makeWebhookSender, makeEmailSender, sendToAll } from '../lib/alerts.mjs';

const senders = [];
try {
  if (process.env.ALERT_WEBHOOK_URL) senders.push(makeWebhookSender(process.env.ALERT_WEBHOOK_URL));
  if (process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO) senders.push(makeEmailSender({ apiKey: process.env.RESEND_API_KEY, from: process.env.ALERT_EMAIL_FROM || 'alerts@facyke.com', to: process.env.ALERT_EMAIL_TO }));
  if (!senders.length) { console.error('Neither ALERT_WEBHOOK_URL nor RESEND_API_KEY + ALERT_EMAIL_TO is set. Set them in the environment of the console (see README, "Alerts").'); process.exit(1); }
  const send = sendToAll(senders);
  const ok = await send('ProjectsDashboard: test alert', 'If you can read this, alerts reach you.');
  console.log(ok ? `Test alert sent via ${send.host}.` : `No channel (${send.host}) accepted the message (check the URL, key and addresses).`);
  process.exitCode = ok ? 0 : 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
