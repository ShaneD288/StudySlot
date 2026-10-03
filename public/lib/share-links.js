// Reading Studyslot friend links ("…/?friend=<token>"). New tokens are encrypted by the server
// (src/share.js) and only it can open them. Older tokens were the friend's settings in plain
// base64url; they're still accepted until LEGACY_LINKS_UNTIL so friends have time to share again.

export const LEGACY_LINKS_UNTIL = Date.parse("2027-02-01T00:00:00Z");
const TOKEN_VERSION = 1; // first byte of an encrypted token

export const toB64url = (text) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const b64urlBytes = (token) => {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

/**
 * A friend link (or a bare token) ->
 *   { token }                  an encrypted link
 *   { token, legacy }          an older link; `legacy` is the friend's settings { l, g, h, n }
 *   { token, expired: true }   an older link after LEGACY_LINKS_UNTIL
 *   null                       not a Studyslot friend link
 */
export function parseFriendLink(text, now = Date.now()) {
  const m =
    String(text).match(/[?&#]friend=([A-Za-z0-9_-]+)/) ||
    String(text)
      .trim()
      .match(/^([A-Za-z0-9_-]{24,})$/);
  if (!m) return null;
  const token = m[1];
  let bytes;
  try {
    bytes = b64urlBytes(token);
  } catch {
    return null;
  }
  if (bytes[0] === TOKEN_VERSION) return { token };
  try {
    const legacy = JSON.parse(new TextDecoder().decode(bytes));
    if (!legacy?.l) return null;
    return now < LEGACY_LINKS_UNTIL ? { token, legacy } : { token, expired: true };
  } catch {
    return null;
  }
}
