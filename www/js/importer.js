/* ---------------------------------------------------------------------
 * Excel importer.
 *
 * The workbook is NOT read by fixed row/column numbers. Every sheet is
 * scanned for recognizable structure:
 *   - A "timetable" sheet: header row containing Day / Period / Time /
 *     Code / Subject (any order, case-insensitive).
 *   - A "subject attendance" sheet: a header row with "S.No" + "Name" in
 *     the first two columns, immediately followed by a row whose cells
 *     (from column 3 onward) are period markers like "P1", "P2"... and
 *     whose column headers (the row above) are real Excel dates. Blank
 *     date cells mean "same date as the previous non-blank cell to the
 *     left" (a second period taught on the same day).
 *
 * Anything that does not match these patterns is left alone and listed
 * under `unrecognized` so the CR can see it rather than have it silently
 * mis-imported.
 * ------------------------------------------------------------------- */
const Importer = (() => {

  function norm(s) {
    return (s === null || s === undefined) ? '' : String(s).trim();
  }
  function normUp(s) {
    return norm(s).toUpperCase();
  }
  function normCode(s) {
    return normUp(s).replace(/[^A-Z0-9]/g, '');
  }
  function normName(s) {
    return norm(s).replace(/\s+/g, ' ');
  }
  function nameKey(s) {
    return normName(s).toUpperCase();
  }

  function cell(ws, r, c) {
    const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
    const cellObj = ws[addr];
    return cellObj ? cellObj.v : undefined;
  }

  function sheetRange(ws) {
    const ref = ws['!ref'];
    if (!ref) return { r1: 1, r2: 0, c1: 1, c2: 0 };
    const rng = XLSX.utils.decode_range(ref);
    return { r1: rng.s.r + 1, r2: rng.e.r + 1, c1: rng.s.c + 1, c2: rng.e.c + 1 };
  }

  function isDate(v) {
    return v instanceof Date && !isNaN(v.getTime());
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const PERIOD_RE = /^P\s*0*(\d{1,2})$/i;

  // ---- Timetable detection --------------------------------------------
  function findTimetableSheet(wb) {
    const preferredOrder = wb.SheetNames.slice().sort((a, b) => {
      const score = (n) => (/new/i.test(n) ? 0 : /timetable|time\s*table/i.test(n) ? 1 : 2);
      return score(a) - score(b);
    });
    for (const name of preferredOrder) {
      const ws = wb.Sheets[name];
      const { r1, r2, c1, c2 } = sheetRange(ws);
      for (let r = r1; r <= Math.min(r2, r1 + 5); r++) {
        const headers = [];
        for (let c = c1; c <= c2; c++) headers.push(normUp(cell(ws, r, c)));
        const has = (label) => headers.some((h) => h === label || h.startsWith(label));
        if (has('DAY') && has('PERIOD') && (has('CODE') || has('SUBJECT'))) {
          return parseTimetableSheet(ws, r, headers, c1, c2);
        }
      }
    }
    return { entries: [], sheetName: null };
  }

  function parseTimetableSheet(ws, headerRow, headers, c1, c2) {
    const col = {};
    headers.forEach((h, i) => {
      const c = c1 + i;
      if (h === 'DAY') col.day = c;
      else if (h === 'PERIOD') col.period = c;
      else if (h.startsWith('TIME')) col.time = c;
      else if (h === 'CODE') col.code = c;
      else if (h.startsWith('SUBJECT')) col.subject = c;
    });
    const { r2 } = sheetRange(ws);
    const entries = [];
    for (let r = headerRow + 1; r <= r2; r++) {
      const day = norm(cell(ws, r, col.day || 0));
      const period = cell(ws, r, col.period || 0);
      if (!day || !period) continue;
      entries.push({
        day,
        period: parseInt(period, 10),
        time: norm(cell(ws, r, col.time || 0)),
        code: normCode(cell(ws, r, col.code || 0)),
        subject: norm(cell(ws, r, col.subject || 0)) || norm(cell(ws, r, col.code || 0)),
      });
    }
    return { entries };
  }

  // ---- Subject sheet detection -----------------------------------------
  function detectSubjectSheet(ws) {
    const { r1, r2, c1, c2 } = sheetRange(ws);
    for (let r = r1; r <= Math.min(r2 - 1, r1 + 6); r++) {
      const a = normUp(cell(ws, r, c1));
      const b = normUp(cell(ws, r, c1 + 1));
      const looksHeader = (a === 'S.NO' || a === 'SNO' || a === 'S.NO.' || a === 'SL.NO') && (b === 'NAME');
      if (!looksHeader) continue;
      const periodRow = r + 1;
      let periodHits = 0;
      for (let c = c1 + 2; c <= c2; c++) {
        if (PERIOD_RE.test(normUp(cell(ws, periodRow, c)))) periodHits++;
      }
      if (periodHits >= 1) {
        return { headerRow: r, periodRow, studentStartRow: r + 2 };
      }
    }
    return null;
  }

  function parseSubjectSheet(sheetName, ws, meta) {
    const { r2, c1, c2 } = sheetRange(ws);
    const { headerRow, periodRow, studentStartRow } = meta;

    // Build column definitions with forward-filled dates.
    const columns = [];
    let lastDate = null;
    let blankStreak = 0;
    for (let c = c1 + 2; c <= c2; c++) {
      const dateVal = cell(ws, headerRow, c);
      const periodVal = normUp(cell(ws, periodRow, c));
      if (isDate(dateVal)) { lastDate = dateVal; }
      const m = periodVal.match(PERIOD_RE);
      if (!lastDate || !m) {
        blankStreak++;
        if (blankStreak > 6) break; // safety: stop after a long run of empty columns
        continue;
      }
      blankStreak = 0;
      columns.push({ col: c, date: lastDate, period: parseInt(m[1], 10) });
    }

    // Students
    const students = [];
    let emptyStreak = 0;
    for (let r = studentStartRow; r <= r2; r++) {
      const name = norm(cell(ws, r, c1 + 1));
      const rollNo = cell(ws, r, c1);
      if (!name) {
        emptyStreak++;
        if (emptyStreak > 5) break;
        continue;
      }
      emptyStreak = 0;
      students.push({ row: r, name: normName(name), rollNo: rollNo !== undefined ? String(rollNo) : '' });
    }

    const records = [];
    const datesSeen = new Set();
    for (const stu of students) {
      for (const colDef of columns) {
        const raw = normUp(cell(ws, stu.row, colDef.col));
        let status = null;
        if (raw === 'P') status = 'P';
        else if (raw === 'A') status = 'A';
        else continue; // blank / holiday / SATURDAY / SUNDAY / OD / non-working -> not counted
        const iso = isoDate(colDef.date);
        datesSeen.add(iso);
        records.push({
          nameKey: nameKey(stu.name),
          displayName: stu.name,
          rollNo: stu.rollNo,
          date: iso,
          period: colDef.period,
          subjectCode: sheetName.trim(),
          status,
        });
      }
    }

    return { records, students, dates: datesSeen };
  }

  const RESERVED_SHEET_RE = /^(timetable|timetable_new|sheet2|attendance\s*%|master attendance|sheet11)$/i;

  function analyze(wb) {
    const timetable = findTimetableSheet(wb);
    const subjectSheets = [];
    const unrecognized = [];

    for (const name of wb.SheetNames) {
      if (RESERVED_SHEET_RE.test(name.trim())) continue;
      if (timetable.sheetName === name) continue;
      const ws = wb.Sheets[name];
      const meta = detectSubjectSheet(ws);
      if (!meta) { unrecognized.push(name); continue; }
      const parsed = parseSubjectSheet(name, ws, meta);
      if (parsed.records.length === 0) { unrecognized.push(name); continue; }
      subjectSheets.push({ sheetName: name, code: name.trim(), ...parsed });
    }

    return { timetable, subjectSheets, unrecognized };
  }

  // ---- Merge plan against existing DB -----------------------------------
  async function buildImportPlan(analysis) {
    const existingAttendance = await DB.getAll('attendance');
    const existingByKey = new Map(existingAttendance.map((a) => [a.key, a]));

    const allNameKeys = new Set();
    const studentMeta = new Map(); // nameKey -> {displayName, rollNo}
    let totalRecords = 0;
    const uniqueDates = new Set();
    const uniqueSubjects = new Set();

    const plan = { toInsert: [], toAutoUpdate: [], conflicts: [], duplicates: 0 };

    for (const sheet of analysis.subjectSheets) {
      uniqueSubjects.add(sheet.code);
      for (const d of sheet.dates) uniqueDates.add(d);
      for (const rec of sheet.records) {
        totalRecords++;
        allNameKeys.add(rec.nameKey);
        if (!studentMeta.has(rec.nameKey) || sheet.students.some((s) => nameKey(s.name) === rec.nameKey)) {
          studentMeta.set(rec.nameKey, { displayName: rec.displayName, rollNo: rec.rollNo });
        }
        const key = `${rec.nameKey}|${rec.date}|${rec.period}`;
        const existing = existingByKey.get(key);
        if (!existing) {
          plan.toInsert.push({ key, ...rec });
        } else if (existing.status === rec.status) {
          plan.duplicates++;
        } else if (existing.source === 'manual' && existing.locked) {
          plan.conflicts.push({ key, existing, incoming: rec });
        } else if (existing.source === 'manual') {
          plan.conflicts.push({ key, existing, incoming: rec });
        } else {
          plan.toAutoUpdate.push({ key, ...rec });
        }
      }
    }

    return {
      plan,
      studentsDetected: allNameKeys.size,
      studentMeta,
      subjectsDetected: uniqueSubjects.size,
      subjectCodes: [...uniqueSubjects],
      datesDetected: uniqueDates.size,
      recordsDetected: totalRecords,
      existingMatched: totalRecords - plan.toInsert.length,
      newRecords: plan.toInsert.length,
      updatedRecords: plan.toAutoUpdate.length,
      duplicatesPrevented: plan.duplicates,
      potentialConflicts: plan.conflicts.length,
      unrecognized: analysis.unrecognized,
      timetableFound: analysis.timetable.entries.length > 0,
    };
  }

  async function commitImport(analysis, importPlanResult, conflictResolutions = {}) {
    const { plan, studentMeta, subjectCodes } = importPlanResult;
    const now = new Date().toISOString();

    // Students: upsert registry, preserving existing regNo/id if present.
    const existingStudents = await DB.getAll('students');
    const byName = new Map(existingStudents.map((s) => [s.nameKey, s]));
    const studentRecords = [];
    for (const [key, meta] of studentMeta.entries()) {
      const existing = byName.get(key);
      if (existing) {
        studentRecords.push({ ...existing, rollNo: existing.rollNo || meta.rollNo });
      } else {
        studentRecords.push({
          id: 'stu_' + key.replace(/[^A-Z0-9]/g, '_').toLowerCase(),
          nameKey: key,
          name: meta.displayName,
          regNo: '',
          rollNo: meta.rollNo || '',
          active: true,
        });
      }
    }
    await DB.putMany('students', studentRecords);
    const idByNameKey = new Map(studentRecords.map((s) => [s.nameKey, s.id]));

    // Subjects registry
    const existingSubjects = await DB.getAll('subjects');
    const subjByCode = new Map(existingSubjects.map((s) => [s.code, s]));
    const timetableByCode = new Map();
    for (const e of analysis.timetable.entries) {
      timetableByCode.set(normCode(e.code), e.subject);
    }
    const subjRecords = subjectCodes.map((code) => {
      const existing = subjByCode.get(code);
      const fullName = (existing && existing.name) || timetableByCode.get(normCode(code)) || code;
      return { code, name: fullName };
    });
    await DB.putMany('subjects', subjRecords);

    // Timetable
    if (analysis.timetable.entries.length) {
      await DB.clearStore('timetable');
      await DB.putMany('timetable', analysis.timetable.entries.map((e) => ({ ...e })));
    }

    // Attendance: inserts + auto-updates + resolved conflicts
    const toWrite = [];
    const finalize = (rec) => ({
      key: rec.key,
      studentId: idByNameKey.get(rec.nameKey),
      date: rec.date,
      period: rec.period,
      subjectCode: rec.subjectCode,
      status: rec.status,
      source: 'import',
      locked: false,
      note: '',
      importedAt: now,
    });
    plan.toInsert.forEach((r) => toWrite.push(finalize(r)));
    plan.toAutoUpdate.forEach((r) => toWrite.push(finalize(r)));

    let resolvedCount = 0;
    for (const c of plan.conflicts) {
      const resolution = conflictResolutions[c.key]; // 'keep' | 'use-new'
      if (resolution === 'use-new') {
        toWrite.push(finalize({ ...c.incoming, key: c.key }));
        resolvedCount++;
      }
      // 'keep' or undefined -> leave existing record untouched
    }

    await DB.putMany('attendance', toWrite);
    await DB.setMeta('lastImport', {
      at: now,
      inserted: plan.toInsert.length,
      updated: plan.toAutoUpdate.length,
      conflictsResolved: resolvedCount,
      conflictsRemaining: plan.conflicts.length - resolvedCount,
    });

    return { written: toWrite.length, conflictsRemaining: plan.conflicts.length - resolvedCount };
  }

  async function readWorkbookFromFile(file) {
    const buf = await file.arrayBuffer();
    return XLSX.read(buf, { type: 'array', cellDates: true });
  }

  return { analyze, buildImportPlan, commitImport, readWorkbookFromFile, nameKey, normCode };
})();
