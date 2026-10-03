import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanClass, extractClasses, groupChoicesFrom } from "../src/timetable.js";

const fixture = readFileSync(new URL("./fixtures/scientia-sample.ics", import.meta.url), "utf8");
const TZ = "Europe/Dublin";
const TERM = [new Date("2026-09-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")];

// A calendar with one or more events, each given as a list of property lines.
const calendar = (...events) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");

const extract = (ics, from = TERM[0], to = TERM[1]) => extractClasses(ics, TZ, from, to);
const on = (classes, date) => classes.filter((c) => c.start.startsWith(date));

describe("extractClasses with the Scientia fixture", () => {
  const classes = extract(fixture);

  it("finds every class in term: 11 teaching weeks of 5 classes, minus 1 cancelled", () => {
    expect(classes).toHaveLength(54);
  });

  it("returns cleaned classes with ISO start and end times", () => {
    expect(classes[0]).toEqual({
      id: "synthetic-cmpu3036-lec@example.ie|2026-09-21T08:00:00.000Z",
      title: "Mobile Software Development",
      type: "Lecture",
      group: "",
      code: "CMPU 3036",
      room: "CQ-408 · Large Classroom 11",
      mapUrl: "https://link.mazemap.com/AbCd1234",
      start: "2026-09-21T08:00:00.000Z",
      end: "2026-09-21T09:00:00.000Z",
    });
  });

  it("returns classes sorted by start time", () => {
    const starts = classes.map((c) => c.start);
    expect(starts).toEqual([...starts].sort());
  });

  it("expands weekly repeats on the right weekdays until UNTIL", () => {
    const lectures = classes.filter((c) => c.title === "Mobile Software Development" && c.type === "Lecture");
    expect(lectures).toHaveLength(11);
    expect(lectures.every((c) => new Date(c.start).getUTCDay() === 1)).toBe(true); // Mondays
    expect(lectures.at(-1).start).toBe("2026-12-07T09:00:00.000Z");
  });

  it("keeps the same wall-clock time across the October clock change", () => {
    // 09:00 Dublin time is 08:00 UTC in summer time and 09:00 UTC in winter.
    expect(on(classes, "2026-10-19")[0].start).toBe("2026-10-19T08:00:00.000Z");
    expect(on(classes, "2026-11-02")[0].start).toBe("2026-11-02T09:00:00.000Z");
  });

  it("skips reading week (EXDATE) and ignores the all-day Reading Week entry", () => {
    const readingWeek = classes.filter((c) => c.start >= "2026-10-26" && c.start < "2026-11-01");
    expect(readingWeek).toEqual([]);
    expect(classes.some((c) => /reading week/i.test(c.title))).toBe(false);
  });

  it("applies a RECURRENCE-ID override: the moved tutorial appears once, at its new time and room", () => {
    const tutorials = classes.filter((c) => c.title === "Databases");
    expect(on(tutorials, "2026-10-07")).toEqual([]); // the original Wednesday slot is gone
    expect(on(tutorials, "2026-10-08")).toMatchObject([
      { start: "2026-10-08T15:00:00.000Z", end: "2026-10-08T16:00:00.000Z", room: "CQ-311 · Classroom" },
    ]);
  });

  it("drops a cancelled occurrence (RECURRENCE-ID with STATUS:CANCELLED)", () => {
    expect(on(classes, "2026-11-18")).toEqual([]);
    expect(classes.filter((c) => c.title === "Databases")).toHaveLength(10);
  });

  it("keeps both lab groups and merges group A's back-to-back slots into one class", () => {
    const labs = on(classes, "2026-09-22");
    expect(labs).toMatchObject([
      { group: "A", start: "2026-09-22T09:00:00.000Z", end: "2026-09-22T11:00:00.000Z" },
      { group: "B", start: "2026-09-22T09:00:00.000Z", end: "2026-09-22T11:00:00.000Z" },
    ]);
  });

  it("only returns classes overlapping the requested range", () => {
    const week = extract(fixture, new Date("2026-10-05T00:00:00Z"), new Date("2026-10-10T00:00:00Z"));
    expect(week.map((c) => c.start.slice(0, 10))).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-06",
      "2026-10-08",
      "2026-10-08",
    ]);
  });
});

