# Studyslot

Your college timetable, cleaned up. Students paste their timetable calendar link and get a clear view of what's on, where it is and when, without module codes, group labels and capacity numbers.

- **Works with any college** that offers a calendar link (iCal / webcal), including TU Dublin's Scientia timetables, Google Calendar and Outlook.
- **No accounts.** The link, group choices and hidden modules are saved only on the student's device.
- **Nothing stored on the server.** Each refresh fetches the timetable, cleans it and returns it.
- **Today view:** "Now" (highlighted, with time left) or "Next", then the day's classes with free gaps between them.
- **Week view:** day strip with class counts. Weekends appear only when there are classes.
- **Groups:** when a timetable lists Lab A and Lab B at the same time, students pick their group once.
- **Hide modules** they don't take, and use it **offline** once loaded.
- **Week numbers:** "Week 4 of 12" in the header. Terms are detected from when classes run, and reading weeks show as "no classes".
- **Add to your calendar:** a cleaned calendar link (`/feed/<token>.ics`) for Apple or Google Calendar, with the chosen groups, hidden modules and a 10-minute alert before each class. The phone's own calendar then handles widgets, Apple Watch and notifications.
- **Friends:** share your timetable by QR code or link, add friends' links, and see **free time together** (9:00–18:00) and **classes you share**. Friends' links are saved only on your device.

### First-run setup
New students pick their **college**, **course** and **year**, then add their link. For Dublin's universities (Trinity, UCD, DCU, TU Dublin, RCSI), the course step is a searchable list of every undergraduate CAO course (`public/courses.json`, 411 courses). Other colleges type their course.

To refresh the course lists (CAO adds and renames courses each year):
```
node scripts/fetch-courses.js
```
To add a college, add its CAO code in `scripts/fetch-courses.js` and in the `CAO` map in `public/app.js`.

## How it works

```
Phone (Studyslot web app, link saved locally)
   │  GET /api/timetable?link=…&tz=Europe/Dublin
   ▼
Cloudflare Worker ──fetch──▶ college calendar link (.ics)
   │  parse → expand repeats → clean titles/rooms → merge back-to-back slots
   ▼
JSON classes ──▶ saved on the phone, refreshed every 30 min when opened
```

| File | Purpose |
|---|---|
| `src/index.js` | The single API endpoint (validates the link, fetches, cleans) |
| `src/timetable.js` | Timetable parsing and cleanup (shared logic with Mulberry) |
| `src/ical.js`, `src/time.js` | iCalendar reading and time zones |
| `public/` | The app: `index.html`, `app.css`, `app.js`, offline service worker, icons |

## Run and deploy

```
npm install
npm run dev        # http://localhost:8787
npm run deploy     # publishes to https://studyslot.<your-subdomain>.workers.dev
```

It runs on Cloudflare's free plan, with no database and no secrets needed.

## Privacy, legal and safety

- **Privacy Policy** (`/privacy`) and **Terms of Use** (`/terms`) are written for Irish and EU law (GDPR, ePrivacy), and linked from the welcome screen and Settings. They are drafts, not legal advice: get them reviewed by a solicitor (or your college's enterprise or legal office) before a wide launch.
- **No third-party requests:** the font (`public/fonts`, SIL OFL) and QR library (`public/vendor`, MIT) are self-hosted, so the app sends nothing to Google or any CDN. Their licence files ship alongside them.
- **No cookies.** Local storage is used only for features the student asks for, which is exempt from consent under S.I. 336/2011.
- **Abuse protection:** per-visitor rate limit on timetable lookups (20 a minute) and per-student limit on calendar feeds (10 a minute). Links with passwords, raw IP addresses or unusual ports are rejected. Fetches time out after 12 s, and files over 6 MB are rejected. Only public addresses are fetched (`global_fetch_strictly_public`).
- **Security headers** (`public/_headers`): strict Content-Security-Policy, no framing, no referrer, locked-down permissions.
- Calendar-feed and friend links contain the student's timetable link (base64-encoded, not encrypted). Anyone with one can see that timetable, so the app tells students to share only with people they trust.

## Launch checklist

These need you; I can't do them:

1. **Fill in your name** in `public/privacy.html` and `public/terms.html` (replace `[Your name]`). `npm run deploy` refuses to run until you do (`scripts/check-launch.js`).
2. **Buy the domain** `studyslot.ie` (about €10–20 a year, e.g. through Cloudflare or an Irish registrar; .ie needs a connection to Ireland, which you have). Then add it to Cloudflare and uncomment the `routes` line in `wrangler.jsonc`.
3. **Set up email** for `hello@studyslot.ie`. Cloudflare Email Routing is free and forwards it to your own inbox, so your personal address stays private.
4. **Check the name:** search the EU trademark register ([TMview](https://www.tmdn.org/tmview)) for "Studyslot". If you want protection, an EU trademark costs from €850; an Irish one starts lower.
5. **Have the legal pages reviewed**, ideally before sharing widely.
6. **Test on real phones:** at least one iPhone (Safari) and one Android (Chrome).
