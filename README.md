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

## Known simplifications (given the scope of the original spec)

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
    js/render.js              # HTML templates for every screen
    js/app.js                 # router, state, event handling, actions
```
