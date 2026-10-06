// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A new student on an iPhone adds their timetable, which has lab groups to pick.
const html = readFileSync(resolve(import.meta.dirname, "../public/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
const NOW = new Date("2026-09-22T10:30:00+01:00");
const lab = (id, group) => ({
  id,
  title: "Mobile Software Development",
  type: "Lab",
  group,
  room: `CQ-22${id}`,
  start: "2026-09-22T13:00:00.000Z",
  end: "2026-09-22T15:00:00.000Z",
});

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).startsWith("/api/timetable")
        ? Response.json({
            name: "",
            fetchedAt: NOW.toISOString(),
            weeks: {},
            groupChoices: [{ title: "Mobile Software Development", groups: ["A", "B"] }],
            classes: [lab("7", "A"), lab("8", "B")],
          })
        : new Response("{}", { status: 500 }),
    ),
  );
  document.body.innerHTML = body;
  await import("../public/app.js");
});

describe("Add to Home Screen tip", () => {
  it("waits until the lab groups are picked", async () => {
    document.querySelector("#link-input").value = "https://timetable.example.ie/abc.ics";
    document.querySelector("#link-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector("#groups-prompt").hidden).toBe(false));
    expect(document.querySelector("#install-sheet").hidden).toBe(true);
  });

  it("then says you can add Studyslot to your Home Screen, with the iPhone steps", async () => {
    document.querySelector('#gp-groups [aria-pressed="false"]').click(); // pick group A
    document.querySelector("#groups-prompt [data-close]").click();
    await vi.waitFor(() => expect(document.querySelector("#install-sheet").hidden).toBe(false));
    expect(document.querySelector("#install-title").textContent).toBe("Did you know?");
    expect(document.querySelector("#install-intro").textContent).toMatch(/add Studyslot to your Home Screen/);
    expect(document.querySelector("#install-ios").hidden).toBe(false);
    expect(localStorage.getItem("studyslot.installTipShown")).toBe("true");
  });

  it("is the usual guide when opened from Settings later", async () => {
    document.querySelector("#install-sheet [data-close]").click();
    await vi.waitFor(() => expect(document.querySelector("#install-sheet").hidden).toBe(true));
    document.querySelector("#open-settings").click();
    document.querySelector("#install-help").click();
    expect(document.querySelector("#install-title").textContent).toBe("Add to Home Screen");
  });
});
