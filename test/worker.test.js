import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { openToken, sealToken } from "../src/share.js";

// The Worker runs in Node here: global fetch is replaced by a mock so no real college
// server is contacted, and the clock is fixed in the middle of the fixture's term.
const fixture = readFileSync(new URL("./fixtures/scientia-sample.ics", import.meta.url), "utf8");
const LINK = "https://timetable.example.ie/ical/abc123.ics";

const SHARE_KEY = "test-key-0123456789-0123456789-0123456789";
const env = (overrides = {}) => ({
  SHARE_KEY,
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

describe("GET /feed/<token>.ics with an old base64 token", () => {
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

describe("old base64 feed tokens during the transition", () => {
  const base64Token = (settings) => Buffer.from(JSON.stringify(settings)).toString("base64url");

  it("ask the student to add the calendar again", async () => {
    respondWith(fixture);
    const ics = (await (await get(`/feed/${base64Token({ l: LINK })}.ics`)).text()).replace(/\r\n /g, "");
    expect(ics).toContain("X-WR-CALDESC:This calendar link is out of date and will stop working on 1 February 2027");
  });

  it("stop working on 1 February 2027", async () => {
    vi.setSystemTime(new Date("2027-02-01T00:00:00Z"));
    const res = await get(`/feed/${base64Token({ l: LINK })}.ics`);
    expect(res.status).toBe(410);
    expect(await res.text()).toMatch(/expired/);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("POST /api/share", () => {
  const share = (body, e = env()) =>
    worker.fetch(
      new Request("https://studyslot.test/api/share", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      e,
    );

  it("returns an encrypted token holding the cleaned settings, and an id", async () => {
    const res = await share({
      l: "webcal://timetable.example.ie/ical/abc123.ics",
      g: { Networks: "A" },
      h: ["Cloud"],
      z: "Europe/Dublin",
      n: "  Alex  ",
    });
    expect(res.status).toBe(200);
    const { token, id } = await res.json();
    expect(token).not.toContain("timetable");
    expect(id).toMatch(/^f[A-Za-z0-9_-]+$/);
    expect(await openToken(token, SHARE_KEY)).toEqual({
      l: LINK,
      g: { Networks: "A" },
      h: ["Cloud"],
      z: "Europe/Dublin",
      n: "Alex",
    });
    expect(upstream).not.toHaveBeenCalled(); // making a link doesn't fetch the timetable
  });

  it("gives the same id for the same link", async () => {
    const a = await (await share({ l: LINK, n: "Alex" })).json();
    const b = await (await share({ l: "webcal://timetable.example.ie/ical/abc123.ics" })).json();
    expect(a.id).toBe(b.id);
    expect(a.token).not.toBe(b.token);
  });

  it("drops unexpected fields and wrong types", async () => {
    const { token } = await (
      await share({ l: LINK, g: { A: 1, B: "x" }, h: [1, "Cloud"], z: "Mars/Base", n: 7, extra: "nope" })
    ).json();
    expect(await openToken(token, SHARE_KEY)).toEqual({ l: LINK, g: { B: "x" }, h: ["Cloud"], z: "UTC", n: "" });
  });

  it("applies the same link checks as the timetable reader", async () => {
    const res = await share({ l: "https://192.168.1.10/a.ics" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/doesn't look like a calendar link/);
  });

  it.each([
    ["isn't JSON", "{oops", 400],
    ["isn't an object", "[]", 400],
    ["is too large", JSON.stringify({ l: LINK, n: "x".repeat(20000) }), 413],
  ])("rejects a body that %s", async (_, body, status) => {
    expect((await share(body)).status).toBe(status);
  });

  it("says sharing isn't available when SHARE_KEY isn't set", async () => {
    const res = await share({ l: LINK }, env({ SHARE_KEY: undefined }));
    expect(res.status).toBe(503);
  });

  it("is rate limited like the timetable reader", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    expect((await share({ l: LINK }, env({ API_LIMITER: { limit } }))).status).toBe(429);
  });
});

describe("GET /api/friend", () => {
  const friend = (token) => get(`/api/friend?token=${encodeURIComponent(token)}&tz=Europe/Dublin`);
  const friendSettings = {
    l: LINK,
    g: { "Mobile Software Development": "B" },
    h: ["Cloud Computing"],
    z: "Europe/Dublin",
    n: "Sam",
  };

  it("returns the friend's name and their classes (their group, without hidden modules), not their link", async () => {
    respondWith(fixture);
    const res = await friend(await sealToken(friendSettings, SHARE_KEY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["classes", "fetchedAt", "id", "name"]);
    expect(JSON.stringify(body)).not.toContain("timetable.example.ie");
    expect(body.name).toBe("Sam");
    expect(body.classes.length).toBeGreaterThan(0);
    expect(body.classes.some((c) => c.title === "Cloud Computing")).toBe(false);
    expect(body.classes.filter((c) => c.type === "Lab").every((c) => c.group === "B")).toBe(true);
    expect(upstream.mock.calls[0][0]).toBe(LINK);
  });

  it("returns the same id as POST /api/share for that link", async () => {
    respondWith(fixture);
    const shared = await (
      await worker.fetch(
        new Request("https://studyslot.test/api/share", { method: "POST", body: JSON.stringify(friendSettings) }),
        env(),
      )
    ).json();
    expect((await (await friend(shared.token)).json()).id).toBe(shared.id);
  });

  it("rejects a tampered token without fetching anything", async () => {
    const token = await sealToken(friendSettings, SHARE_KEY);
    const tampered = token.slice(0, 20) + (token[20] === "A" ? "B" : "A") + token.slice(21);
    const res = await friend(tampered);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't valid/);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("doesn't accept old base64 tokens (the app reads those itself)", async () => {
    const res = await friend(Buffer.from(JSON.stringify(friendSettings)).toString("base64url"));
    expect(res.status).toBe(400);
  });

  it("passes on errors from the friend's college server", async () => {
    respondWith("gone", { status: 404 });
    const res = await friend(await sealToken(friendSettings, SHARE_KEY));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/no longer works/);
  });
});

describe("GET /feed/<token>.ics with an encrypted token", () => {
  it("serves the cleaned calendar", async () => {
    respondWith(fixture);
    const token = await sealToken(
      { l: LINK, g: { "Mobile Software Development": "B" }, h: [], z: "Europe/Dublin", n: "Alex" },
      SHARE_KEY,
    );
    const res = await get(`/feed/${token}.ics`);
    expect(res.status).toBe(200);
    const ics = (await res.text()).replace(/\r\n /g, "");
    expect(ics).toContain("X-WR-CALDESC:Your college timetable\\, cleaned up by Studyslot");
    expect(ics).toContain("CQ-228");
    expect(ics).not.toContain("CQ-227");
  });

  it("rejects a tampered token", async () => {
    const token = await sealToken({ l: LINK }, SHARE_KEY);
    const tampered = token.slice(0, 20) + (token[20] === "A" ? "B" : "A") + token.slice(21);
    expect((await get(`/feed/${tampered}.ics`)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a token made with a different key (e.g. after rotating SHARE_KEY)", async () => {
    const token = await sealToken({ l: LINK }, "an-old-key-0123456789-0123456789-0123456789");
    expect((await get(`/feed/${token}.ics`)).status).toBe(400);
  });
});

describe("Reset my link", () => {
  // A stand-in for the LINK_RESETS KV namespace.
  const kv = () => {
    const entries = new Map();
    return { entries, get: async (k) => entries.get(k) ?? null, put: async (k, v) => void entries.set(k, v) };
  };
  const share = (body, e) =>
    worker.fetch(new Request("https://studyslot.test/api/share", { method: "POST", body: JSON.stringify(body) }), e);
  const friend = (token, e) => get(`/api/friend?token=${encodeURIComponent(token)}`, e);
  const feed = (token, e) => get(`/feed/${token}.ics`, e);
  // Several requests each read the college's calendar, so each gets its own response.
  beforeEach(() => upstream.mockImplementation(async () => new Response(fixture)));

  it("stops earlier friend links working, while the new one works", async () => {
    const e = env({ LINK_RESETS: kv() });
    const before = (await (await share({ l: LINK, n: "Alex" }, e)).json()).token;
    expect((await friend(before, e)).status).toBe(200);

    const after = await (await share({ l: LINK, n: "Alex", reset: true }, e)).json();
    expect(after.id).toBe((await (await share({ l: LINK }, e)).json()).id); // still the same friend
    const res = await friend(before, e);
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/was reset/);
    expect((await friend(after.token, e)).status).toBe(200);
  });

  it("stops friend links made before this feature too", async () => {
    const e = env({ LINK_RESETS: kv() });
    const old = await sealToken({ l: LINK, n: "Alex" }, SHARE_KEY);
    await share({ l: LINK, reset: true }, e);
    expect((await friend(old, e)).status).toBe(410);
    expect((await feed(old, e)).status).toBe(410); // nor can it be opened as a calendar instead
  });

  it("new links made after a reset carry the new generation", async () => {
    const e = env({ LINK_RESETS: kv() });
    await share({ l: LINK, reset: true }, e);
    const later = (await (await share({ l: LINK, n: "Alex B" }, e)).json()).token;
    expect((await friend(later, e)).status).toBe(200);
  });

  it("keeps calendar-only links working, and doesn't accept them as friend links", async () => {
    const e = env({ LINK_RESETS: kv() });
    const calendar = (await (await share({ l: LINK, p: "c" }, e)).json()).token;
    await share({ l: LINK, reset: true }, e);
    expect((await feed(calendar, e)).status).toBe(200);
    expect((await friend(calendar, e)).status).toBe(400);
  });

  it("stores only an anonymous id and a random value", async () => {
    const store = kv();
    await share({ l: LINK, n: "Alex", reset: true }, env({ LINK_RESETS: store }));
    const [[key, value]] = [...store.entries];
    expect(key).toMatch(/^f[A-Za-z0-9_-]+$/);
    expect(`${key}${value}`).not.toMatch(/timetable|Alex/);
  });

  it("says resetting isn't available without the store", async () => {
    expect((await share({ l: LINK, reset: true }, env())).status).toBe(503);
  });
});

describe("GET /: link previews", () => {
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const assets = {
    fetch: vi.fn(async () => new Response(page, { headers: { "Content-Type": "text/html", ETag: '"abc"' } })),
  };
  const home = async (query = "") => get(`/${query}`, env({ ASSETS: assets }));
  const meta = (html, property) => html.match(new RegExp(`property="${property}"\\s+content="([^"]*)"`))?.[1];

  it("gives chat apps a full address for the preview image", async () => {
    const res = await home();
    const html = await res.text();
    expect(meta(html, "og:image")).toBe("https://studyslot.test/share.jpg");
    expect(meta(html, "og:title")).toBe("Studyslot");
    expect(res.headers.get("ETag")).toBeNull();
  });

  it("says what a friend link is, without the friend's name or token", async () => {
    const html = await (await home("?friend=SECRET-TOKEN")).text();
    expect(meta(html, "og:title")).toBe("A friend shared their timetable");
    expect(meta(html, "og:description")).toMatch(/see when you're both free/);
    expect(html).not.toContain("SECRET-TOKEN");
  });

  it("passes anything other than the page straight through", async () => {
    const res = await get("/", env({ ASSETS: { fetch: async () => new Response(null, { status: 304 }) } }));
    expect(res.status).toBe(304);
  });
});
