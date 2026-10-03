// Studyslot server. Nothing is stored: every request carries the student's timetable link,
// the timetable is fetched and cleaned, and the result is returned.
//   GET /api/timetable?link=…&tz=…   cleaned classes for the app (plus week counts)
//   GET /feed/<token>.ics            a cleaned calendar to subscribe to in Apple/Google Calendar;
//                                    <token> packs the link, chosen groups and hidden modules
import { extractClasses, groupChoicesFrom } from "./timetable.js";
import { isValidTimeZone } from "./time.js";
import { parseEvents } from "./ical.js";

const DAY_MS = 86400000;
const MAX_BYTES = 6 * 1024 * 1024;

export default {
  // Only GET is used; rate limits and link checks below keep the timetable reader from being misused.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/timetable") {
      // One visitor can't use Studyslot to hammer college servers (or anyone else's).
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      if (env.API_LIMITER && !(await env.API_LIMITER.limit({ key: ip })).success) {
        return json({ error: "Too many requests. Wait a minute and try again." }, 429);
      }
      return timetable(url);
    }
    const feed = url.pathname.match(/^\/feed\/([A-Za-z0-9_-]+)\.ics$/);
    if (request.method === "GET" && feed) {
      // Calendar apps (e.g. Google) fetch every subscriber from shared servers, so limit per student link.
      if (env.FEED_LIMITER && !(await env.FEED_LIMITER.limit({ key: feed[1].slice(0, 64) })).success) {
        return new Response("Too many requests.", { status: 429, headers: { "Retry-After": "60" } });
      }
      return calendarFeed(feed[1], url);
    }
    return env.ASSETS.fetch(request);
  },
};

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

class LinkError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function normalizeLink(raw) {
  const link = String(raw || "").trim().replace(/^webcal:\/\//i, "https://");
  const notALink = new LinkError("That doesn't look like a calendar link. It should start with https:// or webcal://.", 400);
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
  if (res.status === 404 || res.status === 410) throw new LinkError("That timetable link no longer works. Your college may have issued a new one.", 502);
  if (!res.ok) throw new LinkError(`Your college's server returned an error (${res.status}). Try again later.`, 502);
  if (Number(res.headers.get("Content-Length") || 0) > MAX_BYTES) throw new LinkError("That calendar is too large to read.", 413);
  const ics = await res.text();
  if (!ics.includes("BEGIN:VCALENDAR")) {
    throw new LinkError("That link opened a web page, not a calendar. Look for a link ending in .ics or starting with webcal://.", 422);
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

async function timetable(url) {
  const tz = url.searchParams.get("tz") || "UTC";
  if (!isValidTimeZone(tz)) return json({ error: "Unknown time zone." }, 400);
  try {
    const ics = await download(normalizeLink(url.searchParams.get("link")));
    const now = Date.now();
    // A wide range is read once for week numbers; the app gets the coming weeks in full.
    const all = extractClasses(ics, tz, new Date(now - 200 * DAY_MS), new Date(now + 240 * DAY_MS));
    const from = new Date(now - 7 * DAY_MS).toISOString();
    const to = new Date(now + 150 * DAY_MS).toISOString();
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
  } catch (err) {
    if (err instanceof LinkError) return json({ error: err.message }, err.status);
    throw err;
  }
}

// ---------- Clean calendar feed ----------

function decodeToken(token) {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

const escapeText = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
const icsTime = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (line) => {
  const out = [];
  for (let i = 0; i < line.length; i += 60) out.push((i ? " " : "") + line.slice(i, i + 60));
  return out.join("\r\n");
};

async function hashId(text) {
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function calendarFeed(token) {
  const settings = decodeToken(token);
  if (!settings?.l) return new Response("Invalid Studyslot calendar link.", { status: 400 });
  const tz = settings.z && isValidTimeZone(settings.z) ? settings.z : "UTC";
  const groups = settings.g || {};
  const hidden = new Set(settings.h || []);
  let ics;
  try {
    ics = await download(normalizeLink(settings.l));
  } catch (err) {
    // Tell calendar apps to try again later rather than wiping the student's calendar.
    if (err instanceof LinkError) return new Response(err.message, { status: 503, headers: { "Retry-After": "3600" } });
    throw err;
  }
  const now = Date.now();
  const classes = extractClasses(ics, tz, new Date(now - 14 * DAY_MS), new Date(now + 180 * DAY_MS)).filter(
    (c) => !hidden.has(c.title) && (!c.group || !groups[c.title] || groups[c.title] === c.group),
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
    "X-WR-CALDESC:Your college timetable, cleaned up by Studyslot",
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
      "Cache-Control": "no-store",
    },
  });
}
