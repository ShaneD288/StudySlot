# Morning report: overnight/2026-10-03

Branch `overnight/2026-10-03`, created from `main` at `4a8f98f`. Nothing was pushed, merged or deployed.

## How to review

```
git switch overnight/2026-10-03
npm ci
git log --oneline main..overnight/2026-10-03
npm test             # all tests
npm run lint         # ESLint
npm run format:check # Prettier
npm run dev          # try the app at http://localhost:8787
```

## What was done

| Task                                            | Commit    |
| ----------------------------------------------- | --------- |
| Remove leftover Mulberry references             | `1b65961` |
| Neutral "Before launch" list in the README      | `bc5b3d3` |
| MIT licence (holder "Shane": please confirm)    | `29f6a01` |
| `.editorconfig` and Prettier config             | `1a38e8f` |
| Format the codebase (separate commit)           | `b99bd48` |
| Vitest and `npm test`                           | `00cbdb2` |
| Synthetic Scientia fixture (`test/fixtures/`)   | `3ed01cf` |
| Tests: `src/ical.js`                            | `b90d237` |
| Tests: `src/time.js` (Dublin daylight saving)   | `eb8364b` |
| Tests: `src/timetable.js`                       | `aabbe87` |
| Tests: Worker (`src/index.js`)                  | `abdf6ba` |
| [DECIDE] Move pure app logic into `public/lib/` | `2cfdb32` |
| Tests: free time together                       | `6b64ae9` |
| CI workflow (ESLint, Prettier check, tests)     | `6e5d618` |
| Deploy workflow (after CI passes on main)       | `712149d` |
| CI badge in README                              | `422850f` |

## Decisions made for you (all reversible)

- **[DECIDE] `public/lib/` modules: done (the default).** Date helpers, week numbers, class
  filtering, "classes in common" and free time moved verbatim into `public/lib/*.js`. The only
  change: functions that read globals (`data.weeks`, `groups`, `hidden`) now take them as
  arguments. The service worker caches the new files, and its cache name went to `studyslot-v3`.
- **Worker tests call the Worker directly in Node with a mocked `fetch`**, rather than
  `@cloudflare/vitest-pool-workers`. Node 24 has every API `src/index.js` uses, so the tests are
  fast and don't need another tool. The trade-off: they don't run inside the real `workerd`
  runtime. If you want that for the CV, adding the pool later is a small change.
- **ESLint added** as the CI "lint" step (`npm run lint`, recommended rules only). It found one
  unused variable (`start` in `classCard`), which I removed.
- **happy-dom smoke test** (`test/app.smoke.test.js`) boots the real `index.html` + `app.js`
  with a saved timetable, to prove the refactor didn't break the app. It isn't a substitute
  for trying it in a real browser.
- **Prettier `printWidth` is 120**, close to the existing style. The formatting commit is large
  but layout-only.
