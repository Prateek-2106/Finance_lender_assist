// Sends your local server exactly what Twilio sends for an inbound SMS,
// signed with TWILIO_AUTH_TOKEN, so the real code path runs without a phone.
//
//   npm run sms:simulate -- <tenantId> "Need a quote for a leaky water heater" [+17165550123]
//
// The server must run with the same TWILIO_AUTH_TOKEN and PUBLIC_URL.
import { computeTwilioSignature } from "../src/webhooks/twilio";

const [tenantId, body = "Need a quote for a leaky water heater", from = "+17165550123"] = process.argv.slice(2);
if (!tenantId) {
  console.error('usage: npm run sms:simulate -- <tenantId> "<message>" [fromPhone]');
  process.exit(1);
}

const port = process.env.PORT ?? "3000";
const token = process.env.TWILIO_AUTH_TOKEN;
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
if (!token) {
  console.error("Set TWILIO_AUTH_TOKEN (any value works locally, as long as the server uses the same one).");
  process.exit(1);
}

const path = `/webhooks/sms/${tenantId}`;
const params: Record<string, string> = {
  MessageSid: `SM${Date.now()}`,
  AccountSid: "ACsimulated",
  From: from,
  To: "+18005550100",
  Body: body,
  NumMedia: "0",
};
// Twilio signs the public URL it called, not localhost.
const signature = computeTwilioSignature(token, publicUrl + path, params);

const res = await fetch(`http://localhost:${port}${path}`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
  body: new URLSearchParams(params),
});
console.log(`${res.status} ${res.statusText}`);
console.log(await res.text());
