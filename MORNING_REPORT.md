# Morning report: overnight/2026-10-03

Branch `overnight/2026-10-03`, created from `main` at `4a8f98f`: 27 commits, all tests passing (202).
Nothing was pushed, merged or deployed, and no Cloudflare or GitHub APIs were called.

## How to review

```
git switch overnight/2026-10-03
npm ci
git log --oneline main..overnight/2026-10-03
npm test             # 202 tests
npm run lint         # ESLint
npm run format:check # Prettier
cp .dev.vars.example .dev.vars   # already done on this Mac: .dev.vars has a random local SHARE_KEY
npm run dev                      # try the app at http://localhost:8787
```

Worth trying by hand in a browser (the tests can't fully cover these): Settings → "Add to your
calendar" links, Friends → "Share mine" (QR code), adding a friend from that link in another
browser profile, and keyboard-only use (Tab, arrow keys on the Today/Week/Friends tabs, Escape).

## What was done

| Phase | Task                                                               | Commit               |
| ----- | ------------------------------------------------------------------ | -------------------- |
| 0     | Remove leftover Mulberry references                                | `1b65961`            |
| 0     | Neutral "Before launch" list in the README                         | `bc5b3d3`            |
| 0     | MIT licence (holder "Shane": please confirm)                       | `29f6a01`            |
| 0     | `.editorconfig` and Prettier config                                | `1a38e8f`            |
| 0     | Format the codebase (separate commit)                              | `b99bd48`            |
| 1     | Vitest and `npm test`                                              | `00cbdb2`            |
| 1     | Synthetic Scientia fixture (`test/fixtures/`)                      | `3ed01cf`            |
| 1     | Tests: `src/ical.js`                                               | `b90d237`            |
| 1     | Tests: `src/time.js` (Dublin daylight saving)                      | `eb8364b`            |
| 1     | Tests: `src/timetable.js`                                          | `aabbe87`            |
| 1     | Tests: Worker (`src/index.js`)                                     | `abdf6ba`            |
| 1     | [DECIDE] Move pure app logic into `public/lib/`                    | `2cfdb32`            |
| 1     | Tests: free time together                                          | `6b64ae9`            |
| 2     | CI workflow (ESLint, Prettier check, tests)                        | `6e5d618`            |
| 2     | Deploy workflow (after CI passes on main)                          | `712149d`            |
| 2     | CI badge in README                                                 | `422850f`            |
| 3     | [DECIDE] Option A (encrypted tokens): write-up below               | this report          |
| 3     | Implement Option A, old links keep working with a re-share message | `9d369d5`            |
| 3     | Free/busy-only sharing: skipped as instructed, idea below          | n/a                  |
| 3     | Tests: tokens, decoding, tampering, old links                      | `b2a4179`            |
| 3     | Privacy policy and README privacy section                          | `1c372fb`            |
| 4     | Lighthouse-style review (by reading the code)                      | `4955284`            |
| 4     | Accessibility pass                                                 | `302a89f`, `95115c2` |
| 4     | Service worker `VERSION` bumped and tied to the release version    | `04fb422`            |
| 5     | README restructure, design decisions, bullet-point drafts          | `820108a`            |
| 5     | `CHANGELOG.md` (tag `v1.0.0` waits for launch)                     | `1b821cd`            |
| 6     | Skipped (after launch)                                             | n/a                  |

## Decisions made for you (all reversible)

### Phase 3: friend and feed links, Option A (encrypted tokens), the default

|                     | **A: encrypted tokens** (chosen)    | **B: revocable tokens in KV**                                       |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| What's in the link  | Settings encrypted with AES-256-GCM | A random id; the settings live in Cloudflare KV                     |
| Server storage      | None (just the `SHARE_KEY` secret)  | Every shared link, until deleted                                    |
| Read the link?      | No                                  | No                                                                  |
| Tamper with it?     | Detected (GCM tag) and rejected     | Nothing to tamper with                                              |
| Revoke one link     | Not possible                        | Yes ("stop sharing" deletes the KV entry)                           |
| Revoke all links    | Rotate `SHARE_KEY`                  | Delete the namespace                                                |
| Privacy policy      | Small change (links now encrypted)  | Big change: server now stores timetable links, needs retention rule |
| Cost and complexity | Web Crypto only, no new bindings    | KV binding, writes on every share, cleanup of stale entries         |

Chosen: A, because it keeps the "nothing stored on the server" promise that the privacy policy and
the app's design rest on. How it's built:

- `src/share.js`: HKDF derives two keys from `SHARE_KEY`, one for AES-256-GCM and one for HMAC.
  Token = `[version byte 1][12-byte random IV][ciphertext + 16-byte tag]`, base64url.
- `POST /api/share`: the app sends `{ l, g, h, z, n }`; the Worker validates and cleans them
  (same link checks as the reader, size limit 16 KB) and returns `{ token, id }`. The app saves the
  token and reuses it until the settings change.
- `GET /api/friend?token=`: returns the friend's name and classes, already filtered by their
  groups and hidden modules. **The friend's timetable link never reaches your phone.** `id` is an
  HMAC of the link, so the app can spot duplicates and "that's your own link" without seeing it.
- `/feed/<token>.ics` accepts the new tokens.
- **Old base64 links keep working until 1 February 2027** (`LEGACY_TOKENS_UNTIL` in
  `src/share.js`, `LEGACY_LINKS_UNTIL` in `public/lib/share-links.js`). Until then, existing users
  see a one-time "links are now private, please share again" notice. Friends added from old links
  show a "ask them to share again" banner, and old calendar feeds say so in their calendar
  description. After the date, old feed links get `410 Gone` and old friend links show "expired".
  Pick a different date if you like; change both constants and the privacy policy.
- When a friend shares again, their new entry replaces the old-link entry **with the same name**.
  This is a simple heuristic, because the app can't compare links any more.

### Other decisions

- **[DECIDE] `public/lib/` modules: done (the default).** Date helpers, week numbers, class
  filtering, "classes in common" and free time moved verbatim into `public/lib/*.js`. The only
  change: functions that read globals (`data.weeks`, `groups`, `hidden`) now take them as
  arguments.
- **Worker tests call the Worker directly in Node with a mocked `fetch`**, rather than
  `@cloudflare/vitest-pool-workers`. Node 24 has every API `src/index.js` uses, so the tests are
  fast and need no extra tooling. The trade-off is that they don't run inside the real `workerd`
  runtime. To cover that, I ran `wrangler dev` once and checked by hand that sharing, ids and
  tampering behave the same in `workerd`.
- **ESLint added** as the CI "lint" step (recommended rules only). It found one unused variable
  (`start` in `classCard`), which I removed.
- **happy-dom smoke test** (`test/app.smoke.test.js`) boots the real `index.html` + `app.js`, to
  prove refactors don't break the app. Not a substitute for a real browser.
- **Prettier `printWidth` is 120**, close to the existing style. The formatting commit is large but
  layout-only.
- **`package-lock.json` was regenerated from scratch (twice).** npm 11.5 has a bug
  ([npm/cli#4828](https://github.com/npm/cli/issues/4828)) that drops other platforms' native
  bindings for rolldown (used by Vitest) whenever you `npm install` a package, which would
  break `npm ci` on GitHub's Linux runners. If you add a dependency and `npm test` says "Cannot
  find native binding", delete `node_modules` and `package-lock.json` and run `npm install`
  (or update npm: 11.21 is out).
- **Deploy runs only after CI passes on a push to main.** It uses `npm run deploy`, so
  `scripts/check-launch.js` still blocks a launch while `[Your name]` placeholders remain, and it
  runs in a GitHub `production` environment so you can add a manual approval later.
- **Service worker version = package version** (`studyslot-1.0.0`); a test fails if `sw.js`,
  `APP_VERSION` and `package.json` disagree. Release = bump all three + CHANGELOG.
- **Colour contrast:** six of the twelve module colours (oranges, greens, cyans, yellow) had small
  text at about 2:1 contrast. Module-coloured text now uses 30% lightness (light mode) and the
  white-on-colour badges 32%, which passes 4.5:1 for every hue. Blues and purples get noticeably
  darker badges; a per-hue lightness table would keep them brighter if you prefer.
- **`.dev.vars`** (gitignored) has a random local `SHARE_KEY`; `.dev.vars.example` is committed.
- **No `v1.0.0` tag yet**: the task says to tag on launch; it's step 9 of `docs/launch-checklist.md`.
- `CLAUDE.md` is still untracked. I ticked the tasks in it but didn't commit it, because it
  describes the overnight AI workflow and it's your call whether that belongs in a public
  portfolio repo. The same goes for this report: it's committed on the branch, so drop it before
  merging if you don't want it on `main`.

## Needs you ([SHANE] tasks)

1. **Cloudflare API token + GitHub secrets** (Phase 2)
   - Cloudflare dashboard → My Profile → API Tokens → Create Token → template **Edit Cloudflare
     Workers** → Account Resources: your account; Zone Resources: All zones (or just
     `studyslot.ie` once added) → Continue → Create Token. Copy it (shown once).
   - Account ID: Cloudflare dashboard → Workers & Pages → right-hand sidebar, **Account ID**.
   - GitHub → ShaneD288/StudySlot → Settings → Secrets and variables → Actions → New repository
     secret: `CLOUDFLARE_API_TOKEN`, then `CLOUDFLARE_ACCOUNT_ID`.
2. **Production `SHARE_KEY`** (Phase 3). Without it, sharing and calendar links show "isn't
   available":
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   npx wrangler secret put SHARE_KEY     # paste the value
   ```
   Keep a copy in your password manager. Changing it later breaks every shared link (that's
   also how you revoke them all).
3. **Branch protection** (Phase 2): GitHub → Settings → Rules → Rulesets → New branch ruleset →
   target `main` → enable **Require a pull request before merging**, **Require status checks to
   pass** (add **Lint, format and test**; it's listed after CI has run once), and **Block force
   pushes** → Create.
4. **Your name** in `public/privacy.html` and `public/terms.html` (replace `[Your name]`).
   `npm run deploy` refuses to run until then.
5. **Domain:** buy `studyslot.ie`, add it to Cloudflare, then I (or you) uncomment the `routes`
   line in `wrangler.jsonc`.
6. **Email:** Cloudflare → your domain → Email → Email Routing → enable, then add
   `hello@studyslot.ie` → your inbox and verify it.
7. **Trademark check:** search "Studyslot" on [TMview](https://www.tmdn.org/tmview) (EU and Irish
   registers), classes 9 and 42.
8. **Real phones:** iPhone (Safari) and Android (Chrome): install to Home Screen, airplane-mode
   reload (offline), subscribe to the calendar feed (Apple and Google), add a friend by scanning
   the QR code, and open an old `?friend=` link to check the "older link" message.
9. **README in your own words:** the intro and "Design decisions" are bullet points marked with a
   hidden `DRAFT NOTES` comment. Also add screenshots/GIF and the live link (TODO comments).
10. **Compare the test fixture with a real Scientia export** (`test/fixtures/README.md` lists what
    it contains). If real exports use one `VEVENT` per class instead of `RRULE`s, or different
    title patterns, add a second fixture shaped like the real one.
11. **Confirm the licence holder:** `LICENSE` says "Shane". Use your full name if you prefer.
12. **Tag `v1.0.0` on launch** and date the CHANGELOG entry.
13. **Check GitHub Actions versions:** the workflows use `actions/checkout@v5` and
    `actions/setup-node@v5`. I couldn't check for newer majors offline; the first CI run will
    tell you if anything is deprecated.

### Usage numbers for the CV (write-up only, nothing implemented)

|                     | **Worker request counts** (Cloudflare dashboard)                                    | **Cloudflare Web Analytics**                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup               | None: Workers & Pages → studyslot → Metrics                                         | Enable in dashboard; adds a JS beacon to pages                                                                                                                |
| What you get        | Requests, errors, CPU time per day, by route if you filter                          | Page views, visits, referrers, countries, Core Web Vitals                                                                                                     |
| Privacy             | Nothing new collected; no policy change                                             | Cookieless, but loads `static.cloudflareinsights.com` (breaks "no third-party requests" and the CSP); privacy policy must be updated first (it promises this) |
| CV-friendly numbers | "N timetable refreshes a week", "M calendar feed fetches a day" (≈ subscribers × 4) | "N weekly visitors"                                                                                                                                           |
| Limits              | No unique users (no ids, by design)                                                 | Sampled; blocked by ad blockers                                                                                                                               |

Suggestion: start with the built-in Worker metrics. They're free, need no code, and don't touch
the privacy promises. If you later want a true "active students" number, a Workers Analytics
Engine counter per day of `/api/timetable` calls is the next step, but that's server-side
storage, so it needs a privacy policy update.

### Ideas for later (not done)

- **Share only free/busy times** (Phase 3, skipped as instructed): add `b: true` to the token
  settings; `/api/friend` would then return only start/end times (no titles or rooms).
  "Classes in common" can't work for those friends; the free-time view still can.
- Option B (revocable KV tokens) on top of A for people who want "stop sharing".
- Phase 6 items in `CLAUDE.md`.

## Blocked, not done, or worth a look

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
- **Lighthouse and accessibility were reviewed by reading code**, not by running Lighthouse or a
  screen reader (no browser overnight). Run Lighthouse in Chrome DevTools to confirm.
- **Accessibility items not changed** (judgement calls): past classes are drawn at 50% opacity
  (below 4.5:1 contrast); input borders are light (`--line`, about 1.3:1 against white, though
  focus now shows a ring); the year picker is `role="radiogroup"` but has no arrow-key support.
- Nothing was reverted; no task failed its tests.

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

### Encrypted sharing links (`src/share.js`, Phase 3)

Shared links used to contain the timetable link in base64, which anyone can decode. Now the
Worker encrypts the student's settings with AES-256-GCM, using a key derived from the
`SHARE_KEY` secret. Only the server can open a token, and changing even one bit makes
decryption fail. Friends get classes back from `/api/friend`, never the link itself.

**Q: Why AES-GCM rather than AES-CBC, and why a random IV each time?**
A: GCM is authenticated encryption: besides hiding the data it adds a tag, so a modified token
is rejected rather than decrypted into garbage. CBC alone doesn't detect tampering. The IV must
never repeat with the same key in GCM, so each token gets 12 fresh random bytes. That's also
why sharing twice gives two different-looking links.

**Q: Why derive keys with HKDF instead of using `SHARE_KEY` directly?**
A: The secret is a string of any length, while AES needs exactly 256 bits. HKDF turns it into
proper keys, and it gives separate keys for separate jobs (one for encryption, one for the HMAC
friend ids) so one key is never used for two purposes.

### Token tests (Phase 3)

The tests encrypt and decrypt, flip single bits in each part of a token (version, IV,
ciphertext, tag) and check every change is rejected. They also try a token from another key,
old base64 tokens before and after the cut-off date, and check the friend API's response
never contains the link.

**Q: How do you test that tampering is detected?**
A: Decode the token, XOR one bit in a chosen byte, re-encode, and assert `openToken` returns
null. Doing it in each region of the token proves the version check, IV, ciphertext and tag
are all covered.

### Privacy policy update (Phase 3)

The policy now says links are encrypted, what a friend's device receives (name and classes,
not the link), that single links can't be revoked, and when old unencrypted links stop
working. The README's privacy section matches.

**Q: Why mention that single links can't be revoked?**
A: Under GDPR's transparency principle, people should understand what happens to their data,
including its limits. "We can't recall a link" sets the right expectation and explains what to
do instead (ask the college for a new calendar link).

### Lighthouse-style fixes (Phase 4)

`<link rel="modulepreload">` lets the browser fetch the `public/lib` modules in parallel with
`app.js` instead of discovering them one after another. The service worker now saves only
successful responses, never stores personal calendar feeds, and serves the saved page offline
even for URLs like `/?friend=…`. The manifest gained `id` and `scope`.

**Q: What's the risk of caching every response in a service worker?**
A: You can save an error page (a 404 or 500) and keep serving it offline. Or you can store
data that shouldn't sit in the browser cache, like a personal calendar feed. Checking
`res.ok` and skipping `/api/` and `/feed/` avoids both.

### Accessibility pass (Phase 4)

Dialogs ("sheets") now move focus inside when opened, keep Tab inside, and return focus to the
button that opened them. Tab strips support arrow keys and report `aria-selected`.
Module-coloured text now meets 4.5:1 contrast for every hue, and a few elements got proper
labels.

**Q: Why return focus to the opening button when a dialog closes?**
A: Keyboard and screen-reader users would otherwise be dropped at the top of the page and lose
their place. Restoring focus puts them back where they were (WCAG 2.4.3, focus order).

### Service worker version (Phase 4)

The service worker's cache name is now `studyslot-<version>`, and a test checks it matches
`package.json` and `APP_VERSION`. Releasing means bumping the version, which changes `sw.js`.
Browsers notice the changed file, install the new worker and delete the old cache.

**Q: How does a browser know there's a new service worker?**
A: It re-downloads `sw.js` on navigation (at most every 24 hours, or sooner) and compares it
byte for byte. Any change, such as a new `VERSION` string, triggers install and activate. Here
that refills the cache and deletes old ones.

### README and CHANGELOG (Phase 5)

The README now leads with the pitch, then features, a Mermaid architecture diagram, design
decisions, privacy, testing, and run/deploy. The intro and design decisions are bullet points
for you to rewrite in your own words. `CHANGELOG.md` follows Keep a Changelog, with 1.0.0 in
"Unreleased" until launch.

**Q: Why keep a changelog when there's git history?**
A: Git history is for developers and lists every small step. A changelog is for users and
reviewers: what changed in each release, grouped as Added, Changed and Deprecated (e.g. the old
links), without reading commits.
