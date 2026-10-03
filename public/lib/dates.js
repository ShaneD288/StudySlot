// Day keys ("2026-09-21") in the device's local time, and small date helpers.
// Pure functions shared by the app and the tests.

export const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
export const addDays = (k, n) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
export const mondayOf = (k) => addDays(k, -((fromKey(k).getDay() + 6) % 7));
export const weeksBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / (7 * 86400000));

/** 1500000 -> "25 min", 5400000 -> "1h 30m", 7200000 -> "2h" */
export function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  return min % 60 ? `${hrs}h ${min % 60}m` : `${hrs}h`;
}
