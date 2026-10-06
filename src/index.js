// Studyslot server. Nothing is stored: every request carries the student's timetable link
// (or an encrypted token holding it), the timetable is fetched and cleaned, and the result is returned.
//   GET  /api/timetable?link=…&tz=…   cleaned classes for the app (plus week counts)
//   POST /api/share                   { l, g, h, z, n } settings -> { token, id }: an encrypted token
//                                     for friend links (see share.js). With p: "c", a calendar-only
//                                     token for the feed; with reset: true, a new friend link that
//                                     replaces all earlier ones
//   GET  /api/friend?token=…&tz=…     a friend's name and classes from their token, without their link
//   GET  /feed/<token>.ics            a cleaned calendar to subscribe to in Apple/Google Calendar
//   POST /api/feedback                { kind, message, email?, version, device } from the feedback form
import { extractClasses, groupChoicesFrom } from "./timetable.js";
import { isValidTimeZone } from "./time.js";
import { parseEvents } from "./ical.js";
import { LEGACY_TOKENS_UNTIL, linkId, openLegacyToken, openToken, sealToken, toBase64url } from "./share.js";

const DAY_MS = 86400000;
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_SETTINGS_BYTES = 16 * 1024;

const API = {
  "GET /api/timetable": (request, url) => timetable(url),
  "POST /api/share": (request, url, env) => createShare(request, env),
  "GET /api/friend": (request, url, env) => friendTimetable(url, env),
  "POST /api/feedback": (request, url, env) => saveFeedback(request, env),
};

export default {
  // Rate limits and link checks below keep the timetable reader from being misused.
  async fetch(request, env) {
    const url = new URL(request.url);
    // One address for everyone: the app keeps a student's timetable and friends per address, so
    // www.studyslot.ie sends people to studyslot.ie (path and query kept, e.g. friend links).
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.href, 301);
    }
    const route = API[`${request.method} ${url.pathname}`];
    if (route) {
      // One visitor can't use Studyslot to hammer college servers (or anyone else's).
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      if (env.API_LIMITER && !(await env.API_LIMITER.limit({ key: ip })).success) {
        return json({ error: "Too many requests. Wait a minute and try again." }, 429);
      }
      // Feedback and link resets share the account's daily KV write allowance, so one visitor
      // can't use up the day's writes with feedback.
      if (url.pathname === "/api/feedback" && env.FEEDBACK_LIMITER) {
        if (!(await env.FEEDBACK_LIMITER.limit({ key: ip })).success)
          return json({ error: "That's a lot of feedback at once. Wait a minute and try again." }, 429);
      }
      try {
        return await route(request, url, env);
      } catch (err) {
        if (err instanceof LinkError) return json({ error: err.message }, err.status);
        throw err;
      }
    }
    const feed = url.pathname.match(/^\/feed\/([A-Za-z0-9_-]+)\.ics$/);
    if (request.method === "GET" && feed) {
      // Calendar apps (e.g. Google) fetch every subscriber from shared servers, so limit per student link.
      if (env.FEED_LIMITER && !(await env.FEED_LIMITER.limit({ key: feed[1].slice(0, 64) })).success) {
        return new Response("Too many requests.", { status: 429, headers: { "Retry-After": "60" } });
      }
      return calendarFeed(feed[1], env);
    }
    if (request.method === "GET" && url.pathname === "/") return homePage(request, url, env);
    return env.ASSETS.fetch(request);
  },
};

// ---------- Link previews ----------

// The app's page, with its preview image as a full address (chat apps need one) and, for a friend
// link, a preview that says what it is. The friend's name is left out on purpose: chat apps fetch
// previews on their own servers and keep them.
async function homePage(request, url, env) {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 200 || !res.headers.get("Content-Type")?.includes("text/html")) return res;
  let html = (await res.text()).replace('content="/share.jpg"', `content="${url.origin}/share.jpg"`);
  if (url.searchParams.has("friend")) {
    html = html
      .replace(
        'property="og:title" content="Studyslot"',
        'property="og:title" content="A friend shared their timetable"',
      )
      .replace(
        /(property="og:description"\s+content=")[^"]*/,
        "$1Open it in Studyslot to see when you're both free. No account needed.",
      );
  }
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  headers.delete("ETag"); // the page now differs from the stored file
  // A friend link someone posts publicly shouldn't end up in search results.
  if (url.searchParams.has("friend")) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(html, { status: 200, headers });
}

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