describe("extractClasses with repeat rules", () => {
  const weekly = (rule, extra = []) =>
    calendar([
      "UID:r1",
      "DTSTART;TZID=Europe/Dublin:20260921T100000",
      "DTEND;TZID=Europe/Dublin:20260921T110000",
      `RRULE:${rule}`,
      "SUMMARY:Algorithms Lecture",
      ...extra,
    ]);
  const dates = (classes) => classes.map((c) => c.start.slice(0, 10));

  it("stops after COUNT occurrences", () => {
    expect(dates(extract(weekly("FREQ=WEEKLY;COUNT=3")))).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
  });

  it("honours INTERVAL (every second week)", () => {
    expect(dates(extract(weekly("FREQ=WEEKLY;INTERVAL=2;COUNT=3")))).toEqual([
      "2026-09-21",
      "2026-10-05",
      "2026-10-19",
    ]);
  });

  it("expands several BYDAY days", () => {
    expect(dates(extract(weekly("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4")))).toEqual([
      "2026-09-21",
      "2026-09-23",
      "2026-09-28",
      "2026-09-30",
    ]);
  });

  it("expands DAILY rules", () => {
    expect(dates(extract(weekly("FREQ=DAILY;COUNT=3")))).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
  });

  it("accepts a date-only UNTIL (inclusive)", () => {
    expect(dates(extract(weekly("FREQ=WEEKLY;UNTIL=20261005")))).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
  });

  it("skips EXDATEs", () => {
    const classes = extract(weekly("FREQ=WEEKLY;COUNT=3", ["EXDATE;TZID=Europe/Dublin:20260928T100000"]));
    expect(dates(classes)).toEqual(["2026-09-21", "2026-10-05"]);
  });

  it("uses DURATION when there is no DTEND, and one hour when there's neither", () => {
    const [withDuration] = extract(
      calendar(["UID:d1", "DTSTART:20260921T090000Z", "DURATION:PT1H30M", "SUMMARY:Physics Lab"]),
    );
    expect(withDuration.end).toBe("2026-09-21T10:30:00.000Z");
    const [noEnd] = extract(calendar(["UID:d2", "DTSTART:20260921T090000Z", "SUMMARY:Physics Lab"]));
    expect(noEnd.end).toBe("2026-09-21T10:00:00.000Z");
  });

  it("drops a whole repeating class marked STATUS:CANCELLED", () => {
    expect(extract(weekly("FREQ=WEEKLY;COUNT=3", ["STATUS:CANCELLED"]))).toEqual([]);
  });

  it("drops events with no DTSTART and all-day events", () => {
    const ics = calendar(["UID:x1", "SUMMARY:No time"], ["UID:x2", "DTSTART;VALUE=DATE:20260921", "SUMMARY:Holiday"]);
    expect(extract(ics)).toEqual([]);
  });

  it("drops one-off events far outside the range", () => {
    const ics = calendar(
      ["UID:old", "DTSTART:20200921T090000Z", "DTEND:20200921T100000Z", "SUMMARY:Old"],
      ["UID:new", "DTSTART:20260921T090000Z", "DTEND:20260921T100000Z", "SUMMARY:New"],
    );
    expect(extract(ics).map((c) => c.title)).toEqual(["New"]);
  });
});

