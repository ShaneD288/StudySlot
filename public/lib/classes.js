// Choosing which classes to show, for the student and for their friends.
import { dayKey } from "./dates.js";

/**
 * Drops hidden modules and other groups' classes.
 * groups: module title -> chosen group; hidden: module titles (a Set or an array).
 */
export function filterClasses(classes = [], groups = {}, hidden = []) {
  const hiddenSet = new Set(hidden);
  return classes.filter(
    (c) => !hiddenSet.has(c.title) && (!c.group || !groups[c.title] || groups[c.title] === c.group),
  );
}

/** My classes on `day` that every friend in `theirs` is also in (same module, same start). */
export function classesInCommon(mine, theirs, day) {
  return mine.filter(
    (c) =>
      dayKey(new Date(c.start)) === day &&
      theirs.length &&
      theirs.every((list) => list.some((o) => o.title === c.title && o.start === c.start)),
  );
}
