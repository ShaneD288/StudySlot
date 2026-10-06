import { addDays, dayKey, duration, fromKey, mondayOf } from "./lib/dates.js";
import { weekLabel as weekLabelFor } from "./lib/weeks.js";
import { classesInCommon, filterClasses } from "./lib/classes.js";
import { freeTogether } from "./lib/free-time.js";
import { project, rubberband, spring, velocityTracker } from "./lib/motion.js";
import { parseFriendLink } from "./lib/share-links.js";

const $ = (sel) => document.querySelector(sel);

// Element builder: h("div", { class: "x", onclick, style: { "--hue": 210 } }, "text", child...)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style")
      for (const [p, val] of Object.entries(v)) p.startsWith("--") ? el.style.setProperty(p, val) : (el.style[p] = val);
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// ---------- Saved on this device only ----------

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem("studyslot." + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("studyslot." + key, JSON.stringify(value));
    } catch {}
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("studyslot."))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const APP_VERSION = "1.0.0";
const CONTACT = "hello@studyslot.ie";
const STALE_MS = 30 * 60 * 1000;

// Saved by older versions and no longer used: course and year, and one shared link for everything.
try {
  localStorage.removeItem("studyslot.profile");
  localStorage.removeItem("studyslot.share");
} catch {}
let link = store.get("link");
let data = store.get("data"); // { name, classes, groupChoices, fetchedAt }
let groups = store.get("groups", {}); // module title -> chosen group
let hidden = new Set(store.get("hidden", []));
let friends = store.get("friends", []); // [{ id, name, l, g, h }]
let selectedFriends = new Set(
  store.get(
    "selectedFriends",
    friends.map((f) => f.id),
  ),
);
let friendDay = null;
let view = "today";
let weekOffset = 0;
let selectedDay = null;

// ---------- Motion ----------

const VIEWS = ["today", "week", "friends"];
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const EASE_OUT = "cubic-bezier(0.25, 1, 0.5, 1)"; // settles smoothly, no overshoot

// New content arrives from the side it's coming from: the next tab, week or day slides in from
// the right, the previous one from the left. With Reduce Motion it just fades in.
function slideIn(el, direction) {
  if (!direction || !el?.animate) return;
  const reduce = reduceMotion();
  el.animate(
    reduce
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `translateX(${direction * 24}px)` },
          { opacity: 1, transform: "none" },
        ],
    { duration: reduce ? 150 : 320, easing: EASE_OUT },
  );
}

// iOS Safari only shows :active press states when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

// ---------- Dates ----------

const todayKey = () => dayKey(new Date());
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function when(iso) {
  const d = new Date(iso);
  const k = dayKey(d);
  if (k === todayKey()) return `today at ${time(iso)}`;
  if (k === addDays(todayKey(), 1)) return `tomorrow at ${time(iso)}`;
  return `${d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })} at ${time(iso)}`;
}

// ---------- Week numbers ----------

const weekLabel = (monday) => weekLabelFor(data?.weeks, monday);

// ---------- Classes ----------

// Each module keeps the same color everywhere, like a highlighted printed timetable.
const HUES = [222, 262, 330, 8, 32, 152, 182, 292, 96, 198, 48, 244];
function hue(title) {
  let n = 0;
  for (const ch of title) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[n % HUES.length];
}

const visibleClasses = () => filterClasses(data?.classes, groups, hidden);
const classesOn = (k) => visibleClasses().filter((c) => dayKey(new Date(c.start)) === k);

function classCard(c) {
  const now = Date.now();
  const end = Date.parse(c.end);
  const kind = [c.type, c.group && `Group ${c.group}`].filter(Boolean).join(" · ");
  return h(
    "article",
    { class: "class" + (end < now ? " past" : ""), style: { "--hue": hue(c.title) } },
    h("div", { class: "time" }, time(c.start), h("span", {}, time(c.end))),
    h(
      "div",
      {},
      h("div", { class: "name" }, c.title),
      h(
        "div",
        { class: "meta" },
        kind && h("span", { class: "kind" }, kind),
        h("span", { class: "room" }, c.room || "Room not listed"),
      ),
    ),
  );
}

// A day's classes with the free time between them.
function dayList(list) {
  const out = [];
  list.forEach((c, i) => {
    const prev = list[i - 1];
    if (prev) {
      const gap = Date.parse(c.start) - Date.parse(prev.end);
      if (gap >= 30 * 60000 && gap <= 4 * 3600000) out.push(h("div", { class: "gap" }, `Free · ${duration(gap)}`));
    }
    out.push(classCard(c));
  });
  return out;
}

// ---------- Today ----------

