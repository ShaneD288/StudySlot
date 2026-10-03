import { describe, expect, it } from "vitest";
import { addDays, dayKey, duration, fromKey, mondayOf, weeksBetween } from "../public/lib/dates.js";
import { terms, weekLabel } from "../public/lib/weeks.js";
import { classesInCommon, filterClasses } from "../public/lib/classes.js";

// These run with TZ=Europe/Dublin (see vitest.config.js), like a phone in Ireland.

describe("dates", () => {
  it("dayKey and fromKey convert between local dates and YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 8, 21, 23, 30))).toBe("2026-09-21");
    expect(fromKey("2026-09-21")).toEqual(new Date(2026, 8, 21));
    // 23:30 UTC on 21 September is already the 22nd in Dublin (UTC+1).
    expect(dayKey(new Date("2026-09-21T23:30:00Z"))).toBe("2026-09-22");
  });

  it("addDays crosses months, years and the clock change", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("mondayOf finds the Monday of the week (weeks start on Monday)", () => {
    expect(mondayOf("2026-09-21")).toBe("2026-09-21"); // Monday
    expect(mondayOf("2026-09-24")).toBe("2026-09-21"); // Thursday
    expect(mondayOf("2026-09-27")).toBe("2026-09-21"); // Sunday
  });

  it("weeksBetween counts whole weeks, even across the clock change", () => {
    expect(weeksBetween("2026-09-21", "2026-09-28")).toBe(1);
    expect(weeksBetween("2026-10-19", "2026-11-02")).toBe(2);
  });

  it.each([
    [0, "0 min"],
    [25 * 60000, "25 min"],
    [60 * 60000, "1h"],
    [90 * 60000, "1h 30m"],
    [125 * 60000, "2h 5m"],
  ])("duration(%d) is %s", (ms, text) => {
    expect(duration(ms)).toBe(text);
  });
});

describe("week numbers", () => {
  // 12 teaching weeks from 21 September with reading week (26 October) empty, then
  // a second term from 26 January after the Christmas break.
  const weeks = {};
  for (let i = 0; i < 12; i++) weeks[addDays("2026-09-21", i * 7)] = 5;
  weeks["2026-10-26"] = 0;
  for (let i = 0; i < 12; i++) weeks[addDays("2027-01-25", i * 7)] = 4;

  it("splits the year into terms, keeping short breaks like reading week inside a term", () => {
    expect(terms(weeks)).toEqual([
      { first: "2026-09-21", last: "2026-12-07" },
      { first: "2027-01-25", last: "2027-04-12" },
    ]);
  });

  it.each([
    ["2026-09-21", "Week 1 of 12"],
    ["2026-10-19", "Week 5 of 12"],
    ["2026-10-26", "Week 6 of 12 · no classes"],
    ["2026-12-07", "Week 12 of 12"],
    ["2026-09-07", "Classes start in 2 weeks"],
    ["2026-09-14", "Classes start next week"],
    ["2027-01-04", "Classes start in 3 weeks"],
    ["2027-05-03", "Term finished"],
  ])("week of %s is %s", (monday, label) => {
    expect(weekLabel(weeks, monday)).toBe(label);
  });

  it("returns nothing when there are no week counts", () => {
    expect(weekLabel(undefined, "2026-09-21")).toBe("");
    expect(weekLabel({}, "2026-09-21")).toBe("");
  });
});

describe("filterClasses (my classes and friends' classes)", () => {
  const classes = [
    { title: "Networks", group: "A" },
    { title: "Networks", group: "B" },
    { title: "Databases", group: "" },
    { title: "Cloud", group: "" },
  ];

  it("shows everything when nothing is chosen", () => {
    expect(filterClasses(classes)).toEqual(classes);
    expect(filterClasses(undefined)).toEqual([]);
  });

  it("keeps only the chosen group, and classes with no group", () => {
    expect(filterClasses(classes, { Networks: "B" }).map((c) => c.group || c.title)).toEqual([
      "B",
      "Databases",
      "Cloud",
    ]);
  });

  it("drops hidden modules, given as an array or a Set", () => {
    expect(filterClasses(classes, {}, ["Cloud"]).map((c) => c.title)).toEqual(["Networks", "Networks", "Databases"]);
    expect(filterClasses(classes, {}, new Set(["Networks"])).map((c) => c.title)).toEqual(["Databases", "Cloud"]);
  });
});

describe("classesInCommon", () => {
  const lecture = { title: "Networks", start: "2026-09-21T08:00:00.000Z" };
  const lab = { title: "Databases", start: "2026-09-21T13:00:00.000Z" };
  const tomorrow = { title: "Networks", start: "2026-09-22T08:00:00.000Z" };

  it("finds my classes on that day that every friend is also in", () => {
    const alex = [lecture, lab];
    const sam = [{ ...lecture }];
    expect(classesInCommon([lecture, lab, tomorrow], [alex, sam], "2026-09-21")).toEqual([lecture]);
  });

  it("needs at least one friend", () => {
    expect(classesInCommon([lecture], [], "2026-09-21")).toEqual([]);
  });

  it("doesn't match the same module at a different time", () => {
    expect(
      classesInCommon([lecture], [[{ title: "Networks", start: "2026-09-21T09:00:00.000Z" }]], "2026-09-21"),
    ).toEqual([]);
  });
});
