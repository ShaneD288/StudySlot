// Free time together: the gaps in everyone's timetables on one day.
import { dayKey, fromKey } from "./dates.js";

/**
 * Free windows on `day` ("YYYY-MM-DD") between 9:00 and 18:00 local time when nobody in
 * `lists` (one list of classes per person) has a class. Gaps under 30 minutes don't count.
 * Returns [[startMs, endMs], ...] in order.
 */
export function freeTogether(day, lists) {
  const start = fromKey(day);
  start.setHours(9, 0, 0, 0);
  const end = fromKey(day);
  end.setHours(18, 0, 0, 0);
  const busy = lists
    .flat()
    .filter((c) => dayKey(new Date(c.start)) === day)
    .map((c) => [Math.max(Date.parse(c.start), +start), Math.min(Date.parse(c.end), +end)])
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0]);
  const free = [];
  let cursor = +start;
  for (const [a, b] of busy) {
    if (a - cursor >= 30 * 60000) free.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (+end - cursor >= 30 * 60000) free.push([cursor, +end]);
  return free;
}