function renderNowCard() {
  const card = $("#now-card");
  const now = Date.now();
  const upcoming = visibleClasses().filter((c) => Date.parse(c.end) > now);
  const current = upcoming.find((c) => Date.parse(c.start) <= now);
  const next = upcoming.find((c) => Date.parse(c.start) > now);
  const where = (c) => h("div", { class: "where" }, c.room || "Room not listed");
  card.className = "now-card";

  if (current) {
    const done = (now - Date.parse(current.start)) / (Date.parse(current.end) - Date.parse(current.start));
    card.classList.add("live");
    card.replaceChildren(
      h("div", { class: "label" }, "Now"),
      h("div", { class: "what" }, current.title),
      where(current),
      h(
        "div",
        { class: "when" },
        `${current.type || "Class"} · until ${time(current.end)} · ${duration(Date.parse(current.end) - now)} left`,
      ),
      h(
        "div",
        { class: "progress", "aria-hidden": "true" },
        h("i", { style: { width: `${Math.round(done * 100)}%` } }),
      ),
    );
  } else if (next && dayKey(new Date(next.start)) === todayKey()) {
    card.replaceChildren(
      h("div", { class: "label" }, `Next · in ${duration(Date.parse(next.start) - now)}`),
      h("div", { class: "what" }, next.title),
      where(next),
      h("div", { class: "when" }, `${next.type || "Class"} · ${time(next.start)}–${time(next.end)}`),
    );
  } else if (next) {
    card.classList.add("quiet");
    card.replaceChildren(
      h("div", { class: "label" }, classesOn(todayKey()).length ? "Done for today" : "No classes today"),
      h("div", { class: "what" }, `Next: ${next.title}`),
      h("div", { class: "when" }, `${when(next.start)}${next.room ? ` · ${next.room}` : ""}`),
    );
  } else {
    card.classList.add("quiet");
    card.replaceChildren(
      h("div", { class: "label" }, "Nothing coming up"),
      h("div", { class: "when" }, "No more classes found in your timetable."),
    );
  }
}

// ---------- Install guide ----------

// Android/desktop Chrome offer a real install prompt; iPhone needs Share → Add to Home Screen.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function renderInstall() {
  const el = $("#install-banner");
  if (!el) return;
  const dismiss = () => {
    store.set("installDismissed", true);
    el.hidden = true;
  };
  if (isInstalled() || store.get("installDismissed") || (!installPrompt && !isIOS())) {
    el.hidden = true;
    return;
  }
  const shareIcon = h("span", { class: "share-icon", role: "img", "aria-label": "Share" });
  shareIcon.innerHTML =
    '<svg width="16" height="18" viewBox="0 0 16 20" aria-hidden="true"><path d="M8 13V2M4 5.5 8 1.5l4 4M3 9H1.5v9.5h13V9H13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  el.hidden = false;
  el.replaceChildren(
    h(
      "div",
      { class: "install-text" },
      h("b", {}, "Add Studyslot to your Home Screen"),
      installPrompt
        ? h("span", {}, "Open it like an app, even offline.")
        : h("span", {}, "In Safari, tap ", shareIcon, " Share, then ", h("b", {}, "Add to Home Screen"), "."),
    ),
    h(
      "div",
      { class: "install-actions" },
      installPrompt &&
        h(
          "button",
          {
            class: "btn small",
            onclick: async () => {
              installPrompt.prompt();
              await installPrompt.userChoice.catch(() => {});
              installPrompt = null;
              dismiss();
            },
          },
          "Install",
        ),
      h("button", { class: "text-btn", onclick: dismiss }, "Not now"),
    ),
  );
}

function renderToday() {
  renderInstall();
  renderNowCard();
  const list = classesOn(todayKey());
  $("#today-list").replaceChildren(
    ...(list.length
      ? dayList(list)
      : [h("div", { class: "empty" }, h("b", {}, "No classes today"), "Enjoy the free day.")]),
  );
}

// ---------- Week ----------

function renderWeek() {
  const monday = addDays(mondayOf(todayKey()), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Show weekends only when there's something on them.
  const shown = days.filter((k, i) => i < 5 || classesOn(k).length);
  if (!selectedDay || !shown.includes(selectedDay)) selectedDay = shown.includes(todayKey()) ? todayKey() : shown[0];

  const fmt = (k) => fromKey(k).toLocaleDateString([], { day: "numeric", month: "short" });
  const relative =
    weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : `${fmt(monday)} – ${fmt(addDays(monday, 6))}`;
  $("#week-label").textContent = [relative, weekLabel(monday).replace(/ of \d+/, "")].filter(Boolean).join(" · ");

  const strip = $("#day-strip");
  strip.style.setProperty("--days", shown.length);
  strip.replaceChildren(
    ...shown.map((k) => {
      const n = classesOn(k).length;
      return h(
        "button",
        {
          role: "tab",
          class: [k === selectedDay && "active", k === todayKey() && "today"].filter(Boolean).join(" "),
          "aria-selected": String(k === selectedDay),
          onclick: () => {
            const direction = Math.sign(shown.indexOf(k) - shown.indexOf(selectedDay));
            selectedDay = k;
            renderWeek();
            slideIn($("#week-list"), direction);
          },
        },
        fromKey(k).toLocaleDateString([], { weekday: "short" }),
        h("b", {}, String(fromKey(k).getDate())),
        h("span", { class: "count" }, n ? `${n} class${n === 1 ? "" : "es"}` : "free"),
      );
    }),
  );

  const list = classesOn(selectedDay);
  $("#week-list").replaceChildren(
    h(
      "div",
      { class: "day-head" },
      fromKey(selectedDay).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
    ),
    ...(list.length ? dayList(list) : [h("div", { class: "empty" }, h("b", {}, "No classes"), "Nothing on this day.")]),
  );
}

function changeWeek(step) {
  weekOffset += step;
  selectedDay = null;
  renderWeek();
  slideIn($("#day-strip"), step);
  slideIn($("#week-list"), step);
}
$("#week-prev").addEventListener("click", () => changeWeek(-1));
$("#week-next").addEventListener("click", () => changeWeek(1));

// ---------- Screens ----------

function render() {
  if (!data) return;
  const thisWeek = weekLabel(mondayOf(todayKey()));
  const who = data.name ? `${data.name}'s timetable` : "My timetable";
  $("#cal-name").textContent = [who, thisWeek].filter(Boolean).join(" · ");
  $("#heading").textContent =
    view === "today"
      ? new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })
      : view === "week"
        ? "Week"
        : "Friends";
  for (const v of VIEWS) $(`#view-${v}`).hidden = view !== v;
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    b.setAttribute("aria-selected", String(b.dataset.view === view));
  });
  placeTabThumb();
  if (view === "today") renderToday();
  else if (view === "week") renderWeek();
  else renderFriends();
  const mins = Math.round((Date.now() - Date.parse(data.fetchedAt)) / 60000);
  $("#updated").textContent = `Updated ${mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : when(data.fetchedAt)}`;
}

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    const direction = Math.sign(VIEWS.indexOf(b.dataset.view) - VIEWS.indexOf(view));
    view = b.dataset.view;
    render();
    slideIn($(`#view-${view}`), direction);
  }),
);