class LinkError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function normalizeLink(raw) {
  const link = String(raw || "")
    .trim()
    .replace(/^webcal:\/\//i, "https://");
  const notALink = new LinkError(
    "That doesn't look like a calendar link. It should start with https:// or webcal://.",
    400,
  );
  if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(link) || link.length > 2000) throw notALink;
  let url;
  try {
    url = new URL(link);
  } catch {
    throw notALink;
  }
  // Only ordinary public web addresses: no passwords in links, no raw IP addresses, standard ports.
  if (url.username || url.password || url.port || /^[\d.]+$|^\[/.test(url.hostname)) throw notALink;
  return url.href;
}

async function download(link) {
  let res;
  try {
    res = await fetch(link, {
      headers: { Accept: "text/calendar, */*", "User-Agent": "Studyslot timetable reader" },
      signal: AbortSignal.timeout(12000),
      // On a custom domain, Cloudflare keeps the college's file for up to 15 minutes so many
      // students (or calendar apps) refreshing at once don't each hit the college's server.
      cf: { cacheTtl: 900, cacheEverything: true },
    });
  } catch {
    throw new LinkError("Couldn't reach that link. Check it's copied in full.", 502);
  }
  if (res.status === 404 || res.status === 410)
    throw new LinkError("That timetable link no longer works. Your college may have issued a new one.", 502);
  if (!res.ok) throw new LinkError(`Your college's server returned an error (${res.status}). Try again later.`, 502);
  if (Number(res.headers.get("Content-Length") || 0) > MAX_BYTES)
    throw new LinkError("That calendar is too large to read.", 413);
  const ics = await res.text();
  if (!ics.includes("BEGIN:VCALENDAR")) {
    throw new LinkError(
      "That link opened a web page, not a calendar. Look for a link ending in .ics or starting with webcal://.",
      422,
    );
  }
  if (ics.length > MAX_BYTES) throw new LinkError("That calendar is too large to read.", 413);
  return ics;
}

const mondayOf = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

// ---------- App data ----------

// The app shows from a week ago to about five months ahead.
const appRange = (now) => [new Date(now - 7 * DAY_MS).toISOString(), new Date(now + 150 * DAY_MS).toISOString()];

async function timetable(url) {
  const tz = url.searchParams.get("tz") || "UTC";
  if (!isValidTimeZone(tz)) return json({ error: "Unknown time zone." }, 400);
  const ics = await download(normalizeLink(url.searchParams.get("link")));
  const now = Date.now();
  // A wide range is read once for week numbers; the app gets the coming weeks in full.
  const all = extractClasses(ics, tz, new Date(now - 200 * DAY_MS), new Date(now + 240 * DAY_MS));
  const [from, to] = appRange(now);
  const classes = all.filter((c) => c.end > from && c.start < to);
  const weeks = {};
  for (const c of all) {
    const monday = mondayOf(new Date(c.start));
    weeks[monday] = (weeks[monday] || 0) + 1;
  }
  return json({
    name: ics.match(/\nX-WR-CALNAME:([^\r\n]*)/)?.[1]?.trim() || "",
    classes,
    groupChoices: groupChoicesFrom(classes),
    weeks, // Monday (YYYY-MM-DD) -> number of classes, used for "Week 4 of 12"
    totalEntries: classes.length ? undefined : parseEvents(ics).length,
    fetchedAt: new Date(now).toISOString(),
  });
}

// ---------- Sharing (encrypted tokens, see share.js) ----------

// Only the fields the app sends, with sane types and sizes, go into a token.
function cleanSettings(raw) {
  if (!raw || typeof raw !== "object") throw new LinkError("Invalid sharing settings.", 400);
  const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === "string").slice(0, 200) : []);
  const groups = raw.g && typeof raw.g === "object" && !Array.isArray(raw.g) ? raw.g : {};
  return {
    l: normalizeLink(raw.l),
    g: Object.fromEntries(
      Object.entries(groups)
        .filter(([, v]) => typeof v === "string")
        .slice(0, 200),
    ),
    h: strings(raw.h),
    z: typeof raw.z === "string" && isValidTimeZone(raw.z) ? raw.z : "UTC",
    n: typeof raw.n === "string" ? raw.n.trim().slice(0, 40) : "",
  };
}

