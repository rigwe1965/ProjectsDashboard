// Send a test alert to ALERT_WEBHOOK_URL.   npm run alert:test
import { makeWebhookSender } from '../lib/alerts.mjs';

if (!process.env.ALERT_WEBHOOK_URL) { console.error('ALERT_WEBHOOK_URL is not set. Set it in the console\'s environment (see README, "Alerts").'); process.exit(1); }
try {
  const send = makeWebhookSender(process.env.ALERT_WEBHOOK_URL);
  const ok = await send('ProjectsDashboard: test alert', 'If you can read this, alerts reach you.');
  console.log(ok ? `Test alert sent to ${send.host}.` : `The service at ${send.host} did not accept the message (check the URL).`);
  process.exitCode = ok ? 0 : 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