// The selected tab's background slides between tabs, like an iOS segmented control.
function placeTabThumb() {
  const tabs = $("#view-tabs");
  const active = tabs.querySelector("button.active");
  if (!active?.offsetWidth) return; // not on screen yet
  tabs.style.setProperty("--thumb-x", `${active.offsetLeft}px`);
  tabs.style.setProperty("--thumb-w", `${active.offsetWidth}px`);
  // Only animate once it's been placed, so it doesn't fly in from the left on launch.
  if (!tabs.classList.contains("placed")) requestAnimationFrame(() => tabs.classList.add("placed"));
}
window.addEventListener("resize", placeTabThumb);
document.fonts?.ready.then(placeTabThumb);

// ---------- First run: add your timetable link ----------

function showWelcome(error) {
  $("#app").hidden = true;
  $("#welcome").hidden = false;
  $("#link-input").value = link || "";
  // Changing the link from Settings: there's a timetable to go back to.
  $("#ob-back").hidden = !data;
  $("#link-error").hidden = !error;
  $("#link-error").textContent = error || "";
  // Typing is the only thing to do here, but don't pop the keyboard over a returning visitor's error.
  if (!error && window.matchMedia?.("(hover: hover)").matches) $("#link-input").focus();
}
$("#ob-back").addEventListener("click", () => data && showApp());

function showApp() {
  $("#welcome").hidden = true;
  $("#app").hidden = false;
  render();
}

// The header is a translucent layer; a hairline appears under it only once content scrolls beneath.
window.addEventListener("scroll", () => $(".top").classList.toggle("scrolled", window.scrollY > 2), { passive: true });

function banner(message) {
  const el = $("#banner");
  el.hidden = !message;
  if (message)
    el.replaceChildren(
      h("span", {}, message),
      h("button", { class: "text-btn", onclick: () => (el.hidden = true) }, "OK"),
    );
}

// ---------- Loading ----------

async function fetchTimetable(forLink) {
  const res = await fetch(`/api/timetable?link=${encodeURIComponent(forLink)}&tz=${encodeURIComponent(TZ)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't read that timetable.");
  return body;
}

async function refresh({ force = false } = {}) {
  if (!link) return showWelcome();
  if (!force && data && Date.now() - Date.parse(data.fetchedAt) < STALE_MS) return;
  $("#refresh").textContent = "Refreshing…";
  try {
    data = await fetchTimetable(link);
    store.set("data", data);
    banner(null);
    render();
    maybeAskGroups();
  } catch (err) {
    if (data) banner(`Couldn't refresh (${err.message}) Showing your saved timetable.`);
    else showWelcome(err.message);
  } finally {
    $("#refresh").textContent = "Refresh now";
  }
}

$("#refresh").addEventListener("click", () => refresh({ force: true }));

$("#link-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = $("#link-input").value.trim();
  const button = $("#link-submit");
  button.disabled = true;
  button.textContent = "Reading your timetable…";
  $("#link-error").hidden = true;
  try {
    const result = await fetchTimetable(value);
    if (!result.classes.length) {
      throw new Error(
        result.totalEntries
          ? "That calendar has entries, but none look like upcoming classes. Is it the right link?"
          : "That calendar is empty.",
      );
    }
    link = value;
    data = result;
    store.set("link", link);
    store.set("data", data);
    store.set("privateLinksNotice", true);
    view = "today";
    showApp();
    maybeAskGroups();
  } catch (err) {
    $("#link-error").textContent = err.message;
    $("#link-error").hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Show my timetable";
  }
});

// ---------- Groups & modules ----------

function groupRows(onChange) {
  return (data?.groupChoices || []).map((m) =>
    h(
      "div",
      { class: "choice", style: { "--hue": hue(m.title) } },
      h("span", {}, m.title),
      h(
        "div",
        { class: "pills", role: "group", "aria-label": `Group for ${m.title}` },
        [...m.groups, null].map((g) =>
          h(
            "button",
            {
              class: (groups[m.title] || null) === g ? "active" : "",
              "aria-pressed": String((groups[m.title] || null) === g),
              onclick: () => {
                if (g) groups[m.title] = g;
                else delete groups[m.title];
                store.set("groups", groups);
                onChange();
                render();
              },
            },
            g || "All",
          ),
        ),
      ),
    ),
  );
}