- **`package-lock.json` was regenerated from scratch.** npm 11.5 has a bug
  ([npm/cli#4828](https://github.com/npm/cli/issues/4828)) that drops the native binding Vitest
  needs (rolldown) for other platforms, which would break `npm ci` on GitHub's Linux runners.
  If you add a dependency later and `npm test` says "Cannot find native binding", delete
  `node_modules` and `package-lock.json` and run `npm install` again (or update npm).
- **Deploy runs only after CI passes on a push to main**, uses `npm run deploy` (so
  `scripts/check-launch.js` still blocks a launch with `[Your name]` placeholders), and runs in
  a GitHub `production` environment so you can add a manual approval step later if you want.
- `CLAUDE.md` is still untracked. I ticked the tasks in it but didn't commit it: it describes
  the overnight AI workflow, and it's your call whether that belongs in a public portfolio repo.

## Needs you ([SHANE] tasks)

Filled in after the later phases below.

## Blocked or not done

- **Unused calendar-writing code in `src/ical.js` and `src/time.js` was left in place.** `buildEvent`,
  `patchEvent`, `timeLines` (ical.js) and `buildVTimezone`, `addDays` (time.js) are never
  called. They came from another project (`PRODID:-//Personal Assistant//EN`, shift/job
  fields). Removing them wasn't on the task list and my attempt was blocked by the session's
  permission checks, so I left them. Suggest deleting them yourself: less code to explain in an
  interview.
- **Plain `http://` timetable links are still accepted.** The task said "non-https" links should
  be rejected, but `normalizeLink` deliberately allows `http://` and some college servers may
  only offer it. The tests check that `ftp:`, `file:`, `javascript:` etc. are rejected. If you
  want https-only, change the regex in `normalizeLink` and the error message.

## Learn the code over breakfast

### Tests for `src/ical.js`

`parseEvents` turns iCalendar text into one object per `VEVENT`. It first unfolds lines (RFC 5545
wraps long lines with CRLF + space), skips properties in nested blocks such as `VALARM`, and
merges split `EXDATE` lines. The tests cover each of those, plus escaped text (`\,` `\;` `\n`),
time zones (TZID, UTC `Z`, floating times, Windows zone names from Outlook) and durations.

**Q: Why does the parser need to "unfold" lines before splitting them?**
A: iCalendar limits lines to 75 octets, so long values are split across lines with a newline
followed by a space or tab. If you split on newlines first, a folded description would become
two broken properties. Removing every "newline + whitespace" first gives one logical line per
property.

### Tests for `src/time.js`

Workers run in UTC, so `localToUtc` converts "09:00 in Europe/Dublin" to an instant using
`Intl.DateTimeFormat`. The tests pin down both clock changes (last Sunday in March and
October), including the edge cases: 01:30 on the March night doesn't exist and moves forward
an hour; 01:30 on the October night happens twice and is read as the later (GMT) one.

**Q: How do you find a time zone's UTC offset without a library?**
A: Format the instant in that zone with `Intl.DateTimeFormat`, read the parts back as if they
were UTC, and subtract. `localToUtc` does this twice (guess, then correct) so it lands on the
right side of a daylight-saving change.

### Tests for `src/timetable.js`

`extractClasses` expands weekly/daily repeat rules day by day in the class's own wall-clock
time, applies moved or cancelled occurrences (`RECURRENCE-ID`), skips `EXDATE`s and all-day
entries, cleans each title and room, then merges back-to-back slots of the same class. The
fixture checks all of it on a realistic term with a reading week and the October clock change.

**Q: Why expand repeats in local time instead of adding 7 × 24 hours?**
A: Because a 9:00 lecture is at 08:00 UTC in September and 09:00 UTC in November. Adding a
fixed number of milliseconds would move it to 8:00 after the clocks go back.

### Worker tests (`src/index.js`)

The tests import the Worker and call its `fetch(request, env)` handler directly, with the
global `fetch` replaced by a mock that plays the college's server. That lets them check every
error path (bad links never get fetched, web pages, 404s, files over 6 MB, rate limits)
without any network.

**Q: Why reject links with raw IP addresses or custom ports?**
A: To stop the Worker being used for server-side request forgery, i.e. tricking it into
calling internal or unusual services. `global_fetch_strictly_public` blocks private addresses
too, so this is defence in depth.

### `public/lib/` refactor and free-time tests

The app was one script that ran on load and touched the DOM, so none of it could be
imported into a test. The pure parts now live in small ES modules that both `app.js` and the
tests import. `freeTogether` collects everyone's classes for a day, clips them to 9:00–18:00,
sorts them, and walks through them with a cursor to find gaps of at least 30 minutes.

**Q: How does `freeTogether` handle overlapping classes from different friends?**
A: It doesn't need to merge them first. After sorting by start time it keeps a cursor at
the latest end time seen so far (`cursor = max(cursor, end)`), so an overlapping or nested
class just pushes the cursor forward. A gap is recorded only when the next class starts at
least 30 minutes after the cursor.

### CI and deploy workflows

`ci.yml` runs on every push and pull request: `npm ci`, ESLint, Prettier check, tests.
`deploy.yml` listens for the CI workflow finishing on main and deploys the exact commit CI
tested, but only if CI passed.

**Q: Why `workflow_run` instead of putting deploy in the same workflow?**
A: It keeps the two workflows separate (deploy secrets are never available to pull-request
runs), and it guarantees deploy only starts after CI has passed for that commit. A single
workflow with `needs:` would also work; this layout makes "CI must pass" explicit.
