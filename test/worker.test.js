import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

// The Worker runs in Node here: global fetch is replaced by a mock so no real college
// server is contacted, and the clock is fixed in the middle of the fixture's term.
const fixture = readFileSync(new URL("./fixtures/scientia-sample.ics", import.meta.url), "utf8");
const LINK = "https://timetable.example.ie/ical/abc123.ics";

const env = (overrides = {}) => ({
  ASSETS: { fetch: vi.fn(async () => new Response("static asset")) },
  ...overrides,
});
const get = (path, e = env()) => worker.fetch(new Request(`https://studyslot.test${path}`), e);
const api = (link, tz = "Europe/Dublin") =>
  get(`/api/timetable?link=${encodeURIComponent(link)}&tz=${encodeURIComponent(tz)}`);

let upstream;
const respondWith = (body, init = {}) => upstream.mockResolvedValue(new Response(body, init));

beforeEach(() => {
  upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GET /api/timetable: link checks", () => {
  it.each([
    ["a password in the link", "https://student:secret@timetable.example.ie/a.ics"],
    ["a raw IPv4 address", "https://192.168.1.10/a.ics"],
    ["a raw IPv6 address", "https://[::1]/a.ics"],
    ["an unusual port", "https://timetable.example.ie:8443/a.ics"],
    ["ftp://", "ftp://timetable.example.ie/a.ics"],
    ["file://", "file:///etc/passwd"],
    ["javascript:", "javascript:alert(1)"],
    ["a host with no dot", "https://localhost/a.ics"],
    ["text that isn't a link", "my timetable"],
    ["an empty link", ""],
    ["a very long link", `https://timetable.example.ie/${"a".repeat(2000)}.ics`],
  ])("rejects %s without fetching it", async (_, link) => {
    const res = await api(link);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/doesn't look like a calendar link/);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("turns webcal:// into https:// before fetching", async () => {
    respondWith(fixture);
    const res = await api("webcal://timetable.example.ie/ical/abc123.ics");
    expect(res.status).toBe(200);
    expect(upstream.mock.calls[0][0]).toBe(LINK);
  });

  it("rejects an unknown time zone", async () => {
    const res = await api(LINK, "Mars/Olympus_Mons");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown time zone." });
  });
});

describe("GET /api/timetable: what the college server sends back", () => {
  it("explains when the link opens a web page instead of a calendar", async () => {
    respondWith("<!doctype html><html><body>Log in</body></html>", { headers: { "Content-Type": "text/html" } });
    const res = await api(LINK);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/opened a web page, not a calendar/);
  });

  it("rejects calendars over 6 MB from the Content-Length header", async () => {
    respondWith("BEGIN:VCALENDAR", { headers: { "Content-Length": String(7 * 1024 * 1024) } });
    const res = await api(LINK);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("That calendar is too large to read.");
  });

  it("rejects calendars over 6 MB with no Content-Length header", async () => {
    respondWith("BEGIN:VCALENDAR\r\n" + "X".repeat(6 * 1024 * 1024 + 1));
    const res = await api(LINK);
    expect(res.status).toBe(413);
  });

  it.each([404, 410])("says the link no longer works on %d", async (status) => {
    respondWith("gone", { status });
    const res = await api(LINK);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/no longer works/);
  });

  it("passes on other server errors", async () => {
    respondWith("oops", { status: 500 });
    const res = await api(LINK);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/returned an error \(500\)/);
  });

  it("explains when the server can't be reached", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    const res = await api(LINK);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Couldn't reach that link/);
  });
});

describe("GET /api/timetable: a valid link", () => {
  it("returns the cleaned classes, group choices and week counts", async () => {
    respondWith(fixture);
    const res = await api(LINK);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.name).toBe("Alex Example");
    expect(body.fetchedAt).toBe("2026-10-01T12:00:00.000Z");
    // From a week before "now" to the end of term.
    expect(body.classes[0].start).toBe("2026-09-28T08:00:00.000Z");
    expect(body.classes.at(-1).start).toBe("2026-12-10T12:00:00.000Z");
    expect(body.classes[0]).toMatchObject({ title: "Mobile Software Development", type: "Lecture" });
    expect(body.groupChoices).toEqual([{ title: "Mobile Software Development", groups: ["A", "B"] }]);
    expect(body.weeks["2026-09-21"]).toBe(5);
    expect(body.weeks["2026-10-26"]).toBeUndefined(); // reading week
    expect(body.weeks["2026-11-16"]).toBe(4); // the cancelled tutorial
    expect(body.totalEntries).toBeUndefined();
  });

  it("asks the college server for a calendar, with a timeout", async () => {
    respondWith(fixture);
    await api(LINK);
    const [, init] = upstream.mock.calls[0];
    expect(init.headers.Accept).toMatch(/text\/calendar/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports how many entries there were when none are classes", async () => {
    respondWith("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261001\r\nEND:VEVENT\r\nEND:VCALENDAR");
    const body = await (await api(LINK)).json();
    expect(body.classes).toEqual([]);
    expect(body.totalEntries).toBe(1);
  });
});

describe("rate limiting and routing", () => {
  it("returns 429 when a visitor goes over the API limit", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const e = env({ API_LIMITER: { limit } });
    const req = new Request(`https://studyslot.test/api/timetable?link=${encodeURIComponent(LINK)}`, {
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
    const res = await worker.fetch(req, e);
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("serves everything else from static assets", async () => {
    const e = env();
    const res = await get("/privacy", e);
    expect(await res.text()).toBe("static asset");
    expect(e.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("doesn't treat POST /api/timetable as an API call", async () => {
    const e = env();
    await worker.fetch(new Request("https://studyslot.test/api/timetable", { method: "POST" }), e);
    expect(e.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});

describe("GET /feed/<token>.ics", () => {
  const base64Token = (settings) => Buffer.from(JSON.stringify(settings)).toString("base64url");

  it("serves a cleaned calendar with the chosen group and without hidden modules", async () => {
    respondWith(fixture);
    const token = base64Token({
      l: LINK,
      g: { "Mobile Software Development": "A" },
      h: ["Cloud Computing"],
      z: "Europe/Dublin",
      n: "Alex",
    });
    const res = await get(`/feed/${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    const ics = (await res.text()).replace(/\r\n /g, "");
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("X-WR-CALNAME:Studyslot · Alex");
    expect(ics).toContain("SUMMARY:Mobile Software Development · Lab");
    expect(ics).toContain("LOCATION:CQ-227 · Specialist Computer Lab 3");
    expect(ics).not.toContain("CQ-228"); // group B's lab
    expect(ics).not.toContain("Cloud Computing");
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(upstream.mock.calls[0][0]).toBe(LINK);
  });

  it("rejects a token that isn't valid", async () => {
    const res = await get("/feed/not-a-real-token.ics");
    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a token whose link fails the link checks", async () => {
    const res = await get(`/feed/${base64Token({ l: "https://192.168.1.10/a.ics" })}.ics`);
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("asks calendar apps to retry later when the college server fails", async () => {
    respondWith("gone", { status: 404 });
    const res = await get(`/feed/${base64Token({ l: LINK })}.ics`);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("3600");
  });

  it("returns 429 when a feed goes over its limit", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const res = await get(`/feed/${base64Token({ l: LINK })}.ics`, env({ FEED_LIMITER: { limit } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
