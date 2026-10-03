# Test fixtures

`scientia-sample.ics` is a **synthetic** timetable. It copies the structure of a TU Dublin
Scientia calendar export, but every name, UID and link in it is made up. It contains:

- Weekly classes (`RRULE`) running from 21 September to 11 December 2026, across the
  25 October daylight-saving change
- A reading week (26–30 October): skipped with `EXDATE` on each class, plus an all-day
  "Reading Week" entry that should not appear as a class
- Mobile Software Development Lab for groups A and B at the same time (Tuesday 10:00–12:00).
  Group A's lab is listed as two back-to-back one-hour slots, as some timetables do
- A Databases tutorial moved from Wednesday 7 October 14:00 to Thursday 8 October 16:00 in
  another room (`RECURRENCE-ID` override)
- The same tutorial cancelled on 18 November (`RECURRENCE-ID` with `STATUS:CANCELLED`)
- Scientia-style titles (`CMPU 3036(22519C)/Mobile Software Development/Lab/Sem1/A`),
  rooms with capacities (`CQ-227 Specialist Computer Lab 3 (25)`), a folded description line,
  escaped commas and a nested `VALARM`

Not checked against a real export yet. Compare it with a real Scientia `.ics` file and
adjust if the real one differs.
