// Minimal Twilio SMS sender for delivery OTPs. Configured via function secrets:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//
// When OTP_DEV_MODE=true and Twilio is not configured, sending is skipped and
// the result is flagged `simulated` so the OTP flow can be exercised end-to-end
// in staging without a live SMS gateway.
export type SmsResult = {
  sent: boolean;
  provider: string;
  ref?: string;
  simulated?: boolean;
};

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  const devMode = Deno.env.get("OTP_DEV_MODE") === "true";

  if (!sid || !token || !from) {
    if (devMode) return { sent: false, provider: "none", simulated: true };
    throw new Error("SMS provider is not configured");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Twilio send failed (${res.status}): ${detail}`);
  }
  const payload = await res.json();
  return { sent: true, provider: "twilio", ref: payload.sid };
}