async function createShare(request, env) {
  if (!env.SHARE_KEY) return json({ error: "Sharing isn't available right now. Try again later." }, 503);
  const text = await request.text();
  if (text.length > MAX_SETTINGS_BYTES) return json({ error: "Too many settings to share." }, 413);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Invalid sharing settings." }, 400);
  }
  const settings = cleanSettings(raw);
  const id = await linkId(settings.l, env.SHARE_KEY);
  if (raw.p === "c") {
    settings.p = "c"; // calendar-only: survives resets, and can't be used as a friend link
  } else if (raw.reset === true) {
    if (!env.LINK_RESETS) return json({ error: "Resetting links isn't available right now. Try again later." }, 503);
    settings.r = toBase64url(crypto.getRandomValues(new Uint8Array(9)));
    await env.LINK_RESETS.put(id, settings.r);
  } else {
    const generation = await generationOf(id, env);
    if (generation) settings.r = generation;
  }
  return json({ token: await sealToken(settings, env.SHARE_KEY), id });
}

// Resetting a link. A student who resets gets a new random "generation", kept in LINK_RESETS
// under their link's id (an HMAC that doesn't reveal the link). Friend links carry the generation
// they were made with (r), and ones from before the latest reset are refused. That's all that's
// stored, and only for students who have reset; everyone else has no entry.
const generationOf = async (id, env) => (env.LINK_RESETS ? await env.LINK_RESETS.get(id) : null);
const isCurrent = async (settings, env) => {
  const generation = await generationOf(await linkId(normalizeLink(settings.l), env.SHARE_KEY), env);
  return !generation || settings.r === generation;
};
const RESET_MESSAGE = "This link was reset by the person who shared it. Ask them for their new link.";

/**
 * Settings from a feed or friend token: { settings, legacy } or null. Old unencrypted tokens
 * are accepted (legacy: true) until LEGACY_TOKENS_UNTIL if `allowLegacy` is set.
 */
async function readToken(token, env, allowLegacy) {
  const settings = env.SHARE_KEY ? await openToken(token, env.SHARE_KEY) : null;
  if (settings?.l) return { settings, legacy: false };
  const old = allowLegacy && openLegacyToken(token);
  if (old?.l) return { settings: old, legacy: true };
  return null;
}

const visibleFor = (classes, settings) => {
  const groups = settings.g || {};
  const hidden = new Set(settings.h || []);
  return classes.filter((c) => !hidden.has(c.title) && (!c.group || !groups[c.title] || groups[c.title] === c.group));
};

// A friend's classes, filtered by their own groups and hidden modules. Their link isn't returned.
async function friendTimetable(url, env) {
  if (!env.SHARE_KEY) return json({ error: "Friends aren't available right now. Try again later." }, 503);
  const opened = await readToken(url.searchParams.get("token") || "", env, false);
  if (!opened) return json({ error: "That friend link isn't valid. Ask your friend to share it again." }, 400);
  const { settings } = opened;
  if (settings.p === "c")
    return json({ error: "That friend link isn't valid. Ask your friend to share it again." }, 400);
  if (!(await isCurrent(settings, env))) return json({ error: RESET_MESSAGE }, 410);
  const requested = url.searchParams.get("tz");
  const tz = isValidTimeZone(settings.z) ? settings.z : requested && isValidTimeZone(requested) ? requested : "UTC";
  const link = normalizeLink(settings.l);
  const ics = await download(link);
  const now = Date.now();
  const [from, to] = appRange(now);
  const classes = extractClasses(ics, tz, new Date(from), new Date(to)).filter((c) => c.end > from && c.start < to);
  return json({
    id: await linkId(link, env.SHARE_KEY),
    name: settings.n || "",
    classes: visibleFor(classes, settings),
    fetchedAt: new Date(now).toISOString(),
  });
}

// ---------- Feedback ----------

