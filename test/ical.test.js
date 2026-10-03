import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eventText, ianaZone, parseDuration, parseEvents, readTime } from "../src/ical.js";

const fixture = readFileSync(new URL("./fixtures/scientia-sample.ics", import.meta.url), "utf8");

// Wraps VEVENT lines in a calendar, joined with CRLF like real files.
const calendar = (...eventLines) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", ...eventLines, "END:VEVENT", "END:VCALENDAR"].join("\r\n");

describe("parseEvents", () => {
  it("reads every VEVENT in the fixture", () => {
    const events = parseEvents(fixture);
    expect(events).toHaveLength(9);
    expect(events[0].UID.value).toBe("synthetic-cmpu3036-lec@example.ie");
  });

  it("splits a property into name, parameters and value", () => {
    const [event] = parseEvents(calendar("DTSTART;TZID=Europe/Dublin:20260921T090000"));
    expect(event.DTSTART).toEqual({ name: "DTSTART", params: { TZID: "Europe/Dublin" }, value: "20260921T090000" });
  });

  it("keeps colons inside quoted parameters and in the value", () => {
    const [event] = parseEvents(
      calendar('DTSTART;TZID="/mozilla.org/Europe:Dublin":20260921T090000', "URL:https://example.ie/a"),
    );
    expect(event.DTSTART.params.TZID).toBe("/mozilla.org/Europe:Dublin");
    expect(event.DTSTART.value).toBe("20260921T090000");
    expect(event.URL.value).toBe("https://example.ie/a");
  });

  it("upper-cases property and parameter names", () => {
    const [event] = parseEvents(calendar("dtstart;tzid=Europe/Dublin:20260921T090000"));
    expect(event.DTSTART.params.TZID).toBe("Europe/Dublin");
  });

  it("unfolds long lines (CRLF or LF followed by a space or tab)", () => {
    const crlf = parseEvents(calendar("SUMMARY:Mobile Soft", " ware Development"));
    expect(crlf[0].SUMMARY.value).toBe("Mobile Software Development");
    const lf = parseEvents("BEGIN:VEVENT\nSUMMARY:Cloud\n\t Computing\nEND:VEVENT\n");
    expect(lf[0].SUMMARY.value).toBe("Cloud Computing");
  });

  it("ignores properties inside nested components such as VALARM", () => {
    const [event] = parseEvents(fixture);
    // The VALARM's DESCRIPTION is "Reminder"; the event's own description must win.
    expect(eventText(event, "DESCRIPTION")).toMatch(/^Module: Mobile Software Development/);
    expect(event.TRIGGER).toBeUndefined();
    expect(event.ACTION).toBeUndefined();
  });

  it("merges EXDATE lines that are split over several properties", () => {
    const [event] = parseEvents(calendar("EXDATE:20261026T090000Z", "EXDATE:20261102T090000Z,20261109T090000Z"));
    expect(event.EXDATE.value).toBe("20261026T090000Z,20261102T090000Z,20261109T090000Z");
  });

  it("keeps the first value when a property appears twice", () => {
    const [event] = parseEvents(calendar("SUMMARY:First", "SUMMARY:Second"));
    expect(event.SUMMARY.value).toBe("First");
  });

  it("ignores lines outside VEVENTs and returns nothing for an empty calendar", () => {
    expect(parseEvents("BEGIN:VCALENDAR\r\nX-WR-CALNAME:Empty\r\nEND:VCALENDAR")).toEqual([]);
    expect(parseEvents("")).toEqual([]);
  });
});

describe("eventText", () => {
  it("unescapes commas, semicolons, backslashes and newlines", () => {
    const [event] = parseEvents(calendar(String.raw`DESCRIPTION:Room A\, Floor 2\; East\nLine two\Nthree \\ done`));
    expect(eventText(event, "DESCRIPTION")).toBe("Room A, Floor 2; East\nLine two\nthree \\ done");
  });

  it("unescapes text that was folded across lines", () => {
    const [event] = parseEvents(fixture);
    expect(eventText(event, "DESCRIPTION")).toBe(
      "Module: Mobile Software Development\nLecturer: Dr. A. Example, School of Computer Science\nMap: https://link.mazemap.com/AbCd1234",
    );
  });

  it("returns an empty string for a missing property", () => {
    const [event] = parseEvents(calendar("SUMMARY:x"));
    expect(eventText(event, "LOCATION")).toBe("");
  });
});