function maybeAskGroups() {
  const undecided = (data?.groupChoices || []).some((m) => !groups[m.title]);
  if (!undecided || store.get("askedGroups")) return;
  store.set("askedGroups", true);
  const fill = () => $("#gp-groups").replaceChildren(...groupRows(fill));
  fill();
  openSheet($("#groups-prompt"));
}

// ---------- Sharing (calendar feed + friend links) ----------

const myName = () => store.get("name") || data?.name || "";

// Everything needed to rebuild my cleaned timetable (link, groups, hidden modules, time zone,
// name), encrypted by the server into a token that can't be read or changed (src/share.js).
// "friend" tokens are for friend links and stop working when I reset my link; "calendar" tokens
// are only for my own calendar feed, so a reset doesn't break it. A token is reused for a day
// unless the settings change, so a reset on another device reaches this one. Returns { token, id }.
async function myShare(purpose = "friend", { reset = false } = {}) {
  const settings = JSON.stringify({ l: link, g: groups, h: [...hidden], z: TZ, n: myName() });
  const key = `share.${purpose}`;
  const saved = store.get(key);
  if (!reset && saved?.settings === settings && Date.now() - saved.madeAt < 86400000) return saved;
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...JSON.parse(settings), ...(purpose === "calendar" ? { p: "c" } : {}), reset }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(body.error || "Couldn't create your link. Check your connection.");
  const share = { settings, token: body.token, id: body.id, madeAt: Date.now() };
  store.set(key, share);
  return share;
}

// Calendar-feed links for the current settings, once the server has made the token.
let feeds = null;
let feedRun = 0;
async function prepareFeeds() {
  const run = ++feedRun;
  feeds = null;
  $("#feed-status").hidden = false;
  $("#feed-status").textContent = "Preparing your calendar link…";
  try {
    const https = `${location.origin}/feed/${(await myShare("calendar")).token}.ics`;
    if (run !== feedRun) return; // settings changed while waiting
    feeds = { https, webcal: https.replace(/^https?:/, "webcal:") };
    $("#feed-apple").href = feeds.webcal;
    $("#feed-google").href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feeds.webcal)}`;
    $("#feed-status").hidden = true;
  } catch (err) {
    if (run === feedRun) $("#feed-status").textContent = err.message;
  }
}
for (const id of ["#feed-apple", "#feed-google"]) {
  $(id).addEventListener("click", (e) => {
    if (!feeds) e.preventDefault();
  });
}

async function copyText(text, button, label) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Couldn't copy. Long-press to copy instead.";
  }
  setTimeout(() => (button.textContent = label), 2000);
}

$("#feed-copy").addEventListener("click", () => {
  if (feeds) copyText(feeds.https, $("#feed-copy"), "Copy calendar link");
});

function fillSettings() {
  prepareFeeds();
  $("#friends-section").hidden = !friends.length;
  $("#friends-list").replaceChildren(
    ...friends.map((f) =>
      h(
        "div",
        { class: "choice", style: { "--hue": hue(f.name) } },
        h("span", {}, f.name),
        h(
          "button",
          {
            class: "text-btn danger-text",
            onclick: () => {
              friends = friends.filter((x) => x.id !== f.id);
              selectedFriends.delete(f.id);
              try {
                localStorage.removeItem("studyslot.friend." + f.id);
              } catch {}
              saveFriends();
              fillSettings();
              render();
            },
          },
          "Remove",
        ),
      ),
    ),
  );
  const choices = data?.groupChoices || [];
  $("#groups-section").hidden = !choices.length;
  $("#groups").replaceChildren(...groupRows(fillSettings));
  const titles = [...new Set((data?.classes || []).map((c) => c.title))].sort((a, b) => a.localeCompare(b));
  $("#modules").replaceChildren(
    ...titles.map((t) => {
      const toggle = h("input", { type: "checkbox", class: "toggle", "aria-label": `Show ${t}` });
      toggle.checked = !hidden.has(t);
      toggle.addEventListener("change", () => {
        if (toggle.checked) hidden.delete(t);
        else hidden.add(t);
        store.set("hidden", [...hidden]);
        prepareFeeds();
        render();
      });
      return h("label", { class: "choice", style: { "--hue": hue(t) } }, h("span", {}, t), toggle);
    }),
  );
}

// ---------- Friends ----------

// Friends added from a private link keep only their token (t): the server sends back their name
// and classes but never their timetable link. Friends added from an older link keep the link (l)
// and their choices (g, h) until those links stop working.

function friendId(friendLink) {
  let n = 0;
  for (const ch of friendLink) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return "f" + n.toString(36);
}

const OLD_LINK = "older links stop working on 1 February 2027";

function saveFriends() {
  store.set("friends", friends);
  store.set("selectedFriends", [...selectedFriends]);
}

async function fetchFriend(token) {
  const res = await fetch(`/api/friend?token=${encodeURIComponent(token)}&tz=${encodeURIComponent(TZ)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't read your friend's timetable.");
  return body;
}

