// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Boots the real app (public/index.html + public/app.js) with a saved timetable on the
// "device", to check the app still starts and renders after changes to public/lib.
const html = readFileSync(resolve(import.meta.dirname, "../public/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");

const NOW = new Date("2026-09-22T10:30:00+01:00"); // Tuesday, during the Lab
const iso = (local) => new Date(`${local}+01:00`).toISOString();
const saved = {
  name: "Alex Example",
  fetchedAt: NOW.toISOString(),
  weeks: { "2026-09-21": 3 },
  groupChoices: [{ title: "Mobile Software Development", groups: ["A", "B"] }],
  classes: [
    {
      id: "1",
      title: "Mobile Software Development",
      type: "Lab",
      group: "A",
      room: "CQ-227",
      start: iso("2026-09-22T10:00"),
      end: iso("2026-09-22T12:00"),
    },
    {
      id: "2",
      title: "Mobile Software Development",
      type: "Lab",
      group: "B",
      room: "CQ-228",
      start: iso("2026-09-22T10:00"),
      end: iso("2026-09-22T12:00"),
    },
    {
      id: "3",
      title: "Databases",
      type: "Tutorial",
      group: "",
      room: "Q-013",
      start: iso("2026-09-22T14:00"),
      end: iso("2026-09-22T15:00"),
    },
  ],
};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
  document.body.innerHTML = body;
  const set = (key, value) => localStorage.setItem("studyslot." + key, JSON.stringify(value));
  set("link", "https://timetable.example.ie/abc.ics");
  set("data", saved);
  set("groups", { "Mobile Software Development": "A" });
  set("askedGroups", true);
  set("installDismissed", true);
  await import("../public/app.js");
});

describe("app smoke test", () => {
  it("shows the timetable, not the welcome screen", () => {
    expect(document.querySelector("#app").hidden).toBe(false);
    expect(document.querySelector("#welcome").hidden).toBe(true);
  });

  it("shows the class happening now and the week number", () => {
    expect(document.querySelector("#now-card .label").textContent).toBe("Now");
    expect(document.querySelector("#now-card .what").textContent).toBe("Mobile Software Development");
    expect(document.querySelector("#cal-name").textContent).toContain("Week 1 of 1");
  });

  it("lists today's classes for the chosen group, with the free gap", () => {
    const list = document.querySelector("#today-list").textContent;
    expect(list).toContain("CQ-227");
    expect(list).not.toContain("CQ-228");
    expect(list).toContain("Free · 2h");
  });

  it("shows the friends view with an empty state", () => {
    document.querySelector('.tabs button[data-view="friends"]').click();
    expect(document.querySelector("#view-friends").hidden).toBe(false);
    expect(document.querySelector("#friends-body").textContent).toContain("Find free time with friends");
  });

  it("moves between view tabs with the arrow keys and keeps focus on the selected tab", async () => {
    const friendsTab = document.querySelector('.tabs button[data-view="friends"]');
    friendsTab.focus();
    friendsTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await Promise.resolve();
    const todayTab = document.querySelector('.tabs button[data-view="today"]');
    expect(document.querySelector("#view-today").hidden).toBe(false);
    expect(todayTab.getAttribute("aria-selected")).toBe("true");
    expect(friendsTab.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(todayTab);
  });

  it("moves focus into a sheet, and back to the button that opened it on Escape", async () => {
    const opener = document.querySelector("#open-settings");
    opener.focus();
    opener.click();
    const settings = document.querySelector("#settings");
    expect(settings.hidden).toBe(false);
    expect(settings.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Focus comes back at once; the sheet stops being interactive and then slides away.
    expect(document.activeElement).toBe(opener);
    expect(settings.inert).toBe(true);
    await vi.waitFor(() => expect(settings.hidden).toBe(true));
  });

  it("shows the beta note on Today until it's hidden", () => {
    document.querySelector('.tabs button[data-view="today"]').click();
    expect(document.querySelector("#beta-note").hidden).toBe(false);
    document.querySelector("#beta-dismiss").click();
    expect(document.querySelector("#beta-note").hidden).toBe(true);
    expect(localStorage.getItem("studyslot.betaNoteHidden")).toBe("true");
  });

  it("sends feedback with the app version and phone type, but not the timetable link", async () => {
    fetch.mockImplementationOnce(async () => Response.json({ ok: true }));
    document.querySelector("[data-feedback]").click();
    expect(document.querySelector("#feedback-sheet").hidden).toBe(false);
    document.querySelector('.feedback-kind [data-kind="idea"]').click();
    document.querySelector("#feedback-text").value = "Love it";
    document.querySelector("#feedback-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector("#banner").hidden).toBe(false));
    const [url, init] = fetch.mock.calls.findLast(([u]) => u === "/api/feedback");
    const sent = JSON.parse(init.body);
    expect(url).toBe("/api/feedback");
    expect(sent).toMatchObject({ kind: "idea", message: "Love it", version: expect.any(String) });
    expect(sent.device).toBeTruthy();
    expect(init.body).not.toContain("timetable.example.ie");
  });

  it("opens the Home Screen guide from Settings, with a tab for each phone", async () => {
    document.querySelector("#open-settings").click();
    document.querySelector("#install-help").click();
    expect(document.querySelector("#install-sheet").hidden).toBe(false);
    const viewBefore = document.querySelector("#heading").textContent;
    document.querySelector('#install-tabs [data-os="android"]').click();
    expect(document.querySelector("#install-android").hidden).toBe(false);
    expect(document.querySelector("#install-ios").hidden).toBe(true);
    expect(document.querySelector('#install-tabs [data-os="android"]').classList.contains("active")).toBe(true);
    // Switching phone doesn't switch the app's view behind the sheet.
    expect(document.querySelector("#heading").textContent).toBe(viewBefore);
    document.querySelector('#install-tabs [data-os="ios"]').click();
    expect(document.querySelector("#install-ios").hidden).toBe(false);
  });
});
