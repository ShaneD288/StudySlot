// Time zone helpers. Workers run in UTC, so user-facing "local" times are converted
// explicitly using the user's IANA time zone (e.g. "Europe/Dublin").

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

// Offset of `timeZone` from UTC at the given instant, in milliseconds.
function offsetAt(utcMs, timeZone) {
  const p = zonedParts(new Date(utcMs), timeZone);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

/** "2026-09-30T10:00" in `timeZone` -> Date (UTC instant). */
export function localToUtc(local, timeZone) {
  const [date, time = "00:00"] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min, s = 0] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min, s);
  const first = offsetAt(guess - offsetAt(guess, timeZone), timeZone);
  return new Date(guess - first);
}

/** Date -> "2026-09-30T10:00" in `timeZone`. */
export function utcToLocal(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const DAY_MS = 86400000;
const icsOffset = (ms) => {
  const sign = ms < 0 ? "-" : "+";
  const min = Math.abs(ms) / 60000;
  return `${sign}${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}`;
};
const icsLocal = (ms) => new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "");

/**
 * A VTIMEZONE block for `timeZone` covering `years` years from `fromYear`, listing each
 * daylight-saving change explicitly. Repeating events need it so "9:00 every Monday" stays
 * 9:00 when the clocks change.
 */
export function buildVTimezone(timeZone, fromYear, years = 4) {
  const start = Date.UTC(fromYear, 0, 1);
  const end = Date.UTC(fromYear + years, 0, 1);
  let prev = offsetAt(start, timeZone);
  const lines = [
    "BEGIN:VTIMEZONE",
    `TZID:${timeZone}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    `TZOFFSETFROM:${icsOffset(prev)}`,
    `TZOFFSETTO:${icsOffset(prev)}`,
    "END:STANDARD",
  ];
  for (let t = start + DAY_MS; t <= end; t += DAY_MS) {
    const offset = offsetAt(t, timeZone);
    if (offset === prev) continue;
    // Narrow the change down to the minute.
    let lo = t - DAY_MS;
    let hi = t;
    while (hi - lo > 60000) {
      const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
      if (offsetAt(mid, timeZone) === prev) lo = mid;
      else hi = mid;
    }
    const kind = offset > prev ? "DAYLIGHT" : "STANDARD";
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${icsLocal(hi + prev)}`, // local wall-clock time just before the change
      `TZOFFSETFROM:${icsOffset(prev)}`,
      `TZOFFSETTO:${icsOffset(offset)}`,
      `END:${kind}`,
    );
    prev = offset;
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

/** Add days to a "YYYY-MM-DD" string. */
export function addDays(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