/** Adds a friend from parseFriendLink's result. Throws if the link doesn't work. */
async function addFriend(parsed) {
  let friend;
  if (parsed.legacy) {
    const shared = parsed.legacy;
    friend = { id: friendId(shared.l), name: shared.n || "Friend", l: shared.l, g: shared.g || {}, h: shared.h || [] };
  } else {
    const loaded = await fetchFriend(parsed.token);
    const mine = link ? await myShare().catch(() => null) : null;
    if (mine && loaded.id === mine.id) throw new Error("That's your own timetable.");
    friend = { id: loaded.id, name: loaded.name || "Friend", t: parsed.token, g: {}, h: [] };
    store.set("friend." + friend.id, { classes: loaded.classes, fetchedAt: loaded.fetchedAt });
    // A friend who shared again replaces their entry from an older link.
    for (const old of friends.filter((f) => f.l && f.name === friend.name)) {
      selectedFriends.delete(old.id);
      try {
        localStorage.removeItem("studyslot.friend." + old.id);
      } catch {}
    }
    friends = friends.filter((f) => !(f.l && f.name === friend.name));
  }
  const index = friends.findIndex((f) => f.id === friend.id);
  if (index >= 0) friends[index] = friend;
  else friends.push(friend);
  selectedFriends.add(friend.id);
  saveFriends();
  if (parsed.legacy) await loadFriend(friend, true);
  return friend;
}

async function loadFriend(friend, force = false) {
  const cached = store.get("friend." + friend.id);
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < STALE_MS) return;
  try {
    const d = friend.t ? await fetchFriend(friend.t) : await fetchTimetable(friend.l);
    store.set("friend." + friend.id, { classes: d.classes, fetchedAt: d.fetchedAt });
    delete friend.error;
  } catch (err) {
    friend.error = err.message;
  }
  if (view === "friends") renderFriends();
}

const friendClasses = (friend) => filterClasses(store.get("friend." + friend.id)?.classes, friend.g, friend.h);

function renderFriends() {
  const chips = $("#friend-chips");
  const body = $("#friends-body");
  chips.replaceChildren(
    ...friends.map((f) =>
      h(
        "button",
        {
          class: "friend-chip" + (selectedFriends.has(f.id) ? " on" : ""),
          "aria-pressed": String(selectedFriends.has(f.id)),
          style: { "--hue": hue(f.name) },
          onclick: () => {
            selectedFriends.has(f.id) ? selectedFriends.delete(f.id) : selectedFriends.add(f.id);
            saveFriends();
            renderFriends();
          },
        },
        h("span", { class: "avatar" }, f.name.slice(0, 1).toUpperCase()),
        f.name,
      ),
    ),
    h("button", { class: "friend-chip add", onclick: openAddFriend }, "+ Add"),
    h("button", { class: "friend-chip add", onclick: openShare }, "Share mine"),
  );

  if (!friends.length) {
    chips.hidden = true;
    body.replaceChildren(
      h(
        "div",
        { class: "empty friends-empty" },
        h("b", {}, "Find free time with friends"),
        "Swap Studyslot links with friends to see when you're all free and which classes you share.",
        h(
          "div",
          { class: "empty-actions" },
          h("button", { class: "btn", onclick: openShare }, "Share my timetable"),
          h("button", { class: "row-btn", onclick: openAddFriend }, "Add a friend"),
        ),
      ),
    );
    return;
  }
  chips.hidden = false;

  const picked = friends.filter((f) => selectedFriends.has(f.id));
  // The next five weekdays (plus weekend days with classes).
  const days = [];
  for (let k = todayKey(); days.length < 5; k = addDays(k, 1)) {
    const dow = fromKey(k).getDay();
    if (dow !== 0 && dow !== 6) days.push(k);
  }
  if (!friendDay || !days.includes(friendDay)) friendDay = days[0];

  const mine = visibleClasses();
  const theirs = picked.map(friendClasses);
  const free = freeTogether(friendDay, [mine, ...theirs]);
  const shared = classesInCommon(mine, theirs, friendDay);
  const names = picked.map((f) => f.name);
  const who = names.length
    ? `You and ${names.length > 1 ? names.slice(0, -1).join(", ") + " & " + names.at(-1) : names[0]}`
    : "You";

  body.replaceChildren(
    ...friends
      .filter((f) => f.error)
      .map((f) => h("p", { class: "banner" }, `Couldn't load ${f.name}'s timetable: ${f.error}`)),
    ...friends
      .filter((f) => f.l && !f.error)
      .map((f) =>
        h(
          "p",
          { class: "banner" },
          `${f.name} was added with an older, less private link (${OLD_LINK}). Ask them to share their Studyslot link again.`,
        ),
      ),
    h(
      "div",
      { id: "friend-days", class: "day-strip", style: { "--days": days.length }, role: "tablist", "aria-label": "Day" },
      days.map((k) =>
        h(
          "button",
          {
            role: "tab",
            class: [k === friendDay && "active", k === todayKey() && "today"].filter(Boolean).join(" "),
            "aria-selected": String(k === friendDay),
            onclick: () => {
              friendDay = k;
              renderFriends();
            },
          },
          fromKey(k).toLocaleDateString([], { weekday: "short" }),
          h("b", {}, String(fromKey(k).getDate())),
          h("span", { class: "count" }, `${freeTogether(k, [mine, ...theirs]).length} free`),
        ),
      ),
    ),
    h("div", { class: "day-head" }, `Free together`),
    h(
      "p",
      { class: "hint" },
      `${who}, between 9:00 and 18:00 on ${fromKey(friendDay).toLocaleDateString([], { weekday: "long" })}.`,
    ),
    ...(picked.length
      ? free.length
        ? free.map(([a, b]) =>
            h(
              "div",
              { class: "free-slot" },
              h(
                "span",
                { class: "slot-time" },
                `${time(new Date(a).toISOString())}–${time(new Date(b).toISOString())}`,
              ),
              h("span", { class: "slot-len" }, duration(b - a)),
            ),
          )
        : [h("div", { class: "empty" }, h("b", {}, "No free time together"), "Try another day.")]
      : [h("div", { class: "empty" }, "Tap a friend above to include them.")]),
    ...(shared.length ? [h("div", { class: "day-head" }, "In class together"), ...shared.map(classCard)] : []),
  );
}

