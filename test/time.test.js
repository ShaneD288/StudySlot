import { describe, expect, it } from "vitest";
import { isValidTimeZone, localToUtc, utcToLocal } from "../src/time.js";

const DUBLIN = "Europe/Dublin";
const utc = (local, zone = DUBLIN) => localToUtc(local, zone).toISOString();

// Ireland: clocks go forward at 01:00 GMT on the last Sunday in March (to 02:00 IST, UTC+1)
// and back at 02:00 IST on the last Sunday in October (to 01:00 GMT, UTC+0).
describe("localToUtc in Europe/Dublin", () => {
  it("uses UTC+0 in winter and UTC+1 in summer", () => {
    expect(utc("2026-01-15T09:00")).toBe("2026-01-15T09:00:00.000Z");
    expect(utc("2026-07-15T09:00")).toBe("2026-07-15T08:00:00.000Z");
  });

  it("switches on the last Sunday in March (29 March 2026)", () => {
    expect(utc("2026-03-28T09:00")).toBe("2026-03-28T09:00:00.000Z"); // Saturday, still GMT
    expect(utc("2026-03-29T00:30")).toBe("2026-03-29T00:30:00.000Z"); // before the change
    expect(utc("2026-03-29T02:00")).toBe("2026-03-29T01:00:00.000Z"); // first minute of IST
    expect(utc("2026-03-29T09:00")).toBe("2026-03-29T08:00:00.000Z");
  });

  it("moves a time that doesn't exist (skipped hour in March) forward an hour", () => {
    // 01:30 never happens on 29 March; it's read as 02:30 IST.
    expect(utc("2026-03-29T01:30")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("switches on the last Sunday in October (25 October 2026)", () => {
    expect(utc("2026-10-24T09:00")).toBe("2026-10-24T08:00:00.000Z"); // Saturday, still IST
    expect(utc("2026-10-25T00:30")).toBe("2026-10-24T23:30:00.000Z"); // before the change
    expect(utc("2026-10-25T02:00")).toBe("2026-10-25T02:00:00.000Z"); // GMT
    expect(utc("2026-10-26T09:00")).toBe("2026-10-26T09:00:00.000Z"); // Monday after
  });

  it("reads a time that happens twice (repeated hour in October) as the later, GMT one", () => {
    expect(utc("2026-10-25T01:30")).toBe("2026-10-25T01:30:00.000Z");
  });

  it("uses the right last Sunday in other years", () => {
    expect(utc("2027-03-27T09:00")).toBe("2027-03-27T09:00:00.000Z"); // Saturday before
    expect(utc("2027-03-28T09:00")).toBe("2027-03-28T08:00:00.000Z"); // 28 March 2027
    expect(utc("2027-10-30T09:00")).toBe("2027-10-30T08:00:00.000Z"); // Saturday before
    expect(utc("2027-10-31T09:00")).toBe("2027-10-31T09:00:00.000Z"); // 31 October 2027
  });

  it("accepts seconds and a missing time", () => {
    expect(utc("2026-07-15T09:00:30")).toBe("2026-07-15T08:00:30.000Z");
    expect(utc("2026-07-15")).toBe("2026-07-14T23:00:00.000Z");
  });

  it("works for other zones", () => {
    expect(utc("2026-07-15T09:00", "UTC")).toBe("2026-07-15T09:00:00.000Z");
    expect(utc("2026-07-15T09:00", "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
    expect(utc("2026-07-15T09:00", "Asia/Kolkata")).toBe("2026-07-15T03:30:00.000Z");
  });
});

describe("utcToLocal", () => {
  it("formats an instant as local wall-clock time", () => {
    expect(utcToLocal(new Date("2026-07-15T08:00:00Z"), DUBLIN)).toBe("2026-07-15T09:00");
    expect(utcToLocal(new Date("2026-01-15T09:00:00Z"), DUBLIN)).toBe("2026-01-15T09:00");
  });

  it("shows the repeated hour twice on the October change", () => {
    expect(utcToLocal(new Date("2026-10-25T00:30:00Z"), DUBLIN)).toBe("2026-10-25T01:30"); // IST
    expect(utcToLocal(new Date("2026-10-25T01:30:00Z"), DUBLIN)).toBe("2026-10-25T01:30"); // GMT
  });

  it("round-trips with localToUtc for ordinary times", () => {
    for (const local of ["2026-03-30T09:00", "2026-09-21T14:15", "2026-12-01T18:45"]) {
      expect(utcToLocal(localToUtc(local, DUBLIN), DUBLIN)).toBe(local);
    }
  });
});

describe("invalid time zones", () => {
  it("isValidTimeZone accepts IANA names and rejects anything else", () => {
    expect(isValidTimeZone("Europe/Dublin")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("GMT Standard Time")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("localToUtc and utcToLocal throw a RangeError for an unknown zone", () => {
    expect(() => localToUtc("2026-07-15T09:00", "Mars/Olympus_Mons")).toThrow(RangeError);
    expect(() => utcToLocal(new Date(), "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});
