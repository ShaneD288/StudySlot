import { describe, expect, it } from "vitest";
import { fromBase64url, linkId, openLegacyToken, openToken, sealToken, toBase64url } from "../src/share.js";
import { LEGACY_LINKS_UNTIL, parseFriendLink, toB64url } from "../public/lib/share-links.js";

const KEY = "test-key-0123456789-0123456789-0123456789";
const OTHER_KEY = "another-key-0123456789-0123456789-01234567";
const settings = {
  l: "https://timetable.example.ie/ical/abc123.ics",
  g: { Networks: "A" },
  h: ["Cloud"],
  z: "Europe/Dublin",
  n: "Alex",
};

// Flips one bit of the byte at `index` in a token.
const flip = (token, index) => {
  const bytes = fromBase64url(token);
  bytes[index] ^= 1;
  return toBase64url(bytes);
};

describe("sealToken / openToken", () => {
  it("round-trips the settings", async () => {
    const token = await sealToken(settings, KEY);
    expect(await openToken(token, KEY)).toEqual(settings);
  });

  it("makes URL-safe tokens that don't contain the link", async () => {
    const token = await sealToken(settings, KEY);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("timetable");
    expect(new TextDecoder().decode(fromBase64url(token))).not.toContain("timetable.example.ie");
  });

  it("starts with version byte 1 and a 12-byte IV", async () => {
    const bytes = fromBase64url(await sealToken(settings, KEY));
    expect(bytes[0]).toBe(1);
    // version + IV + JSON + 16-byte tag
    expect(bytes.length).toBe(1 + 12 + JSON.stringify(settings).length + 16);
  });

  it("uses a fresh IV, so sharing the same settings twice gives different tokens", async () => {
    const [a, b] = await Promise.all([sealToken(settings, KEY), sealToken(settings, KEY)]);
    expect(a).not.toBe(b);
    expect(await openToken(b, KEY)).toEqual(settings);
  });

  it.each([
    ["the version byte", 0],
    ["the IV", 5],
    ["the ciphertext", 20],
    ["the authentication tag", -1],
  ])("rejects a token with a changed bit in %s", async (_, index) => {
    const token = await sealToken(settings, KEY);
    const length = fromBase64url(token).length;
    expect(await openToken(flip(token, (index + length) % length), KEY)).toBeNull();
  });

  it("rejects a token made with another key", async () => {
    expect(await openToken(await sealToken(settings, OTHER_KEY), KEY)).toBeNull();
  });

  it("rejects truncated tokens, garbage and old base64 tokens", async () => {
    const token = await sealToken(settings, KEY);
    expect(await openToken(token.slice(0, 30), KEY)).toBeNull();
    expect(await openToken(token.slice(0, -4), KEY)).toBeNull();
    expect(await openToken("", KEY)).toBeNull();
    expect(await openToken("not a token!", KEY)).toBeNull();
    expect(await openToken(toB64url(JSON.stringify(settings)), KEY)).toBeNull();
  });

  it("refuses to work without a proper key", async () => {
    await expect(sealToken(settings, undefined)).rejects.toThrow(/SHARE_KEY/);
    await expect(sealToken(settings, "short")).rejects.toThrow(/at least 32/);
  });
});

describe("openLegacyToken", () => {
  it("reads old base64url tokens", () => {
    expect(openLegacyToken(toB64url(JSON.stringify(settings)))).toEqual(settings);
  });

  it("returns null for anything else", async () => {
    expect(openLegacyToken("not-base64-json")).toBeNull();
    expect(openLegacyToken(toB64url("123"))).toBeNull();
    expect(openLegacyToken(await sealToken(settings, KEY))).toBeNull();
  });
});

describe("linkId", () => {
  it("is the same for the same link and key, and doesn't contain the link", async () => {
    const id = await linkId(settings.l, KEY);
    expect(id).toMatch(/^f[A-Za-z0-9_-]{16}$/);
    expect(await linkId(settings.l, KEY)).toBe(id);
  });

  it("differs for another link or another key", async () => {
    const id = await linkId(settings.l, KEY);
    expect(await linkId(settings.l + "?x", KEY)).not.toBe(id);
    expect(await linkId(settings.l, OTHER_KEY)).not.toBe(id);
  });
});

describe("parseFriendLink (in the app)", () => {
  const BEFORE = Date.parse("2026-10-01T00:00:00Z");
  const legacy = toB64url(JSON.stringify(settings));

  it("recognises an encrypted friend link, in a URL or on its own", async () => {
    const token = await sealToken(settings, KEY);
    expect(parseFriendLink(`https://studyslot.ie/?friend=${token}`, BEFORE)).toEqual({ token });
    expect(parseFriendLink(`  ${token}  `, BEFORE)).toEqual({ token });
    expect(parseFriendLink(`https://studyslot.ie/#friend=${token}`, BEFORE)).toEqual({ token });
  });

  it("still reads an older link until the cut-off date", () => {
    expect(parseFriendLink(`https://studyslot.ie/?friend=${legacy}`, BEFORE)).toEqual({
      token: legacy,
      legacy: settings,
    });
  });

  it("marks an older link as expired after the cut-off date", () => {
    expect(parseFriendLink(`/?friend=${legacy}`, LEGACY_LINKS_UNTIL)).toEqual({ token: legacy, expired: true });
  });

  it("returns null for things that aren't friend links", () => {
    expect(parseFriendLink("https://studyslot.ie/", BEFORE)).toBeNull();
    expect(parseFriendLink("hello", BEFORE)).toBeNull();
    expect(parseFriendLink(`/?friend=${toB64url(JSON.stringify({ n: "No link" }))}`, BEFORE)).toBeNull();
    expect(parseFriendLink("/?friend=@@@", BEFORE)).toBeNull();
  });
});