// Share my timetable with a friend (QR code + link).
async function openShare() {
  const box = $("#qr");
  const button = $("#share-link");
  box.textContent = "Creating your private link…";
  button.disabled = true;
  $("#my-name").value = myName();
  // Also called to redraw after a name change or a reset, with the sheet already open.
  if (!isOpen($("#share-sheet"))) {
    $("#share-back").hidden = true;
    resetReset();
    openSheet($("#share-sheet"));
  }
  let url;
  try {
    url = `${location.origin}/?friend=${(await myShare()).token}`;
  } catch (err) {
    box.textContent = err.message;
    return;
  }
  button.disabled = false;
  if (window.qrcode) {
    const qr = window.qrcode(0, "L");
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } else {
    box.textContent = "QR codes need an internet connection. Use Send my link instead.";
  }
  button.onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "My Studyslot timetable",
          text: "Add me on Studyslot to see when we're both free:",
          url,
        });
      } catch {}
    } else {
      copyText(url, button, "Send my link");
    }
  };
}
$("#my-name").addEventListener("change", () => {
  store.set("name", $("#my-name").value.trim());
  openShare(); // redraw the QR with the new name
});

// After adding a friend, offer to share back so they can see me too.
function shareBack(name) {
  if (!link) return; // nothing to share yet
  openShare();
  $("#share-back").textContent = `Send ${name} your link too, so they can see when you're both free.`;
  $("#share-back").hidden = false;
}

// Reset my link: every link and QR code I've shared stops working, and a new one replaces it.
// Asks for a second tap first, like removing the timetable.
let resetArmed = false;
let resetTimer = null;
function resetReset() {
  resetArmed = false;
  clearTimeout(resetTimer);
  $("#share-reset").textContent = "Reset my link";
  $("#share-reset").disabled = false;
  $("#share-reset-status").hidden = true;
}
$("#share-reset").addEventListener("click", async () => {
  const button = $("#share-reset");
  const status = $("#share-reset-status");
  if (!resetArmed) {
    resetArmed = true;
    button.textContent = "Tap again to reset";
    resetTimer = setTimeout(resetReset, 4000);
    return;
  }
  clearTimeout(resetTimer);
  resetArmed = false;
  button.disabled = true;
  button.textContent = "Resetting…";
  try {
    await myShare("friend", { reset: true });
  } catch (err) {
    button.disabled = false;
    button.textContent = "Reset my link";
    status.textContent = err.message;
    status.hidden = false;
    return;
  }
  button.textContent = "Reset my link";
  button.disabled = false;
  status.textContent =
    "Done. Your old link and QR code stop working within a minute. Send this new one to friends you still want to share with.";
  status.hidden = false;
  openShare(); // show the new QR code
});

function openAddFriend() {
  $("#friend-input").value = "";
  $("#friend-error").hidden = true;
  openSheet($("#friend-sheet"));
}

$("#friend-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const showError = (message) => {
    $("#friend-error").textContent = message;
    $("#friend-error").hidden = false;
  };
  const parsed = parseFriendLink($("#friend-input").value);
  if (!parsed) return showError("That isn't a Studyslot friend link. Ask your friend to tap Share mine in Studyslot.");
  if (parsed.expired)
    return showError("That's an old Studyslot link that no longer works. Ask your friend to share it again.");
  if (parsed.legacy?.l === link) return showError("That's your own timetable.");
  $("#friend-submit").disabled = true;
  let added;
  try {
    added = await addFriend(parsed);
  } catch (err) {
    return showError(err.message);
  } finally {
    $("#friend-submit").disabled = false;
  }
  closeSheets();
  view = "friends";
  render();
  shareBack(added.name);
});

