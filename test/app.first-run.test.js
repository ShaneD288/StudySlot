// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A new student who opened a friend's link and added them, but hasn't added their own timetable.
const html = readFileSync(resolve(import.meta.dirname, "../public/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
const NOW = new Date("2026-09-22T10:30:00+01:00");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).startsWith("/api/timetable"))
        return Response.json({
          name: "",
          fetchedAt: NOW.toISOString(),
          weeks: {},
          groupChoices: [],
          classes: [
            {
              id: "1",
              title: "Databases",
              type: "Lecture",
              group: "",
              room: "Q-013",
              start: "2026-09-22T13:00:00.000Z",
              end: "2026-09-22T14:00:00.000Z",
            },
          ],
        });
      return new Response("{}", { status: 500 });
    }),
  );
  document.body.innerHTML = body;
  localStorage.setItem("studyslot.friends", JSON.stringify([{ id: "f1", name: "Sam", t: "token", g: {}, h: [] }]));
  await import("../public/app.js");
});

describe("first run after adding a friend", () => {
  it("asks for their timetable by the friend's name", () => {
    expect(document.querySelector("#welcome").hidden).toBe(false);
    expect(document.querySelector("#link-sub").textContent).toBe(
      "Add your timetable to see when you and Sam are free.",
    );
  });

  it("opens on Friends once their timetable is added", async () => {
    document.querySelector("#link-input").value = "https://timetable.example.ie/abc.ics";
    document.querySelector("#link-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector("#app").hidden).toBe(false));
    expect(document.querySelector("#view-friends").hidden).toBe(false);
    expect(document.querySelector("#view-today").hidden).toBe(true);
  });
});
