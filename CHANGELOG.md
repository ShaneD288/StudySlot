# Changelog

All notable changes to Studyslot. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned as 1.0.0, the first public release. Tag `v1.0.0` on launch.

### Added

- Today and week views, week numbers, lab group choice and hidden modules
- Cleaned calendar feed for Apple and Google Calendar, with a 10-minute alert before each class
- Friends: share by link or QR code, free time together and classes in common
- Reset my link: stop every friend link you've shared, without affecting your calendar subscription
- After adding a friend, a prompt to share your link back
- Opening a friend's link before you have Studyslot: setup asks for your timetable by their name, then opens on Friends
- One-screen setup: paste your timetable link and go
- Sheets you can drag and flick away, a sliding view switcher and a translucent header
- Offline support (service worker) and Home Screen install
- Privacy Policy and Terms of Use
- Beta label, an in-app feedback form (read with `npm run feedback`) and a step-by-step Add to Home Screen guide for iPhone and Android
- Encrypted (AES-256-GCM) calendar-feed and friend links; friends see classes but never the timetable link
- Tests (Vitest) for parsing, time zones, timetable cleanup, the Worker, app logic and an app smoke test
- GitHub Actions: lint, format check and tests on every push; deploy to Cloudflare after CI passes on `main`
- MIT licence

### Changed

- Pure app logic moved into `public/lib/` modules
- Accessibility: keyboard navigation for tabs and sheets, focus handling, colour contrast for every module colour
- Service worker saves only successful responses, never calendar feeds, and works offline for links with a query

### Deprecated

- Unencrypted (base64) calendar-feed and friend links. They keep working until 1 February 2027, with a message asking students to share again.
