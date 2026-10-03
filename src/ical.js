// Minimal iCalendar (RFC 5545) reading and writing — just what the calendar sync needs.
import { localToUtc, utcToLocal, buildVTimezone } from "./time.js";

// ---------- Reading ----------

const unfold = (ics) => ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);

function parseLine(line) {
  // NAME;PARAM=VALUE;PARAM="QUOTED:VALUE":value
  let i = 0;
  let inQuotes = false;
  for (; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === ":" && !inQuotes) break;
  }
  const [name, ...rawParams] = line.slice(0, i).split(";");
  const params = {};
  for (const p of rawParams) {
    const [k, v = ""] = p.split("=");
    params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (s) =>
  s.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));

/** Returns the VEVENTs in an iCalendar string as { NAME: {value, params} } maps. */
export function parseEvents(ics) {
  const events = [];
  let current = null;
  let nested = 0; // inside a VALARM etc.
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
    } else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current && line.startsWith("BEGIN:")) {
      nested++;
    } else if (current && line.startsWith("END:")) {
      nested--;
    } else if (current && !nested && line) {
      const prop = parseLine(line);
      // EXDATE (skipped occurrences) may be split over several lines; merge them.
      if (prop.name === "EXDATE" && current.EXDATE) current.EXDATE.value += "," + prop.value;
      else current[prop.name] ??= prop;
    }
  }
  return events;
}

/** A DTSTART/DTEND property -> { allDay: true, date } or { allDay: false, instant: Date }. */
export function readTime(prop, fallbackTimeZone) {
  const v = prop.value;
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    return { allDay: true, date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` };
  }
  const local = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15) || "00"}`;
  if (v.endsWith("Z")) return { allDay: false, instant: new Date(local + "Z") };
  return { allDay: false, instant: localToUtc(local, ianaZone(prop.params.TZID, fallbackTimeZone)) };
}

/** "PT1H30M", "P1D" -> milliseconds */
export function parseDuration(value) {
  const m = value.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w = 0, d = 0, h = 0, min = 0, s = 0] = m;
  const ms = ((+w * 7 + +d) * 86400 + +h * 3600 + +min * 60 + +s) * 1000;
  return sign === "-" ? -ms : ms;
}

export const eventText = (event, name) => (event[name] ? unescapeText(event[name].value) : "");

// Outlook and Exchange write Windows time zone names ("GMT Standard Time") or labels like
// "(UTC+00:00) Dublin, Edinburgh, Lisbon, London" instead of IANA names. Map the common ones.
const WINDOWS_ZONES = {
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kyiv",
  "GTB Standard Time": "Europe/Bucharest",
  "Russian Standard Time": "Europe/Moscow",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Singapore Standard Time": "Asia/Singapore",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
};
const zoneCache = new Map();

/** A TZID from any calendar app -> an IANA time zone name, or `fallback` if unknown. */
export function ianaZone(tzid, fallback) {
  if (!tzid) return fallback;
  if (zoneCache.has(tzid)) return zoneCache.get(tzid) || fallback;
  const valid = (z) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
  };
  let zone = null;
  if (valid(tzid)) zone = tzid;
  else if (WINDOWS_ZONES[tzid]) zone = WINDOWS_ZONES[tzid];
  else if (/dublin|london|edinburgh|lisbon/i.test(tzid)) zone = "Europe/London"; // "(UTC+00:00) Dublin, Edinburgh…"
  else {
    // "/mozilla.org/20070129_1/Europe/Dublin" and similar prefixed names.
    const m = tzid.match(/([A-Z][a-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/);
    if (m && valid(m[1])) zone = m[1];
  }
  zoneCache.set(tzid, zone);
  return zone || fallback;
}

// ---------- Writing ----------

const escapeText = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");

const icsDateTime = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (date) => date.replace(/-/g, "");

// Lines longer than 75 octets must be folded. Folding by characters at 60 keeps
// multi-byte UTF-8 safely under the limit.
function fold(line) {
  const out = [];
  for (let i = 0; i < line.length; i += 60) out.push((i ? " " : "") + line.slice(i, i + 60));
  return out.join("\r\n");
}

export function timeLines(name, time) {
  return time.allDay ? `${name};VALUE=DATE:${icsDate(time.date)}` : `${name}:${icsDateTime(time.instant)}`;
}

/**
 * Builds a new VCALENDAR with one VEVENT.
 * start/end: { allDay, date } or { allDay: false, instant }. All-day end is exclusive.
 */
export function buildEvent({ uid, title, start, end, location, notes, alertMinutes, rrule, timeZone, job }) {
  // Repeating timed events are written in local time with their time zone, so they
  // keep the same wall-clock time across daylight-saving changes.
  const zoned = rrule && !start.allDay && timeZone;
  const zonedLine = (name, time) =>
    `${name};TZID=${timeZone}:${utcToLocal(time.instant, timeZone).replace(/[-:]/g, "")}00`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Personal Assistant//EN",
    ...(zoned ? buildVTimezone(timeZone, start.instant.getUTCFullYear() - 1) : []),
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDateTime(new Date())}`,
    zoned ? zonedLine("DTSTART", start) : timeLines("DTSTART", start),
    zoned ? zonedLine("DTEND", end) : timeLines("DTEND", end),
    `SUMMARY:${escapeText(title)}`,
  ];
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (job) lines.push(`X-ASSISTANT-JOB:${escapeText(job)}`, "CATEGORIES:Shift");
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
  if (alertMinutes != null) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(title)}`, `TRIGGER:-PT${alertMinutes}M`, "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Edits an existing event in place, replacing only the changed properties so that
 * everything else (alerts, attendees, URLs...) set in Apple Calendar is preserved.
 * changes: { title?, location?, notes?, start?, end? } (start/end as for buildEvent)
 */
export function patchEvent(ics, changes) {
  const replacements = {};
  if (changes.title !== undefined) replacements.SUMMARY = `SUMMARY:${escapeText(changes.title)}`;
  if (changes.location !== undefined) replacements.LOCATION = changes.location ? `LOCATION:${escapeText(changes.location)}` : null;
  if (changes.notes !== undefined) replacements.DESCRIPTION = changes.notes ? `DESCRIPTION:${escapeText(changes.notes)}` : null;
  if (changes.start) replacements.DTSTART = timeLines("DTSTART", changes.start);
  if (changes.end) {
    replacements.DTEND = timeLines("DTEND", changes.end);
    replacements.DURATION = null; // DTEND and DURATION can't both be present
  }

  const out = [];
  let inEvent = false;
  let nested = 0;
  const seen = new Set();
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") inEvent = true;
    if (inEvent && !nested && line === "END:VEVENT") {
      for (const [name, value] of Object.entries(replacements)) if (!seen.has(name) && value) out.push(value);
      inEvent = false;
    } else if (inEvent && line.startsWith("BEGIN:") && line !== "BEGIN:VEVENT") nested++;
    else if (inEvent && line.startsWith("END:")) nested--;
    else if (inEvent && !nested) {
      const name = parseLine(line).name;
      if (name in replacements) {
        seen.add(name);
        if (replacements[name]) out.push(replacements[name]);
        continue;
      }
      if (name === "SEQUENCE") {
        out.push(`SEQUENCE:${(parseInt(parseLine(line).value) || 0) + 1}`);
        continue;
      }
      if (name === "DTSTAMP" || name === "LAST-MODIFIED") {
        out.push(`${name}:${icsDateTime(new Date())}`);
        continue;
      }
    }
    if (line) out.push(line);
  }
  return out.map(fold).join("\r\n") + "\r\n";
}

