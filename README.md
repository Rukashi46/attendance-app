# CR Attendance — Class Representative Attendance Management App

An offline-first attendance app for a Class Representative, packaged as an
Android app with Capacitor. It imports your existing Excel workbook, keeps
attendance per student/date/period, and lets you mark, edit, review and
export attendance from your phone.

## What's implemented

- **Excel import**, built directly against your `Attendance_Engg_Design_updated.xlsx`
  structure, but detected by header pattern (not fixed row/column numbers):
  - Reads `TIMETABLE_NEW` / `TIMETABLE` (whichever exists, preferring the
    "_NEW" one) by locating the header row with Day/Period/Time/Code/Subject.
  - Reads every subject sheet (`AMMV`, `AMED`, `VAC`, `GD&T`, `DM`, `QCD`,
    `VL`, `RM&IPR` in your file — any similarly-shaped sheet in a future
    file) by locating the "S.No"/"Name" header, the period-code row below
    it (`P1`, `P2`...), and forward-filling blank date cells (two periods
    taught on the same day share one date cell in your workbook).
  - Skips `ATTENDANCE %`, `MASTER ATTENDANCE`, `Sheet2`, `Sheet11` and
    anything else that doesn't match the pattern, and lists them as
    "not recognized" in the import preview rather than guessing.
  - Blank cells, `SATURDAY`, `SUNDAY`, and any value that isn't exactly
    `P` or `A` are never counted as absent.
- **Re-sync / duplicate prevention**: importing the same or an updated
  workbook is keyed by student + date + period. Existing identical records
  are left alone; changed records from a fresh import auto-update *unless*
  you already hand-corrected that exact record, in which case it's flagged
  as a conflict and left untouched until you resolve it.
- **IndexedDB storage** — students, subjects, timetable, attendance, all
  local to the device, no network calls anywhere in the app.