// Opened someone's friend link (?friend=…).
function checkIncomingFriend() {
  const parsed = parseFriendLink(location.search + location.hash);
  if (!parsed) return;
  history.replaceState(null, "", location.pathname);
  if (parsed.legacy?.l === link) return;
  const describe = (name) => {
    $("#incoming-title").textContent = `Add ${name}?`;
    $("#incoming-text").textContent =
      `${name} shared their timetable with you. Add them to see when you're both free.` +
      (parsed.legacy ? ` This is an older, less private link (${OLD_LINK}); ask them to share it again.` : "");
  };
  describe(parsed.legacy?.n || "your friend");
  $("#incoming-add").hidden = false;
  if (parsed.expired) {
    $("#incoming-title").textContent = "This link has expired";
    $("#incoming-text").textContent =
      "It's an old Studyslot link that no longer works. Ask whoever sent it to share it again.";
    $("#incoming-add").hidden = true;
  } else if (parsed.token && !parsed.legacy) {
    // Show the friend's name once the server has read the link.
    fetchFriend(parsed.token)
      .then((d) => d.name && describe(d.name))
      .catch(() => {});
  }
  $("#incoming-add").onclick = async () => {
    let added;
    try {
      added = await addFriend(parsed);
    } catch (err) {
      $("#incoming-text").textContent = err.message;
      return;
    }
    closeSheets();
    if (link) {
      view = "friends";
      render();
      shareBack(added.name);
    }
  };
  $("#incoming-copy").onclick = () =>
    copyText(`${location.origin}/?friend=${parsed.token}`, $("#incoming-copy"), "Copy link");
  openSheet($("#incoming"));
}

// ---------- Sheets ----------

// Sheets are modal dialogs: focus moves into them, Tab stays inside, and closing returns
// focus to whatever opened them.
//
// They rise from the bottom edge and leave the same way, on a spring: drag one down by its top
// bar, flick it away, or catch it while it's still moving. A sheet that's on its way out has the
// class "closing" and no longer counts as open.
let sheetOpener = null;
const openSheetEl = () => document.querySelector(".sheet:not([hidden]):not(.closing)");
const isOpen = (sheet) => !sheet.hidden && !sheet.classList.contains("closing");
const focusables = (el) =>
  [...el.querySelectorAll("button, [href], input, select, textarea, summary")].filter(
    (x) => !x.disabled && !x.closest("[hidden]"),
  );

const sheetMotion = new Map(); // sheet -> { y, anim }, where y = 0 is fully open
const motionOf = (sheet) => sheetMotion.get(sheet) || sheetMotion.set(sheet, { y: 0, anim: null }).get(sheet);
const closedY = (sheet) => sheet.offsetHeight + 24; // just past the bottom edge, shadow included

// The scrim darkens as much as the most-open sheet is open, so it follows a drag too.
function updateScrim() {
  let shown = 0;
  for (const sheet of document.querySelectorAll(".sheet:not([hidden])")) {
    const fadingOut = reduceMotion() && sheet.classList.contains("closing");
    const height = closedY(sheet);
    if (!fadingOut) shown = Math.max(shown, height ? 1 - motionOf(sheet).y / height : 1);
  }
  $("#scrim").style.opacity = Math.min(1, Math.max(0, shown));
  $("#scrim").classList.toggle("passive", !openSheetEl());
}

function setSheetY(sheet, y) {
  motionOf(sheet).y = y;
  sheet.style.transform = y ? `translateY(${y}px)` : "";
  updateScrim();
}

/** Moves a sheet to `to` from wherever it is now, keeping its current speed. */
function moveSheet(sheet, to, { velocity = 0, response = 0.35, damping = 1 } = {}, onDone) {
  const m = motionOf(sheet);
  m.anim?.stop();
  if (reduceMotion() || !sheet.animate) {
    // A cross-fade instead of a slide.
    const closing = to > 0;
    if (!closing) setSheetY(sheet, 0);
    updateScrim();
    const fade = sheet.animate?.([{ opacity: closing ? 1 : 0 }, { opacity: closing ? 0 : 1 }], { duration: 200 });
    const finish = () => {
      m.anim = null;
      if (closing) setSheetY(sheet, to);
      onDone?.();
    };
    if (fade) {
      fade.onfinish = finish;
      m.anim = { stop: () => (fade.cancel(), { value: m.y, velocity: 0 }) };
    } else finish();
    return;
  }
  m.anim = spring({
    from: m.y,
    to,
    velocity,
    response,
    damping,
    onUpdate: (y) => setSheetY(sheet, y),
    onDone: () => {
      m.anim = null;
      onDone?.();
    },
  });
}

function openSheet(sheet) {
  if (!openSheetEl()) sheetOpener = document.activeElement;
  $("#scrim").hidden = false;
  const appearing = sheet.hidden;
  sheet.hidden = false;
  sheet.classList.remove("closing");
  sheet.inert = false;
  if (appearing) setSheetY(sheet, closedY(sheet));
  moveSheet(sheet, 0);
  focusables(sheet)[0]?.focus({ preventScroll: true });
}

function closeSheet(sheet, velocity = 0) {
  sheet.classList.add("closing");
  sheet.inert = true;
  moveSheet(sheet, closedY(sheet), { velocity, response: 0.3 }, () => {
    sheet.hidden = true;
    sheet.classList.remove("closing");
    sheet.inert = false;
    if (!document.querySelector(".sheet:not([hidden])")) $("#scrim").hidden = true;
  });
}

function closeSheets({ velocity = 0 } = {}) {
  const wasOpen = openSheetEl();
  document.querySelectorAll(".sheet").forEach((sheet) => isOpen(sheet) && closeSheet(sheet, velocity));
  if (wasOpen && sheetOpener?.isConnected) sheetOpener.focus();
  sheetOpener = null;
}