describe("back-to-back merge", () => {
  const slot = (uid, start, end, summary = "Networks Lab", location = "CQ-227") => [
    `UID:${uid}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
  ];

  it("joins slots of the same class that touch", () => {
    const classes = extract(
      calendar(
        slot("a", "20260921T090000Z", "20260921T100000Z"),
        slot("b", "20260921T100000Z", "20260921T110000Z"),
        slot("c", "20260921T110000Z", "20260921T120000Z"),
      ),
    );
    expect(classes).toMatchObject([{ start: "2026-09-21T09:00:00.000Z", end: "2026-09-21T12:00:00.000Z" }]);
  });

  it("doesn't join slots with a gap between them", () => {
    const classes = extract(
      calendar(slot("a", "20260921T090000Z", "20260921T100000Z"), slot("b", "20260921T101000Z", "20260921T110000Z")),
    );
    expect(classes).toHaveLength(2);
  });

  it("doesn't join different classes, rooms or groups", () => {
    const classes = extract(
      calendar(
        slot("a", "20260921T090000Z", "20260921T100000Z", "Networks Lab"),
        slot("b", "20260921T100000Z", "20260921T110000Z", "Databases Lab"),
        slot("c", "20260921T110000Z", "20260921T120000Z", "Databases Lab", "CQ-228"),
        slot("d", "20260921T120000Z", "20260921T130000Z", "Databases Lab Group B", "CQ-228"),
      ),
    );
    expect(classes).toHaveLength(4);
  });
});

describe("cleanClass", () => {
  it.each([
    [
      "Scientia: code, title, type, semester and group",
      ["CMPU 3036(22519C)/Mobile Software Development/Lab/Sem1/D", "CQ-227 Specialist Computer Lab 3 (25)", ""],
      {
        title: "Mobile Software Development",
        type: "Lab",
        group: "D",
        code: "CMPU 3036",
        room: "CQ-227 · Specialist Computer Lab 3",
      },
    ],
    [
      "dash-separated with a compact module code",
      ["COMP10110 - Computer Science I - Lecture", "Room B204", ""],
      { title: "Computer Science I", type: "Lecture", group: "", code: "COMP10110", room: "Room B204" },
    ],
    [
      "bracketed code and inline 'Group 2'",
      ["[NET201] Networks Tutorial Group 2", "E2-110", ""],
      { title: "Networks", type: "Tutorial", group: "2", room: "E2-110" },
    ],
    [
      "'(Grp A)' and week ranges",
      ["Databases Lecture (Grp A) Weeks 1-6, 8-12", "", ""],
      { title: "Databases", type: "Lecture", group: "A" },
    ],
    [
      "stray $ signs and an 'A1' group",
      ["$CMPU 2007$/Databases I/Tutorial/S1/A1", "Q-013", ""],
      { title: "Databases I", type: "Tutorial", group: "A1", code: "CMPU 2007" },
    ],
    [
      "pipe-separated with 'Wks'",
      ["BUS-2002 | Marketing | Seminar | Wks 1-12", "", ""],
      { title: "Marketing", type: "Seminar", code: "BUS-2002" },
    ],
    [
      "numeric section numbers are dropped",
      ["CMPU 3025(22520C)/Cloud Computing/Lecture/Sem1/01", "E2-110 Lecture Theatre (120)", ""],
      { title: "Cloud Computing", group: "", room: "E2-110 · Lecture Theatre" },
    ],
    [
      "exam words stay in the title",
      ["CMPU 4001/Databases/Exam", "Main Hall", ""],
      { title: "Databases – Exam", type: "Exam" },
    ],
    [
      "plain titles pass through",
      ["Careers Fair", "Student Union", ""],
      { title: "Careers Fair", type: "", group: "", code: "", room: "Student Union" },
    ],
  ])("%s", (_, args, expected) => {
    expect(cleanClass(...args)).toMatchObject(expected);
  });

  it("reads title, type, room and map link from the description when the summary has none", () => {
    const description = [
      "Module Name: CMPU 2001 Software Testing",
      "Activity Type: Practical",
      "Room: CQ-LG21 Basement Lab (30)",
      "Map: https://maps.app.goo.gl/xyz123 (opens Google Maps)",
    ].join("\n");
    expect(cleanClass("", "", description)).toEqual({
      title: "Software Testing",
      type: "Lab",
      group: "",
      code: "",
      room: "CQ-LG21 · Basement Lab",
      mapUrl: "https://maps.app.goo.gl/xyz123",
    });
  });

  it("cleans rooms: drops capacity, keeps the code and the last name after ' / '", () => {
    expect(cleanClass("x", "CQ-408 Small Lecture Room / Large Classroom 11 (60)", "").room).toBe(
      "CQ-408 · Large Classroom 11",
    );
    expect(cleanClass("x", "Q-013", "").room).toBe("Q-013");
    expect(cleanClass("x", "Main Hall (300)", "").room).toBe("Main Hall");
  });
});

describe("groupChoicesFrom", () => {
  it("lists modules taught to more than one group, sorted", () => {
    const classes = [
      { title: "Networks", group: "B" },
      { title: "Networks", group: "A" },
      { title: "Networks", group: "A" },
      { title: "Databases", group: "C" }, // only one group: nothing to choose
      { title: "Algorithms", group: "2" },
      { title: "Algorithms", group: "1" },
      { title: "Cloud", group: "" },
    ];
    expect(groupChoicesFrom(classes)).toEqual([
      { title: "Algorithms", groups: ["1", "2"] },
      { title: "Networks", groups: ["A", "B"] },
    ]);
  });

  it("finds the Lab A/B choice in the fixture", () => {
    expect(groupChoicesFrom(extract(fixture))).toEqual([{ title: "Mobile Software Development", groups: ["A", "B"] }]);
  });
});
