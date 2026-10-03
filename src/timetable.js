// Timetable parsing for Studyslot: reads any college iCal feed, expands repeating classes and
// cleans each entry down to class, type, group, room and time. Pure functions, no storage.
import { parseEvents, readTime, parseDuration, eventText, ianaZone } from "./ical.js";
import { localToUtc } from "./time.js";

const DAY_MS = 86400000;

/** Modules listed for more than one group (e.g. Lab A and Lab B): [{ title, groups }]. */
export function groupChoicesFrom(classes) {
  const byTitle = new Map();
  for (const c of classes) {
    if (!c.group) continue;
    if (!byTitle.has(c.title)) byTitle.set(c.title, new Set());
    byTitle.get(c.title).add(c.group);
  }
  return [...byTitle]
    .filter(([, groups]) => groups.size > 1)
    .map(([title, groups]) => ({ title, groups: [...groups].sort() }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function extractClasses(ics, tz, rangeStart, rangeEnd) {
  const vevents = parseEvents(dropOutOfRange(ics, rangeStart, rangeEnd));
  // Moved or cancelled single occurrences of a repeating class (RECURRENCE-ID overrides).
  const overridden = new Set();
  for (const v of vevents) {
    if (v["RECURRENCE-ID"] && v.UID)
      overridden.add(v.UID.value + "|" + readTime(v["RECURRENCE-ID"], tz).instant?.toISOString());
  }
  const classes = [];
  const cleaned = new Map(); // the same class repeats all term; clean each one once
  for (const v of vevents) {
    if (!v.DTSTART || eventText(v, "STATUS").toUpperCase() === "CANCELLED") continue;
    const found = occurrences(v, tz, rangeStart, rangeEnd);
    if (!found.length) continue;
    const summary = eventText(v, "SUMMARY");
    const location = eventText(v, "LOCATION");
    const description = eventText(v, "DESCRIPTION");
    const key = summary + "|" + location + "|" + (location ? "" : description);
    if (!cleaned.has(key)) cleaned.set(key, cleanClass(summary, location, description));
    const details = cleaned.get(key);
    for (const { start, end } of found) {
      if (!v["RECURRENCE-ID"] && overridden.has(v.UID?.value + "|" + start.toISOString())) continue;
      classes.push({
        id: `${v.UID?.value || details.title}|${start.toISOString()}`,
        ...details,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }
  classes.sort((a, b) => a.start.localeCompare(b.start) || a.group.localeCompare(b.group));
  return mergeBackToBack(classes);
}

// Timetables can hold several years of one-off entries. Skip the ones clearly outside the
// range from their raw DTSTART before doing the (slower) full parse. Repeating entries are kept.
function dropOutOfRange(ics, rangeStart, rangeEnd) {
  const lo = new Date(rangeStart.getTime() - 2 * DAY_MS)
    .toISOString()
    .replace(/[-:]|\.\d{3}/g, "")
    .slice(0, 8);
  const hi = new Date(rangeEnd.getTime() + 2 * DAY_MS)
    .toISOString()
    .replace(/[-:]|\.\d{3}/g, "")
    .slice(0, 8);
  const blocks = ics.split("BEGIN:VEVENT");
  const kept = blocks.slice(1).filter((block) => {
    if (/\nRRULE[:;]/.test(block)) return true;
    const date = block.match(/\nDTSTART[^:\n]*:(\d{8})/)?.[1];
    return !date || (date >= lo && date <= hi);
  });
  return blocks[0] + kept.map((b) => "BEGIN:VEVENT" + b).join("");
}

// Timetables often list a two-hour class as two one-hour slots; join them back up.
function mergeBackToBack(classes) {
  const out = [];
  const sameClass = (a, b) => a.title === b.title && a.type === b.type && a.group === b.group && a.room === b.room;
  for (const c of classes) {
    // Only the last few entries can end exactly when this one starts (the list is sorted).
    const prev = out.slice(-12).find((p) => p.end === c.start && sameClass(p, c));
    if (prev) prev.end = c.end;
    else out.push({ ...c });
  }
  return out;
}

// ---------- Repeating classes ----------

const WEEKDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function occurrences(v, tz, rangeStart, rangeEnd) {
  const first = readTime(v.DTSTART, tz);
  if (first.allDay) return []; // term dates, holidays etc. aren't classes
  let duration = 3600000;
  if (v.DTEND) duration = readTime(v.DTEND, tz).instant - first.instant;
  else if (v.DURATION) duration = parseDuration(v.DURATION.value);
  const one = (start) => ({ start, end: new Date(start.getTime() + duration) });

  if (!v.RRULE) {
    const o = one(first.instant);
    return o.end > rangeStart && o.start < rangeEnd ? [o] : [];
  }

  const rule = Object.fromEntries(v.RRULE.value.split(";").map((p) => p.split("=")));
  const freq = rule.FREQ;
  if (freq !== "WEEKLY" && freq !== "DAILY") return [one(first.instant)];
  const interval = parseInt(rule.INTERVAL || "1", 10);
  const until = rule.UNTIL ? readTime({ value: rule.UNTIL, params: {} }, tz) : null;
  const untilMs = until ? (until.allDay ? Date.parse(until.date + "T23:59:59Z") : until.instant.getTime()) : Infinity;
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : Infinity;
  const exdates = new Set(
    (v.EXDATE?.value || "")
      .split(",")
      .filter(Boolean)
      .map((value) => readTime({ value, params: v.EXDATE.params }, tz).instant?.toISOString()),
  );

  // Walk day by day in the class's own wall-clock time so daylight saving is handled.
  const zone = v.DTSTART.value.endsWith("Z") ? "UTC" : ianaZone(v.DTSTART.params.TZID, tz);
  const raw = v.DTSTART.value;
  const time = `${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15) || "00"}`;
  const startDay = Date.UTC(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8));
  const days = rule.BYDAY ? rule.BYDAY.split(",").map((d) => WEEKDAY[d.slice(-2)]) : [new Date(startDay).getUTCDay()];
  const weekStart = startDay - new Date(startDay).getUTCDay() * DAY_MS;

  const out = [];
  let n = 0;
  for (let day = startDay, i = 0; i < 800; day += DAY_MS, i++) {
    const d = new Date(day);
    if (freq === "WEEKLY") {
      const week = Math.floor((day - weekStart) / (7 * DAY_MS));
      if (week % interval || !days.includes(d.getUTCDay())) continue;
    } else if (Math.round((day - startDay) / DAY_MS) % interval) continue;
    let start;
    try {
      start = localToUtc(`${d.toISOString().slice(0, 10)}T${time}`, zone);
    } catch {
      start = localToUtc(`${d.toISOString().slice(0, 10)}T${time}`, tz);
    }
    if (start.getTime() > untilMs || n >= count || start >= rangeEnd) break;
    n++;
    if (exdates.has(start.toISOString())) continue;
    const o = one(start);
    if (o.end > rangeStart) out.push(o);
  }
  return out;
}

// ---------- Cleaning up college calendar entries ----------

const TYPES = [
  ["Lecture", /\b(lecture|lec)\b/i],
  ["Lab", /\b(lab|laboratory|practical|prac)\b/i],
  ["Tutorial", /\b(tutorial|tut)\b/i],
  ["Seminar", /\bseminar\b/i],
  ["Workshop", /\bworkshop\b/i],
  ["Exam", /\b(exam|examination|assessment)\b/i],
];
const TYPE_WORDS = /\b(lecture|lec|laboratory|lab|practical|prac|tutorial|tut|seminar|workshop)\b/gi;
// Module codes: "COMP10110", "CMPU 3036(22519C)", "BUS-2002"
const MODULE_CODE = /\b[A-Z]{2,5}[ -]?\d{3,5}[A-Z]?(?:\s*\([A-Z0-9]+\))?/;
const SEMESTER = /^(?:sem(?:ester)?\s*\d|s\d|term\s*\d|t\d)$/i;
const WEEKS = /\b(?:weeks?|wks?)\s*\d+(?:\s*[-–,]\s*\d+)*\b/gi;
const INLINE_GROUP = /\b(?:group|grp|gp)\s+([A-Z0-9]{1,3})\b/i;
const tidy = (text) =>
  text
    .replace(/\(\s*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–|:/,.]+|[\s\-–|:/,.]+$/g, "")
    .trim();

/**
 * Turns college timetable entries into { title, type, group, code, room, mapUrl }, e.g.
 *   "CMPU 3036(22519C)/Mobile Software Development/Lab/Sem1/D" at
 *   "CQ-227 Specialist Computer Lab 3 (25)"
 * becomes "Mobile Software Development", Lab, group D, room "CQ-227 · Specialist Computer Lab 3".
 */
export function cleanClass(summary, location, description) {
  summary = summary.replace(/\$/g, ""); // stray characters seen in real timetables
  let type = "";
  let group = "";
  let code = "";
  const kept = [];

  // Timetables pack several fields into the title: split on "/", "|" and " - ".
  for (const part of summary.split(/\s*(?:\/|\|)\s*|\s+[-–]\s+/)) {
    let p = part.replace(/\[[^\]]*\]/g, " "); // [NET201]
    const codeMatch = p.match(MODULE_CODE);
    if (codeMatch) {
      code ||= codeMatch[0].replace(/\s*\(.*\)$/, "");
      p = p.replace(new RegExp(MODULE_CODE.source, "g"), " ");
    }
    const hit = TYPES.find(([, re]) => re.test(p));
    if (hit) {
      type ||= hit[0];
      p = p.replace(TYPE_WORDS, " "); // exam words stay in the title ("Databases Exam")
    }
    const inlineGroup = p.match(INLINE_GROUP) || p.match(/\((?:group|grp|gp)\s*([A-Z0-9]{1,3})\)/i);
    if (inlineGroup) {
      group ||= inlineGroup[1];
      p = p.replace(INLINE_GROUP, " ").replace(/\((?:group|grp|gp)[^)]*\)/gi, " ");
    }
    p = tidy(p.replace(WEEKS, " ").replace(/\((?:weeks?|wks?)[^)]*\)/gi, " "));
    if (!p || SEMESTER.test(p) || /^\d{1,3}$/.test(p)) continue; // "Sem1", "01"
    if (/^[A-Z]{1,2}\d?$/.test(p) && kept.length) {
      group ||= p; // a trailing "D" or "A1" is the student group
      continue;
    }
    kept.push(p);
  }
  let title = tidy(kept.join(" – "));

  // Some timetables put the details in the description instead.
  const field = (names) => description.match(new RegExp(`(?:${names})\\s*:\\s*([^\\n\\t]+)`, "i"))?.[1]?.trim() || "";
  if (!title)
    title =
      tidy(field("module description|module name|module title|module|course|subject").replace(MODULE_CODE, " ")) ||
      summary;
  if (!type) type = TYPES.find(([, re]) => re.test(field("activity type|event type|type")))?.[0] || "";

  const room = cleanRoom(location.trim() || field("room|location|venue|where"));
  const mapUrl =
    description.match(/https?:\/\/(?:link\.)?mazemap\.com\/[^\s\\]+|https?:\/\/maps\.app\.goo\.gl\/[^\s\\]+/i)?.[0] ||
    "";

  return { title, type, group, code, room, mapUrl };
}

/** "CQ-408 Small Lecture Room / Large Classroom 11 (60)" -> "CQ-408 · Large Classroom 11" */
function cleanRoom(room) {
  room = room
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim(); // drop "(60)" capacity
  // Room codes: "CQ-227", "CQ-LG21", "Q-013", "B204", "E2-110"
  const m = room.match(/^([A-Z]{1,4}\d{0,2}-?[A-Z]{0,3}\d{1,4}[A-Z]?)(?=\s|$)\s*(.*)$/);
  if (!m) return room;
  const name = m[2].split(" / ").pop().trim();
  return name ? `${m[1]} · ${name}` : m[1];
}