// Drag a sheet by its top bar. It tracks the finger 1:1 from where it was grabbed, resists being
// pulled up, and on release goes wherever the flick was heading.
function makeDraggable(sheet) {
  sheet.prepend(h("div", { class: "sheet-grab", "aria-hidden": "true" }));
  let drag = null;
  let dragged = false;

  sheet.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !isOpen(sheet) || !e.target.closest(".sheet-grab, .sheet-bar")) return;
    const m = motionOf(sheet);
    const caught = !!m.anim; // grabbed while still moving: hold it where it is
    if (caught) {
      m.anim.stop();
      m.anim = null;
    }
    drag = { id: e.pointerId, startY: e.clientY, from: m.y, caught, active: false, tracker: velocityTracker() };
    drag.tracker.add(e.clientY, e.timeStamp);
  });

  sheet.addEventListener("pointermove", (e) => {
    if (drag?.id !== e.pointerId) return;
    drag.tracker.add(e.clientY, e.timeStamp);
    const dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < 8 && !drag.caught) return; // a tap on Done shouldn't nudge the sheet
      drag.active = true;
      sheet.setPointerCapture(e.pointerId);
    }
    const y = drag.from + dy;
    setSheetY(sheet, y < 0 ? -rubberband(-y, sheet.offsetHeight) : y);
  });

  const release = (e) => {
    if (drag?.id !== e.pointerId) return;
    const { active, caught, tracker } = drag;
    drag = null;
    if (!active && !caught) return;
    dragged = active;
    setTimeout(() => (dragged = false)); // the click, if any, comes before this
    tracker.add(e.clientY, e.timeStamp);
    const velocity = e.type === "pointercancel" ? 0 : tracker.velocity();
    const y = motionOf(sheet).y;
    // Decide from where the gesture was heading, not just where it let go.
    if (y + project(velocity) > sheet.offsetHeight * 0.4) closeSheets({ velocity });
    else moveSheet(sheet, 0, { velocity, response: 0.3, damping: velocity ? 0.85 : 1 });
  };
  sheet.addEventListener("pointerup", release);
  sheet.addEventListener("pointercancel", release);

  // A drag that started on Done or Cancel isn't a tap on it.
  sheet.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}
document.querySelectorAll(".sheet").forEach(makeDraggable);

$("#scrim").addEventListener("click", closeSheets);
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheets));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheets();
  const sheet = openSheetEl();
  if (e.key !== "Tab" || !sheet) return;
  const items = focusables(sheet);
  const first = items[0];
  const last = items.at(-1);
  if (!sheet.contains(document.activeElement)) {
    e.preventDefault();
    first?.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

// Tab strips (views and days): arrow keys move between tabs, and keyboard focus stays on the
// selected tab when a strip is redrawn.
document.addEventListener(
  "click",
  (e) => {
    const list = e.target.closest?.('[role="tab"]')?.closest('[role="tablist"]');
    if (!list?.id || !list.contains(document.activeElement)) return;
    queueMicrotask(() => document.querySelector(`#${list.id} [aria-selected="true"]`)?.focus());
  },
  true,
);
document.addEventListener("keydown", (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  const tab = e.target.closest?.('[role="tab"]');
  if (!step || !tab) return;
  const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  e.preventDefault();
  tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length].click();
});

$("#open-settings").addEventListener("click", () => {
  fillSettings();
  openSheet($("#settings"));
});
$("#feedback").addEventListener("click", () => {
  const body = [
    "What happened, or what would you like Studyslot to do?",
    "",
    "",
    "---",
    "College: TU Dublin",
    `App version: ${APP_VERSION}`,
    `Device: ${navigator.userAgent}`,
    "(Your timetable link is not included.)",
  ].join("\n");
  location.href = `mailto:${CONTACT}?subject=${encodeURIComponent("Studyslot feedback")}&body=${encodeURIComponent(body)}`;
});

$("#change-link").addEventListener("click", () => {
  closeSheets();
  showWelcome();
});
let forgetArmed = false;
$("#forget").addEventListener("click", () => {
  if (!forgetArmed) {
    forgetArmed = true;
    $("#forget").textContent = "Tap again to remove everything";
    setTimeout(() => {
      forgetArmed = false;
      $("#forget").textContent = "Remove my timetable from this device";
    }, 3000);
    return;
  }
  store.clear();
  link = null;
  data = null;
  groups = {};
  hidden = new Set();
  closeSheets();
  showWelcome();
});

// ---------- Start ----------

if (link && data) {
  showApp();
  refresh();
} else if (link) {
  refresh({ force: true });
} else {
  showWelcome();
}

friends.forEach((f) => loadFriend(f));
checkIncomingFriend();

// Sharing links became private (encrypted). Tell existing students once to share again.
if (link && !store.get("privateLinksNotice")) {
  const notice = $("#notice");
  notice.hidden = false;
  notice.replaceChildren(
    h(
      "span",
      {},
      `Studyslot links are now private. If you've added your timetable to a calendar app or shared it with friends, please do it again (${OLD_LINK}).`,
    ),
    h(
      "button",
      {
        class: "text-btn",
        onclick: () => {
          store.set("privateLinksNotice", true);
          notice.hidden = true;
        },
      },
      "OK",
    ),
  );
}

// Keep "Now" current and refresh when coming back to the app.
setInterval(() => {
  if (!$("#app").hidden && view === "today") renderNowCard();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && link) {
    render();
    refresh();
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
