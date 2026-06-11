import { describe, expect, it } from "vitest";
import {
  containsContactInfo,
  describeCategories,
  scanForContactInfo,
  type ContactCategory,
} from "./contact-guard";

const cats = (s: string): ContactCategory[] => scanForContactInfo(s).categories;

describe("scanForContactInfo — blocks contact sharing", () => {
  describe("phone numbers", () => {
    it.each([
      "Call me at (667) 361-9136",
      "my cell is 667-361-9136",
      "reach me 667.361.9136",
      "+1 667 361 9136",
      "667 361 9136",
      "6673619136",
      "number: 361-9136",
      "+44 7911 123456",
    ])("flags %j", (msg) => {
      expect(cats(msg)).toContain("phone");
    });
  });

  describe("email addresses", () => {
    it.each([
      "email me at john.farmer@gmail.com",
      "JANE_DOE@yahoo.co.uk please",
      "reach john at gmail dot com",
      "jane (at) yahoo (dot) com",
    ])("flags %j", (msg) => {
      expect(cats(msg)).toContain("email");
    });
  });

  describe("messaging apps", () => {
    it.each([
      "let's move to WhatsApp",
      "I'm on Telegram",
      "add me on signal",
      "find me on WeChat",
    ])("flags %j", (msg) => {
      expect(cats(msg)).toContain("messaging-app");
    });
  });

  describe("social handles", () => {
    it.each([
      "follow me on Instagram",
      "I'm @green_acres_farm",
      "check my IG",
      "find us on facebook",
    ])("flags %j", (msg) => {
      expect(cats(msg)).toContain("social-handle");
    });
  });

  describe("external links", () => {
    it.each([
      "see https://myfarm.com/deals",
      "visit www.greenacres.shop",
      "order at greenacres.store/corn",
    ])("flags %j", (msg) => {
      expect(cats(msg)).toContain("external-link");
    });
  });

  describe("off-platform phrasing", () => {
    it.each([
      "call me directly",
      "text me when ready",
      "my number is below",
      "let's take this off the app",
      "talk outside the platform",
      "hit me up later",
    ])("flags %j", (msg) => {
      expect(cats(msg)).toContain("off-platform");
    });
  });

  it("detects multiple categories in one message", () => {
    const result = scanForContactInfo(
      "Call me 667-361-9136 or email farmer@gmail.com, I'm also on WhatsApp",
    );
    expect(result.hasContactInfo).toBe(true);
    expect(result.categories).toEqual(
      expect.arrayContaining(["phone", "email", "messaging-app"]),
    );
  });

  it("masks the offending span in the redacted output", () => {
    const { redacted } = scanForContactInfo("ping me at john@gmail.com today");
    expect(redacted).not.toContain("john@gmail.com");
    expect(redacted).toContain("█");
    expect(redacted).toContain("today");
  });
});

describe("scanForContactInfo — allows legitimate marketplace messages", () => {
  it.each([
    "I'll take 500 bushels for $4,250",
    "Can you do 2,000 lbs of corn?",
    "Final price $8,800 for 10 tons",
    "Ship to zip 75001 please",
    "Order #DFM-A1B2C3 is ready",
    "Deal — let's lock it in",
    "Is this freshly harvested this morning?",
    "I can do $4.50 per pound for 100 head of cattle",
    "Delivery within 25 miles works for me",
    "50 dozen eggs at $3.25 each",
  ])("does not flag %j", (msg) => {
    expect(containsContactInfo(msg)).toBe(false);
  });

  it("leaves a clean message unchanged in redacted form", () => {
    const msg = "I'll take 500 bushels for $4,250 — deal?";
    expect(scanForContactInfo(msg).redacted).toBe(msg);
  });
});

describe("describeCategories", () => {
  it("formats one, two, and three categories", () => {
    expect(describeCategories(["phone"])).toBe("phone number");
    expect(describeCategories(["phone", "email"])).toBe(
      "phone number and email address",
    );
    expect(describeCategories(["phone", "email", "messaging-app"])).toBe(
      "phone number, email address, and messaging app",
    );
  });

  it("returns empty string for no categories", () => {
    expect(describeCategories([])).toBe("");
  });
});
