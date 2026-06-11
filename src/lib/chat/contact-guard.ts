/**
 * Contact-information guard — enforces DiGiFaMaR's Critical Rule:
 *
 *   Buyers and Farmers must NEVER see each other's personal contact
 *   information. All communication must stay inside the in-app chat so that
 *   escrow protection, trust, and platform revenue are preserved.
 *
 * This module is a PURE detector (no DOM, no network) so it can run in three
 * places for defense-in-depth:
 *   1. the realtime chat composer (client) — block + warn before send,
 *   2. the demo/localStorage chat composer (client),
 *   3. the `ChatService.send` server function — reject on the wire.
 *
 * The intent of the spec is privacy, so detection deliberately errs toward
 * catching contact-sharing attempts (phone, email, messaging apps, social
 * handles, external links, and "let's talk off the app" phrasing). The test
 * suite documents the false-positive boundaries (prices, quantities, zip
 * codes, order ids and normal price negotiation must NOT be blocked).
 */

export type ContactCategory =
  | "phone"
  | "email"
  | "messaging-app"
  | "social-handle"
  | "external-link"
  | "off-platform";

export interface ContactScanResult {
  /** True when at least one contact-sharing attempt was detected. */
  hasContactInfo: boolean;
  /** Distinct categories detected, in a stable order. */
  categories: ContactCategory[];
  /**
   * The message with every offending span masked by block characters.
   * Intended for moderation previews/logs — per spec the message itself is
   * hidden (never delivered), not redacted-and-sent.
   */
  redacted: string;
}

/** User-facing warning shown when a message is blocked. */
export const CONTACT_BLOCK_WARNING =
  "For your safety, personal contact details can't be shared in chat. " +
  "Keep all messages, offers, and files on DiGiFaMaR so escrow protection applies.";

const CATEGORY_LABEL: Record<ContactCategory, string> = {
  phone: "phone number",
  email: "email address",
  "messaging-app": "messaging app",
  "social-handle": "social handle",
  "external-link": "website link",
  "off-platform": "request to move off-platform",
};

/**
 * Detectors run in order. Earlier, more specific patterns (email) mask their
 * spans before later, broader patterns (bare domains, phone runs) see them, so
 * an email isn't double-counted as a link or a phone number.
 *
 * NOTE: commas are intentionally NOT treated as phone separators, so grouped
 * numbers like prices ("$4,250") and quantities ("1,000 bushels") split into
 * short runs and are never mistaken for a phone number.
 */
const DETECTORS: ReadonlyArray<{ category: ContactCategory; pattern: RegExp }> = [
  // ── Email ──────────────────────────────────────────────────────────────
  // Plain address: name@host.tld
  {
    category: "email",
    pattern: /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi,
  },
  // Obfuscated: "name at gmail dot com", "name (at) yahoo [dot] com"
  {
    category: "email",
    pattern:
      /[a-z0-9._%+\-]+\s*(?:\(at\)|\[at\]|\bat\b)\s*[a-z0-9.\-]+\s*(?:\(dot\)|\[dot\]|\bdot\b)\s*(?:com|net|org|edu|io|co|info|biz|gmail|yahoo|outlook|hotmail|icloud|proton)\b/gi,
  },

  // ── Off-platform phrasing ──────────────────────────────────────────────
  // "call/text/email me", "my number/cell/phone/email is", "hit me up",
  // "let's take this off the app / outside the platform".
  {
    category: "off-platform",
    pattern:
      /\b(?:call|text|sms|phone|email|e-mail|reach|contact|message|dm)\s+me\b/gi,
  },
  {
    category: "off-platform",
    pattern:
      /\bmy\s+(?:number|cell|cell\s*phone|phone|mobile|email|e-mail|whats\s*app|line)\b/gi,
  },
  {
    category: "off-platform",
    pattern: /\b(?:off|outside)\s+(?:of\s+)?(?:the\s+)?(?:app|platform|site)\b/gi,
  },
  { category: "off-platform", pattern: /\bhit\s+me\s+up\b/gi },

  // ── Messaging apps ─────────────────────────────────────────────────────
  {
    category: "messaging-app",
    pattern:
      /\b(?:whats\s*app|telegram|signal|viber|we\s*chat|\bkik\b|skype|imessage|messenger)\b/gi,
  },

  // ── Social handles / platforms ─────────────────────────────────────────
  {
    category: "social-handle",
    pattern:
      /\b(?:instagram|insta|\big\b|facebook|\bfb\b|snapchat|snap\s*chat|\bsnap\b|tiktok|twitter|\bx\.com\b|\bdm\b)\b/gi,
  },
  // @handle (not an email local-part — emails are masked already above).
  {
    category: "social-handle",
    pattern: /(?<![a-z0-9_.])@[a-z0-9._]{2,30}\b/gi,
  },

  // ── External links ─────────────────────────────────────────────────────
  { category: "external-link", pattern: /(?:https?:\/\/|www\.)\S+/gi },
  // Bare domain like "myfarm.com" or "shop.example.io/page".
  {
    category: "external-link",
    pattern:
      /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|co|me|app|info|biz|xyz|link|shop|store|site|online|gg|to)\b(?:\/\S*)?/gi,
  },

  // ── Phone numbers ──────────────────────────────────────────────────────
  // US 10-digit with optional +1 and ()/space/dot/dash separators.
  {
    category: "phone",
    pattern: /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)/g,
  },
  // International: a leading + followed by 9+ digits/separators.
  { category: "phone", pattern: /\+\d(?:[\s.\-]?\d){8,}/g },
  // Local 7-digit "361-9136" style (requires a separator to stay specific).
  { category: "phone", pattern: /\b\d{3}[\s.\-]\d{4}\b/g },
  // A bare run of 10+ digits joined only by dots/dashes (not commas/spaces),
  // e.g. "6673619136" or "667-361-9136" written without area-code grouping.
  { category: "phone", pattern: /\b\d[\d.\-]{8,}\d\b/g },
];

const MASK_CHAR = "█";

/** Scan a message for any embedded contact information. */
export function scanForContactInfo(input: string): ContactScanResult {
  const text = input ?? "";
  let redacted = text;
  const categories = new Set<ContactCategory>();

  for (const { category, pattern } of DETECTORS) {
    // Reset stateful global regexes before each use.
    pattern.lastIndex = 0;
    const next = redacted.replace(pattern, (match) => {
      // Preserve trailing whitespace the broad patterns may have swallowed.
      const trimmed = match.trimEnd();
      const tail = match.slice(trimmed.length);
      return MASK_CHAR.repeat(Math.min(Math.max(trimmed.length, 1), 12)) + tail;
    });
    if (next !== redacted) {
      categories.add(category);
      redacted = next;
    }
  }

  // Stable category ordering for predictable UI/test output.
  const order: ContactCategory[] = [
    "phone",
    "email",
    "messaging-app",
    "social-handle",
    "external-link",
    "off-platform",
  ];
  const ordered = order.filter((c) => categories.has(c));

  return {
    hasContactInfo: ordered.length > 0,
    categories: ordered,
    redacted,
  };
}

/** Convenience: just the boolean verdict. */
export function containsContactInfo(input: string): boolean {
  return scanForContactInfo(input).hasContactInfo;
}

/**
 * Human-readable list of what was detected, e.g.
 * "phone number and email address". Used in the warning toast.
 */
export function describeCategories(categories: ContactCategory[]): string {
  const labels = categories.map((c) => CATEGORY_LABEL[c]);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