// Messages from the in-app form, kept in the FEEDBACK store for a year (as the Privacy Policy
// says) and read with `npm run feedback`. The app never sends a timetable link with them.
const FEEDBACK_KINDS = ["bug", "idea", "other"];
const FEEDBACK_TTL = 365 * DAY_MS;

async function saveFeedback(request, env) {
  if (!env.FEEDBACK) return json({ error: "Feedback isn't available right now. Try again later." }, 503);
  const text = await request.text();
  if (text.length > 8 * 1024) return json({ error: "That message is too long." }, 413);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Invalid feedback." }, 400);
  }
  const field = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const message = field(raw?.message, 2000);
  if (!message) return json({ error: "Write a message first." }, 400);
  const email = field(raw.email, 200);
  const entry = {
    at: new Date().toISOString(),
    kind: FEEDBACK_KINDS.includes(raw.kind) ? raw.kind : "other",
    message,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    version: field(raw.version, 20),
    device: field(raw.device, 80),
  };
  // Newest last when listed; the random part keeps two messages in the same millisecond apart.
  const key = `${entry.at}_${toBase64url(crypto.getRandomValues(new Uint8Array(6)))}`;
  await env.FEEDBACK.put(key, JSON.stringify(entry), { expirationTtl: FEEDBACK_TTL / 1000 });
  return json({ ok: true });
}

// ---------- Clean calendar feed ----------

const escapeText = (s) =>
  String(s)
    .replace(/[\\;,]/g, (c) => "\\" + c)
    .replace(/\r\n|\r|\n/g, "\\n"); // any line break, so text can never start a new line
const icsTime = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (line) => {
  const out = [];
  for (let i = 0; i < line.length; i += 60) out.push((i ? " " : "") + line.slice(i, i + 60));
  return out.join("\r\n");
};

async function hashId(text) {
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function calendarFeed(token, env) {
  const opened = await readToken(token, env, true);
  if (!opened) return new Response("Invalid Studyslot calendar link.", { status: 400 });
  const { settings, legacy } = opened;
  if (legacy && Date.now() >= LEGACY_TOKENS_UNTIL) {
    return new Response(
      "This Studyslot calendar link has expired. Open Studyslot, go to Settings, and add your calendar again.",
      { status: 410 },
    );
  }
  // A friend link opened as a calendar after a reset. Calendar-only links aren't affected.
  if (!legacy && settings.p !== "c" && !(await isCurrent(settings, env))) {
    return new Response(`${RESET_MESSAGE} If it's your own calendar, open Studyslot and add it again.`, {
      status: 410,
    });
  }
  const tz = settings.z && isValidTimeZone(settings.z) ? settings.z : "UTC";
  let ics;
  try {
    ics = await download(normalizeLink(settings.l));
  } catch (err) {
    // Tell calendar apps to try again later rather than wiping the student's calendar.
    if (err instanceof LinkError) return new Response(err.message, { status: 503, headers: { "Retry-After": "3600" } });
    throw err;
  }
  const now = Date.now();
  const classes = visibleFor(
    extractClasses(ics, tz, new Date(now - 14 * DAY_MS), new Date(now + 180 * DAY_MS)),
    settings,
  );

  const stamp = icsTime(new Date(now).toISOString());
  const name = settings.n ? `Studyslot · ${settings.n}` : "Studyslot";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Studyslot//Clean timetable//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    legacy
      ? "X-WR-CALDESC:This calendar link is out of date and will stop working on 1 February 2027. " +
        "Open Studyslot\\, go to Settings → Add to your calendar\\, and add it again."
      : "X-WR-CALDESC:Your college timetable\\, cleaned up by Studyslot",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const c of classes) {
    const kind = [c.type, c.group && `Group ${c.group}`].filter(Boolean).join(" · ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${await hashId(c.id)}@studyslot`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTime(c.start)}`,
      `DTEND:${icsTime(c.end)}`,
      `SUMMARY:${escapeText(c.type ? `${c.title} · ${c.type}` : c.title)}`,
      ...(c.room ? [`LOCATION:${escapeText(c.room)}`] : []),
      `DESCRIPTION:${escapeText([kind, c.code && `Module ${c.code}`].filter(Boolean).join("\n"))}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(`${c.title}${c.room ? ` in ${c.room}` : ""}`)}`,
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="studyslot.ics"',
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
