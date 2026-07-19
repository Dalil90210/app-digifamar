// Minimal Vonage SMS sender for delivery OTPs. Configured via function secrets:
//   VONAGE_API_KEY, VONAGE_API_SECRET, and optionally VONAGE_FROM (or VONAGE_SENDER_ID)
//
// When OTP_DEV_MODE=true and Vonage is not configured, sending is skipped and
// the result is flagged `simulated` so the OTP flow can be exercised end-to-end
// in staging without a live SMS gateway.
export type SmsResult = {
  sent: boolean;
  provider: string;
  ref?: string;
  simulated?: boolean;
};

const VONAGE_SMS_ENDPOINT = "https://rest.nexmo.com/sms/json";
const VONAGE_ACCOUNT_NUMBERS_ENDPOINT = "https://rest.nexmo.com/account/numbers";

function readEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value && value.length > 0 ? value : null;
}

async function resolveVonageFrom(
  apiKey: string,
  apiSecret: string,
): Promise<string> {
  const configuredFrom = readEnv("VONAGE_FROM") ?? readEnv("VONAGE_SENDER_ID");
  if (configuredFrom) return configuredFrom;

  // Fall back to a number that already exists on the Vonage account.
  const url = new URL(VONAGE_ACCOUNT_NUMBERS_ENDPOINT);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("api_secret", apiSecret);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Vonage sender lookup failed (${res.status}): ${detail}`);
  }

  const payload = await res.json() as {
    count?: number;
    numbers?: Array<{ msisdn?: string | null }>;
    "error-code"?: string;
    "error-code-label"?: string;
    "error-text"?: string;
  };

  const errorCode = payload["error-code"];
  if (errorCode && errorCode !== "200") {
    const detail = payload["error-text"] ?? payload["error-code-label"] ?? "Unknown error";
    throw new Error(`Vonage sender lookup failed (${errorCode}): ${detail}`);
  }

  const accountNumber = payload.numbers
    ?.map((n) => n.msisdn?.trim())
    .find((n): n is string => !!n && n.length > 0);
  if (accountNumber) return accountNumber;

  throw new Error(
    "No Vonage sender identity available. Set VONAGE_FROM to a purchased number or approved sender ID.",
  );
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const apiKey = readEnv("VONAGE_API_KEY");
  const apiSecret = readEnv("VONAGE_API_SECRET");
  const devMode = Deno.env.get("OTP_DEV_MODE") === "true";

  if (!apiKey || !apiSecret) {
    if (devMode) return { sent: false, provider: "none", simulated: true };
    throw new Error("SMS provider is not configured");
  }

  const from = await resolveVonageFrom(apiKey, apiSecret);

  const form = new URLSearchParams({
    api_key: apiKey,
    api_secret: apiSecret,
    to,
    from,
    text: body,
  });

  const res = await fetch(VONAGE_SMS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Vonage send failed (${res.status}): ${detail}`);
  }

  const payload = await res.json() as {
    "message-count"?: string;
    messages?: Array<{
      status?: string;
      "error-text"?: string;
      "message-id"?: string;
    }>;
  };

  const message = payload.messages?.[0];
  if (!message) {
    throw new Error("Vonage send failed: missing message response payload");
  }
  if ((message.status ?? "0") !== "0") {
    const detail = message["error-text"] ?? "Unknown error";
    throw new Error(`Vonage send failed (${message.status}): ${detail}`);
  }

  return { sent: true, provider: "vonage", ref: message["message-id"] };
}
