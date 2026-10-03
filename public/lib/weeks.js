// Week numbers ("Week 4 of 12") from the server's count of classes per week.
// `weeks` maps each Monday ("YYYY-MM-DD") to the number of classes that week.
import { weeksBetween } from "./dates.js";

// Terms are runs of weeks with classes; up to two empty weeks (e.g. reading week) stay inside a term.
export function terms(weeks = {}) {
  const mondays = Object.keys(weeks)
    .filter((k) => weeks[k] > 0)
    .sort();
  const out = [];
  for (const m of mondays) {
    const t = out.at(-1);
    if (t && weeksBetween(t.last, m) <= 3) t.last = m;
    else out.push({ first: m, last: m });
  }
  return out;
}

/** "Week 4 of 12", "Week 7 of 12 · no classes", "Classes start in 2 weeks"… for the week of `monday`. */
export function weekLabel(weeks, monday) {
  if (!weeks) return "";
  const all = terms(weeks);
  const term = all.find((t) => t.first <= monday && monday <= t.last);
  if (term) {
    const label = `Week ${weeksBetween(term.first, monday) + 1} of ${weeksBetween(term.first, term.last) + 1}`;
    return weeks[monday] ? label : `${label} · no classes`;
  }
  const next = all.find((t) => t.first > monday);
  if (next) {
    const w = weeksBetween(monday, next.first);
    return w === 1 ? "Classes start next week" : `Classes start in ${w} weeks`;
  }
  return all.length ? "Term finished" : "";
}
