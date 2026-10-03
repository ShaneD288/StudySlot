// Private sharing links. Calendar-feed and friend links carry the student's settings
// (timetable link, groups, hidden modules, time zone, name) encrypted with AES-GCM, so
// nobody can read the timetable link from a shared link, and a changed link is rejected.
// Nothing is stored: the key (the SHARE_KEY secret) is the only thing the server keeps.
//
// Token layout (then base64url-encoded): [version 1 byte][IV 12 bytes][ciphertext + 16-byte tag]

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = new TextEncoder().encode("studyslot-share-v1"); // binds the version to the ciphertext

// Old links were the settings JSON in plain base64url. They keep working until this date
// so students have time to share again; after it they're refused.
export const LEGACY_TOKENS_UNTIL = Date.parse("2027-02-01T00:00:00Z");

export const toBase64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function fromBase64url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

// Two separate keys are derived from SHARE_KEY with HKDF: one encrypts tokens, one makes
// friend ids. Deriving is slow-ish, so keep the result for the life of the Worker.
const keyCache = new Map();
function keys(secret) {
  if (!secret || secret.length < 32) throw new Error("SHARE_KEY must be set to at least 32 characters.");
  if (!keyCache.has(secret)) {
    keyCache.set(
      secret,
      (async () => {
        const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, [
          "deriveKey",
        ]);
        const derive = (info, algorithm, usages) =>
          crypto.subtle.deriveKey(
            { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
            base,
            algorithm,
            false,
            usages,
          );
        return {
          aes: await derive("studyslot share token v1", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
          hmac: await derive("studyslot friend id v1", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
        };
      })(),
    );
  }
  return keyCache.get(secret);
}

/** Encrypts `settings` (any JSON value) into a URL-safe token. */
export async function sealToken(settings, secret) {
  const { aes } = await keys(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(settings));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, aes, plain));
  return toBase64url(new Uint8Array([VERSION, ...iv, ...sealed]));
}

/** The settings inside a token from sealToken, or null if it's invalid, changed or for another key. */
export async function openToken(token, secret) {
  let bytes;
  try {
    bytes = fromBase64url(token);
  } catch {
    return null;
  }
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES || bytes[0] !== VERSION) return null;
  const { aes } = await keys(secret);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(1, 1 + IV_BYTES), additionalData: AAD },
      aes,
      bytes.subarray(1 + IV_BYTES),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null; // wrong key, or the token was changed (the GCM tag doesn't match)
  }
}

/** Settings from an old, unencrypted base64url token, or null. */
export function openLegacyToken(token) {
  try {
    const settings = JSON.parse(new TextDecoder().decode(fromBase64url(token)));
    return settings && typeof settings === "object" ? settings : null;
  } catch {
    return null;
  }
}

/**
 * A stable id for a timetable link that doesn't reveal it, so the app can spot the same
 * friend twice (or its own link) without ever seeing their link.
 */
export async function linkId(link, secret) {
  const { hmac } = await keys(secret);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(link)));
  return "f" + toBase64url(mac.subarray(0, 12));
}