describe("readTime", () => {
  const prop = (value, params = {}) => ({ value, params });

  it("reads all-day dates", () => {
    expect(readTime(prop("20261026", { VALUE: "DATE" }), "UTC")).toEqual({ allDay: true, date: "2026-10-26" });
    expect(readTime(prop("20261026"), "UTC")).toEqual({ allDay: true, date: "2026-10-26" });
  });

  it("reads UTC times ending in Z", () => {
    expect(readTime(prop("20260921T080000Z"), "Europe/Dublin").instant.toISOString()).toBe("2026-09-21T08:00:00.000Z");
  });

  it("converts local times using TZID (summer time in Dublin is UTC+1)", () => {
    const time = readTime(prop("20260921T090000", { TZID: "Europe/Dublin" }), "UTC");
    expect(time).toEqual({ allDay: false, instant: new Date("2026-09-21T08:00:00Z") });
  });

  it("converts local times using TZID (winter time in Dublin is UTC+0)", () => {
    const time = readTime(prop("20261102T090000", { TZID: "Europe/Dublin" }), "UTC");
    expect(time.instant.toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });

  it("uses the fallback time zone for floating times with no TZID", () => {
    expect(readTime(prop("20260921T090000"), "Europe/Dublin").instant.toISOString()).toBe("2026-09-21T08:00:00.000Z");
    expect(readTime(prop("20260921T090000"), "America/New_York").instant.toISOString()).toBe(
      "2026-09-21T13:00:00.000Z",
    );
  });

  it("treats missing seconds on a floating time as zero", () => {
    expect(readTime(prop("20260921T0930"), "UTC").instant.toISOString()).toBe("2026-09-21T09:30:00.000Z");
  });
});

describe("parseDuration", () => {
  it.each([
    ["PT1H", 3600000],
    ["PT1H30M", 5400000],
    ["PT45M", 2700000],
    ["PT90S", 90000],
    ["P1D", 86400000],
    ["P1W", 604800000],
    ["P1DT2H", 93600000],
    ["-PT15M", -900000],
    ["+PT15M", 900000],
  ])("%s is %d ms", (value, ms) => {
    expect(parseDuration(value)).toBe(ms);
  });

  it("returns 0 for something that isn't a duration", () => {
    expect(parseDuration("one hour")).toBe(0);
    expect(parseDuration("")).toBe(0);
  });
});

describe("ianaZone", () => {
  it("keeps valid IANA names", () => {
    expect(ianaZone("Europe/Dublin", "UTC")).toBe("Europe/Dublin");
  });

  it("maps Windows time zone names from Outlook and Exchange", () => {
    expect(ianaZone("GMT Standard Time", "UTC")).toBe("Europe/London");
    expect(ianaZone("W. Europe Standard Time", "UTC")).toBe("Europe/Berlin");
  });

  it("recognises Outlook display labels that mention Dublin", () => {
    expect(ianaZone("(UTC+00:00) Dublin, Edinburgh, Lisbon, London", "UTC")).toBe("Europe/London");
  });

  it("strips prefixes such as /mozilla.org/…/", () => {
    expect(ianaZone("/mozilla.org/20070129_1/Europe/Paris", "UTC")).toBe("Europe/Paris");
  });

  it("falls back for missing or unknown zones", () => {
    expect(ianaZone(undefined, "Europe/Dublin")).toBe("Europe/Dublin");
    expect(ianaZone("Not A Zone", "Europe/Dublin")).toBe("Europe/Dublin");
    // The cached "unknown" result still uses the caller's fallback.
    expect(ianaZone("Not A Zone", "Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});
