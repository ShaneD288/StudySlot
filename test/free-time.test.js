import { describe, expect, it } from "vitest";
import { freeTogether } from "../public/lib/free-time.js";

// Runs with TZ=Europe/Dublin (see vitest.config.js). Times below are Dublin wall-clock times.
const DAY = "2026-09-22"; // a Tuesday in Irish summer time (UTC+1)
const at = (time, day = DAY) => new Date(`${day}T${time}:00`); // local time
const cls = (from, to, day = DAY) => ({ start: at(from, day).toISOString(), end: at(to, day).toISOString() });
// Free windows as readable "HH:MM-HH:MM" strings.
const free = (lists, day = DAY) =>
  freeTogether(day, lists).map(([a, b]) => [a, b].map((ms) => new Date(ms).toTimeString().slice(0, 5)).join("-"));

describe("freeTogether", () => {
  it("returns the whole 9:00-18:00 window when nobody has classes", () => {
    expect(free([])).toEqual(["09:00-18:00"]);
    expect(free([[], []])).toEqual(["09:00-18:00"]);
  });

  it("returns times as epoch milliseconds", () => {
    expect(freeTogether(DAY, [])).toEqual([[+at("09:00"), +at("18:00")]]);
  });

  it("finds the gaps around one person's classes", () => {
    expect(free([[cls("10:00", "11:00"), cls("14:00", "16:00")]])).toEqual([
      "09:00-10:00",
      "11:00-14:00",
      "16:00-18:00",
    ]);
  });

  it("treats back-to-back classes as one busy block", () => {
    expect(free([[cls("10:00", "11:00"), cls("11:00", "12:00"), cls("12:00", "13:00")]])).toEqual([
      "09:00-10:00",
      "13:00-18:00",
    ]);
  });

  it("combines overlapping classes across friends", () => {
    const me = [cls("09:00", "11:00"), cls("15:00", "16:00")];
    const alex = [cls("10:00", "12:00")];
    const sam = [cls("11:30", "13:00"), cls("15:30", "17:00")];
    expect(free([me, alex, sam])).toEqual(["13:00-15:00", "17:00-18:00"]);
  });

  it("handles a class inside another (a short tutorial during a long lab)", () => {
    expect(free([[cls("10:00", "14:00")], [cls("11:00", "12:00")]])).toEqual(["09:00-10:00", "14:00-18:00"]);
  });

  it("works whatever order the classes come in", () => {
    expect(free([[cls("14:00", "15:00"), cls("10:00", "11:00")]])).toEqual([
      "09:00-10:00",
      "11:00-14:00",
      "15:00-18:00",
    ]);
  });

  it("clips classes that run outside 9:00-18:00", () => {
    expect(free([[cls("08:00", "10:00"), cls("17:00", "19:00")]])).toEqual(["10:00-17:00"]);
  });

  it("ignores classes entirely outside 9:00-18:00", () => {
    expect(free([[cls("07:00", "08:30"), cls("18:00", "20:00")]])).toEqual(["09:00-18:00"]);
  });

  it("has no free time when classes cover the whole day", () => {
    expect(free([[cls("08:00", "13:00")], [cls("13:00", "19:00")]])).toEqual([]);
  });

  it("drops gaps under 30 minutes but keeps exactly 30", () => {
    expect(free([[cls("09:20", "12:00"), cls("12:29", "17:30")]])).toEqual(["17:30-18:00"]);
    expect(free([[cls("09:30", "12:00"), cls("12:30", "17:31")]])).toEqual(["09:00-09:30", "12:00-12:30"]);
  });

  it("only counts classes on the chosen day", () => {
    const yesterday = cls("10:00", "17:00", "2026-09-21");
    const tomorrow = cls("09:00", "18:00", "2026-09-23");
    expect(free([[yesterday, tomorrow, cls("12:00", "13:00")]])).toEqual(["09:00-12:00", "13:00-18:00"]);
  });

  it("uses local time on the day the clocks go back (25 October 2026)", () => {
    // Clocks change at 02:00, so 9:00-18:00 local is 09:00-18:00 UTC that day.
    const day = "2026-10-25";
    expect(freeTogether(day, [])).toEqual([[Date.parse("2026-10-25T09:00:00Z"), Date.parse("2026-10-25T18:00:00Z")]]);
    expect(free([[cls("12:00", "13:00", day)]], day)).toEqual(["09:00-12:00", "13:00-18:00"]);
  });
});