- **Screens**: Dashboard (today's classes, class %, low-attendance count),
  Students (search/sort/detail/edit), Mark Attendance (today's timetable or
  manual subject+period pick, mark-all-present/absent, per-student toggle,
  optional lock), Subjects (class average, above/below 75%), Low Attendance
  (threshold chips), Calendar (day drill-down by period), Reports (class +
  subject averages, monthly totals, CSV/Excel export), Settings (theme,
  class setup, default threshold), Backup & restore (JSON export/import).
- **Dark glassmorphism theme** by default, with a light theme and a
  system-following option.

## Video audit fixes (2026-09-21)

A screen recording surfaced several bugs on top of the base app above. Each
was reproduced against the actual code and workbook (not just inferred from
the video) before being fixed — see the conversation for the verification
commands. Summary:

- **Favicon 404** — `index.html` had no `<link rel="icon">` at all, causing
  a repeated 404 on every navigation. Fixed with an inline SVG data-URI
  favicon (no extra file needed).
- **Removed the student-level "Quota: Set Total" button entirely.** It lived
  on the Overall attendance card and actually set a hidden `_default`
  fallback quota applied across subjects — exactly the class-wide/default
  quota the spec forbids. Quota is now purely a per-subject setting
  (`allocatedPeriods[code]`, no default/fallback key at all).
- **Fixed the contradictory "Can Miss" numbers.** `calc.js` was computing
  two independent formulas — a quota-free `margin()` and a quota-aware
  `semesterMargin()` — and the UI (and the exported PNGs) showed both at
  once, e.g. a `+1 can miss` badge next to a `Can miss 5 of 18 remaining`
  line for the same subject. Now exactly one figure is ever shown per
  subject: the quota-aware one when a semester quota is configured, or
  "Semester quota not set" when it isn't — never a fabricated number.
  (The quota-free `margin()` is still used, correctly, for the *overall*
  attendance card only, where the spec explicitly allows an optional
  target-based Can Miss with no quota involved.)
- **Consistent terminology**: "Quota: 60 Total Planned" / "⚙️ Quota: 60
  Classes" / "🎯 Semester Quota: 60 (18 remaining)" are now uniformly
  "Semester Planned Periods: 60 · Remaining: 18" everywhere (subject page,
  student report breakdown, exported PNGs).
- **Configurable attendance target used everywhere**, replacing hardcoded
  75%/65%: student/subject list color tiers, subject filter chip labels
  ("Below 75%" → "Below {target}%"), the reports table header, and the PNG
  export color thresholds all now read the configured target.
- **Replaced every native `alert()`/`confirm()`/`prompt()`** (15 call sites
  across `app.js` and `image-export.js`) with in-app UI: a numeric-entry
  modal for setting a subject's semester planned periods, confirm modals
  for destructive actions (removing a student, restoring a backup, editing
  a locked period), and toast notifications for success/error feedback.
- **Fixed a dead click-outside-to-close handler** on the image preview
  modal (`close-modal-backdrop` was declared in the markup but never
  actually handled).
- **Fixed Share vs. Download honesty**: `Share` no longer silently falls
  back to "downloaded instead" when the user simply dismissed the native
  share sheet (that's now treated as a cancel, not a failure), and both
  `Download PNG` and `Share` now show an explicit success/error toast
  instead of firing and giving no feedback.
- **Fixed a latent bug in cloud sync's "last synced" timestamp** — it was
  stored as a bare locale time string but the Settings screen tried to
  parse it as a full ISO date, which would have shown "Invalid Date" the
  first time anyone used Sync. Also fixed Settings not refreshing that
  timestamp immediately after a manual sync.
- **Verified (not assumed) the Excel import is correct**: re-ran the actual
  `importer.js`/`calc.js` against the real workbook in a standalone test
  harness — confirms 11 students / 8 subjects / 52 dates / 3,113 records on
  first import, 0 new/updated and 3,113 "duplicates prevented" on a second
  import of the same file, and that a manually-corrected record survives a
  re-import as a flagged conflict rather than being silently overwritten.

### Not addressed (flagged, out of scope for this pass)
- **Cloud Sync's "Sync successful!" message can be misleading** without a
  custom server URL configured: sync then only bridges data through
  `localStorage`, which is per-browser/per-device, not a real cross-device
  sync. It works correctly for what it claims to do, but a CR relying on
  it to sync between their phone and someone else's without setting a
  custom endpoint URL would not get real cross-device sync. Worth a clearer
  status message or a documented requirement to set an endpoint URL.
- The stale prebuilt `CR-Attendance.apk` and `android/` folder from before
  this fix pass are **not included** in this delivery — rebuild with
  `npx cap add android && npx cap sync android` (see Setup below).
- Per-record conflict resolution UI (see "Known simplifications" below)
  is still not built — conflicts are safely preserved but require
  re-entering via Mark Attendance to resolve.



- The Excel import preview shows conflict counts, but per-record conflict
  resolution (choose keep-existing vs. use-new for each row) isn't built as
  a UI yet — conflicting records are safely left as-is and reported as
  "unresolved" until you re-enter them manually via Mark Attendance.
- CSV/Excel/backup export uses a plain browser download link. It works in
  the Android System WebView, but for a more reliable native "save/share"
  sheet, wire in `@capacitor/filesystem` + `@capacitor/share` (already
  listed as dependencies) inside `exportAttendance()` / `exportBackup()`
  in `www/js/app.js`.
- Period locking is a soft confirmation (`confirm()` dialog before editing
  a locked period), not a hard permission barrier.
- Teacher/CR notes-per-period and PDF report export are not yet wired up
  (the data model has a `note` field ready for it).

## Setup

You'll need Node.js, Android Studio, and a JDK installed on your own
machine (this project can't be built or run inside this chat).

```bash
cd attendance-app
npm install          # also vendors the xlsx library into www/lib for offline use
npx cap add android
npx cap sync android
npx cap open android   # opens Android Studio — press Run
```

Re-run `npx cap sync android` any time you change files under `www/`.

## Importing your workbook

1. Open the app → **More → Import / Re-sync Excel**.
2. Pick your `.xlsx` file (works fully offline — nothing is uploaded).
3. Review the preview (students/subjects/dates detected, new vs. existing
   vs. conflicting records), then tap **Import**.
4. To bring in a newer version of the workbook later, repeat the same
   steps — it adds new dates and updates changed cells without duplicating
   anything already stored.

## Project layout

```
attendance-app/
  capacitor.config.json
  package.json
  scripts/copy-xlsx.js      # vendors SheetJS into www/lib after npm install
  www/
    index.html
    css/style.css
    js/db.js                # IndexedDB layer
    js/importer.js          # Excel structure detection + import/merge logic
    js/calc.js               # attendance percentage calculations
    js/image-export.js       # canvas-based PNG report/subject/notice generator + share/download
    js/sync.js                # optional cloud/localStorage sync engine
    js/render.js              # HTML templates for every screen
    js/app.js                 # router, state, event handling, actions
```
