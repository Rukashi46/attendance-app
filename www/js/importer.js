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
    const [existingAttendance, existingStudents, existingSubjects, existingTimetable] = await Promise.all([
      DB.getAll('attendance'),
      DB.getAll('students'),
      DB.getAll('subjects'),
      DB.getAll('timetable'),
    ]);

    const timetableEntries = (analysis.timetable && analysis.timetable.entries.length > 0)
      ? analysis.timetable.entries
      : existingTimetable;

    // Resolve each sheet name to canonical subject code
    const canonicalSubjBySheet = new Map();
    const uniqueCanonicalSubjects = new Set();
    for (const sheet of analysis.subjectSheets) {
      const canonicalCode = Norm.resolveSubjectCode(sheet.code, existingSubjects, timetableEntries);
      canonicalSubjBySheet.set(sheet.code, canonicalCode);
      uniqueCanonicalSubjects.add(canonicalCode);
    }

    // Match or create canonical student records
    const studentRegistry = [...existingStudents];
    const studentInfoByRef = new Map();

    for (const sheet of analysis.subjectSheets) {
      for (const stu of sheet.students) {
        const existing = Norm.resolveStudent(stu, studentRegistry);
        if (existing) {
          studentInfoByRef.set(Norm.nameKey(stu.name), existing);
          if (stu.rollNo && !existing.rollNo) existing.rollNo = String(stu.rollNo);
        } else {
          // Check if already created during this import pass
          let batchCreated = studentRegistry.find(s => Norm.isSameStudent(s, stu, studentRegistry));
          if (!batchCreated) {
            const rollClean = Norm.rollNo(stu.rollNo);
            const stableId = 'stu_' + (rollClean ? rollClean : Norm.studentName(stu.name).replace(/[^A-Z0-9]/g, '_').toLowerCase());
            batchCreated = {
              id: stableId,
              nameKey: Norm.nameKey(stu.name),
              name: stu.name,
              regNo: '',
              rollNo: stu.rollNo !== undefined ? String(stu.rollNo) : '',
              active: true,
            };
            studentRegistry.push(batchCreated);
          }
          studentInfoByRef.set(Norm.nameKey(stu.name), batchCreated);
        }
      }
    }

    // Index existing attendance records by canonical key AND legacy keys
    const existingMap = new Map();
    for (const a of existingAttendance) {
      if (!a) continue;
      const matchedSt = Norm.resolveStudent(a.studentId, studentRegistry);
      const sId = matchedSt ? matchedSt.id : Norm.studentId(a.studentId);
      const d = Norm.date(a.date);
      const p = Norm.period(a.period);
      const sub = Norm.resolveSubjectCode(a.subjectCode, existingSubjects, timetableEntries);
      const cKey = Norm.makeKey(sId, d, p, sub);

      if (a.key) existingMap.set(a.key, a);
      existingMap.set(cKey, a);
    }

    let totalRecords = 0;
    const uniqueDates = new Set();
    const plan = { toInsert: [], toAutoUpdate: [], conflicts: [], duplicates: 0 };

    for (const sheet of analysis.subjectSheets) {
      for (const rec of sheet.records) {
        totalRecords++;
        const stObj = studentInfoByRef.get(rec.nameKey) || Norm.resolveStudent(rec, studentRegistry);
        const canonStudentId = stObj ? stObj.id : Norm.studentId(rec.displayName);
        const canonDate = Norm.date(rec.date);
        const canonPeriod = Norm.period(rec.period);
        uniqueDates.add(canonDate);

        // Resolve canonical subject code for this specific record
        const rawSubj = rec.subjectCode || sheet.code;
        const canonicalSubj = Norm.resolveSubjectCode(rawSubj, existingSubjects, timetableEntries);
        uniqueCanonicalSubjects.add(canonicalSubj);

        const canonKey = Norm.makeKey(canonStudentId, canonDate, canonPeriod, canonicalSubj);
        const existing = existingMap.get(canonKey);

        const incomingItem = {
          key: canonKey,
          studentId: canonStudentId,
          date: canonDate,
          period: canonPeriod,
          subjectCode: canonicalSubj,
          status: rec.status,
          displayName: rec.displayName,
          rollNo: rec.rollNo,
        };

        if (!existing) {
          plan.toInsert.push(incomingItem);
          existingMap.set(canonKey, incomingItem); // prevent duplicate in same batch
        } else if (existing.status === rec.status) {
          plan.duplicates++;
        } else if (existing.source === 'manual' && existing.locked) {
          plan.conflicts.push({ key: canonKey, existing, incoming: incomingItem });
        } else if (existing.source === 'manual') {
          plan.conflicts.push({ key: canonKey, existing, incoming: incomingItem });
        } else {
          plan.toAutoUpdate.push({ ...incomingItem, existingKey: existing.key });
          existingMap.set(canonKey, incomingItem);
        }
      }
    }

    return {
      plan,
      studentsDetected: studentRegistry.length,
      studentRegistry,
      subjectsDetected: uniqueCanonicalSubjects.size,
      subjectCodes: [...uniqueCanonicalSubjects],
      datesDetected: uniqueDates.size,
      recordsDetected: totalRecords,
      existingMatched: totalRecords - plan.toInsert.length,
      newRecords: plan.toInsert.length,
      updatedRecords: plan.toAutoUpdate.length,
      duplicatesPrevented: plan.duplicates,
      potentialConflicts: plan.conflicts.length,
      unrecognized: analysis.unrecognized,
      timetableFound: (analysis.timetable && analysis.timetable.entries.length > 0),
    };
  }

  async function commitImport(analysis, importPlanResult, conflictResolutions = {}) {
    const { plan, studentRegistry, subjectCodes } = importPlanResult;
    const now = new Date().toISOString();

    // 1. Students: upsert student registry
    if (studentRegistry && studentRegistry.length > 0) {
      await DB.putMany('students', studentRegistry);
    }

    // 2. Subjects registry
    const existingSubjects = await DB.getAll('subjects');
    const subjByCode = new Map(existingSubjects.map((s) => [s.code, s]));
    const timetableByCode = new Map();
    if (analysis.timetable && analysis.timetable.entries) {
      for (const e of analysis.timetable.entries) {
        timetableByCode.set(Norm.subjectCode(e.code), e.subject);
      }
    }
    const subjRecords = subjectCodes.map((code) => {
      const existing = subjByCode.get(code);
      const fullName = (existing && existing.name) || timetableByCode.get(Norm.subjectCode(code)) || code;
      return { code, name: fullName };
    });
    await DB.putMany('subjects', subjRecords);

    // 3. Timetable
    if (analysis.timetable && analysis.timetable.entries.length) {
      await DB.clearStore('timetable');
      await DB.putMany('timetable', analysis.timetable.entries.map((e) => ({ ...e })));
    }

    // 4. Attendance: canonical writes
    const toWrite = [];
    const finalize = (rec) => ({
      key: rec.key,
      studentId: rec.studentId,
      date: rec.date,
      period: rec.period,
      subjectCode: rec.subjectCode,
      status: rec.status,
      source: 'import',
      locked: false,
      note: '',
      importedAt: now,
      updatedAt: now,
    });

    plan.toInsert.forEach((r) => toWrite.push(finalize(r)));
    for (const r of plan.toAutoUpdate) {
      toWrite.push(finalize(r));
      if (r.existingKey && r.existingKey !== r.key) {
        await DB.del('attendance', r.existingKey);
      }
    }

    let resolvedCount = 0;
    for (const c of plan.conflicts) {
      const resolution = conflictResolutions[c.key]; // 'keep' | 'use-new'
      if (resolution === 'use-new') {
        toWrite.push(finalize(c.incoming));
        if (c.existing && c.existing.key && c.existing.key !== c.key) {
          await DB.del('attendance', c.existing.key);
        }
        resolvedCount++;
      }
    }

    if (toWrite.length > 0) {
      await DB.putMany('attendance', toWrite);
    }

    // 5. Automatic cleanup & deduplication pass
    const cleanupResult = await Norm.cleanupAndMigrate(DB);

    await DB.setMeta('lastImport', {
      at: now,
      inserted: plan.toInsert.length,
      updated: plan.toAutoUpdate.length,
      duplicates: plan.duplicates,
      conflictsResolved: resolvedCount,
      conflictsRemaining: plan.conflicts.length - resolvedCount,
    });

    return {
      studentsDetected: importPlanResult.studentsDetected,
      subjectsDetected: importPlanResult.subjectsDetected,
      datesDetected: importPlanResult.datesDetected,
      recordsDetected: importPlanResult.recordsDetected,
      newRecords: plan.toInsert.length,
      updatedRecords: plan.toAutoUpdate.length,
      duplicatesPrevented: plan.duplicates,
      conflictsResolved: resolvedCount,
      conflictsRemaining: plan.conflicts.length - resolvedCount,
      written: toWrite.length,
      cleanedDuplicates: cleanupResult.duplicatesRemoved || 0,
    };
  }

  async function readWorkbookFromFile(file) {
    const buf = await file.arrayBuffer();
    return XLSX.read(buf, { type: 'array', cellDates: true });
  }

  return { analyze, buildImportPlan, commitImport, readWorkbookFromFile, nameKey, normCode };
})();
