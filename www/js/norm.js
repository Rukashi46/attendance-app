/* ---------------------------------------------------------------------
 * Attendance Data Normalization & Canonical Key Management.
 *
 * Guarantees that:
 *   ONE Student + ONE Date + ONE Period + ONE Subject = ONE Attendance Record
 * Regardless of whether the record originated from:
 *   - Excel import
 *   - Manual attendance marking
 *   - FN/AN bulk session marking
 *   - Individual period corrections
 *   - Re-importing Excel workbooks
 * ------------------------------------------------------------------- */
const Norm = (() => {

  // ---- String & basic normalization helpers --------------------------
  function str(v) {
    return (v === null || v === undefined) ? '' : String(v).trim();
  }

  function upperClean(v) {
    return str(v).toUpperCase().replace(/\s+/g, ' ');
  }

  function codeClean(v) {
    return str(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // ---- Student normalization -----------------------------------------
  // Normalize roll numbers: "023", "23", "Roll 23", "Roll: 23" -> "23"
  function rollNo(v) {
    const raw = str(v);
    if (!raw) return '';
    // Extract first numeric run if present
    const m = raw.match(/\d+/);
    if (m) {
      const num = parseInt(m[0], 10);
      if (!isNaN(num)) return String(num);
    }
    return codeClean(raw);
  }

  // Normalize register numbers: "REG023", "reg-023", " 023 " -> "REG023"
  function regNo(v) {
    return codeClean(v);
  }

  function studentName(v) {
    return upperClean(v);
  }

  function nameKey(v) {
    return studentName(v);
  }

  function studentId(v) {
    const raw = str(v);
    if (!raw) return '';
    return raw.toLowerCase();
  }

  // Check if two student identifiers or student records point to the same student
  function isSameStudent(a, b, studentsList = []) {
    if (!a || !b) return false;
    const aObj = typeof a === 'object' ? a : resolveStudent(a, studentsList);
    const bObj = typeof b === 'object' ? b : resolveStudent(b, studentsList);

    const aId = aObj ? aObj.id : studentId(a);
    const bId = bObj ? bObj.id : studentId(b);
    if (aId && bId && aId === bId) return true;

    const aRoll = rollNo(aObj ? (aObj.rollNo || aObj.roll) : a);
    const bRoll = rollNo(bObj ? (bObj.rollNo || bObj.roll) : b);
    if (aRoll && bRoll && aRoll === bRoll) return true;

    const aReg = regNo(aObj ? (aObj.regNo || aObj.reg) : a);
    const bReg = regNo(bObj ? (bObj.regNo || bObj.reg) : b);
    if (aReg && bReg && aReg === bReg) return true;

    const aName = nameKey(aObj ? aObj.name : a);
    const bName = nameKey(bObj ? bObj.name : b);
    if (aName && bName && aName === bName) return true;

    return false;
  }

  // Find existing student record by id, rollNo, regNo, or name
  function resolveStudent(query, studentsList = []) {
    if (!query) return null;
    if (typeof query === 'object' && query.id) {
      const match = studentsList.find((s) => s.id === query.id);
      if (match) return match;
    }
    const qStr = typeof query === 'object' ? (query.id || query.name || query.rollNo || '') : str(query);
    const qId = studentId(qStr);
    const qRoll = rollNo(typeof query === 'object' ? (query.rollNo || qStr) : qStr);
    const qReg = regNo(typeof query === 'object' ? (query.regNo || qStr) : qStr);
    const qName = nameKey(typeof query === 'object' ? (query.name || qStr) : qStr);

    // 1. Direct ID match
    let found = studentsList.find((s) => studentId(s.id) === qId);
    if (found) return found;

    // 2. Roll number match
    if (qRoll) {
      found = studentsList.find((s) => rollNo(s.rollNo) === qRoll);
      if (found) return found;
    }

    // 3. Register number match
    if (qReg) {
      found = studentsList.find((s) => regNo(s.regNo) === qReg);
      if (found) return found;
    }

    // 4. Name key match
    if (qName) {
      found = studentsList.find((s) => nameKey(s.nameKey || s.name) === qName);
      if (found) return found;
    }

    return null;
  }

  // ---- Date normalization --------------------------------------------
  // Converts any date format to canonical YYYY-MM-DD
  // Handles: Date objects, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, DD-MMM-YYYY, Excel dates
  const MONTH_MAP = {
    JAN: '01', JANU: '01', JANUARY: '01',
    FEB: '02', FEBR: '02', FEBRUARY: '02',
    MAR: '03', MARC: '03', MARCH: '03',
    APR: '04', APRI: '04', APRIL: '04',
    MAY: '05',
    JUN: '06', JUNE: '06',
    JUL: '07', JULY: '07',
    AUG: '08', AUGU: '08', AUGUST: '08',
    SEP: '09', SEPT: '09', SEPTEMBER: '09',
    OCT: '10', OCTO: '10', OCTOBER: '10',
    NOV: '11', NOVE: '11', NOVEMBER: '11',
    DEC: '12', DECE: '12', DECEMBER: '12',
  };

  function date(v) {
    if (!v) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    const s = str(v).trim();
    if (!s) return '';

    // Already YYYY-MM-DD
    const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (isoMatch) {
      const y = isoMatch[1];
      const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
      const d = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // Textual: 22-Sep-2026, 22 Sep 2026, Sep 22 2026
    const txtMatch1 = s.match(/^(\d{1,2})[-/.\s]+([A-Za-z]+)[-/.\s]+(\d{4})/);
    if (txtMatch1) {
      const d = String(parseInt(txtMatch1[1], 10)).padStart(2, '0');
      const monStr = txtMatch1[2].slice(0, 3).toUpperCase();
      const m = MONTH_MAP[monStr];
      const y = txtMatch1[3];
      if (m) return `${y}-${m}-${d}`;
    }

    const txtMatch2 = s.match(/^([A-Za-z]+)[-/.\s]+(\d{1,2})[-/.,\s]+(\d{4})/);
    if (txtMatch2) {
      const monStr = txtMatch2[1].slice(0, 3).toUpperCase();
      const m = MONTH_MAP[monStr];
      const d = String(parseInt(txtMatch2[2], 10)).padStart(2, '0');
      const y = txtMatch2[3];
      if (m) return `${y}-${m}-${d}`;
    }

    // DD/MM/YYYY or DD-MM-YYYY (or MM/DD/YYYY if DD > 12)
    const numMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (numMatch) {
      let p1 = parseInt(numMatch[1], 10);
      let p2 = parseInt(numMatch[2], 10);
      const y = numMatch[3];
      // Default Indian/UK academic format is DD/MM/YYYY
      let dayVal = p1;
      let monthVal = p2;
      if (p1 <= 12 && p2 > 12) {
        // Must be MM/DD/YYYY
        monthVal = p1;
        dayVal = p2;
      }
      return `${y}-${String(monthVal).padStart(2, '0')}-${String(dayVal).padStart(2, '0')}`;
    }

    // Fallback: Date.parse
    const ts = Date.parse(s);
    if (!isNaN(ts)) {
      const dt = new Date(ts);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    return s;
  }

  // ---- Period normalization ------------------------------------------
  // Normalize: 1, "P1", "P01", "Period 1", "P-1", "PERIOD 3" -> 1, 3
  function period(v) {
    if (typeof v === 'number' && !isNaN(v)) return Math.floor(v);
    const s = str(v);
    if (!s) return 1;
    const m = s.match(/(\d{1,2})/);
    if (m) {
      const p = parseInt(m[1], 10);
      if (!isNaN(p)) return p;
    }
    return 1;
  }

  // ---- Subject normalization -----------------------------------------
  // Normalize raw strings: "Vibration Lab", "VL", "VL - Vibration Lab", "ME8511"
  function subjectCode(v) {
    const raw = str(v);
    if (!raw) return '';
    return codeClean(raw);
  }

  // Generate acronym / initials: "Vibration Lab" -> "VL", "Dynamics of Machines" -> "DOM"
  function makeAcronym(name) {
    if (!name) return '';
    const clean = str(name).replace(/[^A-Za-z0-9\s]/g, ' ');
    const words = clean.split(/\s+/).filter((w) => w.length > 0 && !/^(AND|OF|THE|IN|FOR|TO|A|AN)$/i.test(w));
    if (words.length <= 1) return codeClean(clean);
    return words.map((w) => w[0].toUpperCase()).join('');
  }

  // Check if two subject codes or names refer to the same subject
  function isSameSubject(a, b, subjectsList = [], timetableList = []) {
    if (!a || !b) return false;
    const codeA = codeClean(a);
    const codeB = codeClean(b);
    if (codeA && codeB && codeA === codeB) return true;

    const normA = upperClean(a);
    const normB = upperClean(b);
    if (normA && normB && normA === normB) return true;

    const canA = resolveSubjectCode(a, subjectsList, timetableList);
    const canB = resolveSubjectCode(b, subjectsList, timetableList);
    if (canA && canB && canA === canB) return true;

    return false;
  }

  // Resolves ANY subject reference (sheet name, code, timetable label) to a stable canonical code
  function resolveSubjectCode(query, subjectsList = [], timetableList = []) {
    const qStr = str(query);
    if (!qStr) return '';
    const qClean = codeClean(qStr);
    const qUpper = upperClean(qStr);

    // 1. Direct code match in subjects list
    const byCode = subjectsList.find((s) => codeClean(s.code) === qClean);
    if (byCode) return byCode.code;

    // 2. Direct code match in timetable list
    const byTtCode = timetableList.find((t) => codeClean(t.code) === qClean);
    if (byTtCode) return byTtCode.code;

    // 3. Exact name match in subjects list
    const byName = subjectsList.find((s) => upperClean(s.name) === qUpper);
    if (byName) return byName.code;

    // 4. Exact subject name match in timetable
    const byTtSubject = timetableList.find((t) => upperClean(t.subject) === qUpper);
    if (byTtSubject) return byTtSubject.code;

    // 5. Delimited string check: e.g. "VL - Vibration Lab" or "VL (Vibration Lab)"
    const parts = qUpper.split(/[-—:()_]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (const p of parts) {
        const found = subjectsList.find((s) => codeClean(s.code) === codeClean(p) || upperClean(s.name) === p) ||
                      timetableList.find((t) => codeClean(t.code) === codeClean(p) || upperClean(t.subject) === p);
        if (found) return found.code;
      }
    }

    // 6. Acronym matching: e.g. "Vibration Lab" matches code "VL"
    const qAcro = makeAcronym(qStr);
    if (qAcro) {
      const byAcroSubj = subjectsList.find((s) => codeClean(s.code) === qAcro);
      if (byAcroSubj) return byAcroSubj.code;

      const byAcroTt = timetableList.find((t) => codeClean(t.code) === qAcro);
      if (byAcroTt) return byAcroTt.code;
    }

    // Reverse acronym: query is "VL", subject name in timetable is "Vibration Lab"
    for (const s of subjectsList) {
      if (makeAcronym(s.name) === qClean) return s.code;
    }
    for (const t of timetableList) {
      if (makeAcronym(t.subject) === qClean) return t.code;
    }

    // 7. Substring inclusion if unambiguous
    for (const s of subjectsList) {
      const sUpper = upperClean(s.name);
      if (sUpper && (sUpper.includes(qUpper) || qUpper.includes(sUpper))) {
        return s.code;
      }
    }
    for (const t of timetableList) {
      const tUpper = upperClean(t.subject);
      if (tUpper && (tUpper.includes(qUpper) || qUpper.includes(tUpper))) {
        return t.code;
      }
    }

    // Fallback: If query had a code prefix before delimiter, use it, else return cleaned code
    if (parts.length > 1 && codeClean(parts[0]).length <= 10) {
      return codeClean(parts[0]);
    }
    return qClean || qStr;
  }

  // ---- The Canonical Attendance Key ----------------------------------
  // attendanceKey = normalizedStudentId + "|" + normalizedDate + "|" + normalizedPeriod + "|" + normalizedSubjectId
  function makeKey(stuId, d, p, subCode, subjectsList = [], timetableList = []) {
    const s = studentId(stuId);
    const dt = date(d);
    const pr = period(p);
    const resolved = (subjectsList && subjectsList.length) || (timetableList && timetableList.length)
      ? resolveSubjectCode(subCode, subjectsList, timetableList)
      : subCode;
    const sb = subjectCode(resolved || subCode);
    return `${s}|${dt}|${pr}|${sb}`;
  }

  // Deterministic conflict resolution for duplicates:
  // Precedence:
  // 1. locked === true
  // 2. source === 'manual' over 'import'
  // 3. latest timestamp (updatedAt || importedAt)
  function resolveWinningRecord(records) {
    if (!records || records.length === 0) return null;
    if (records.length === 1) return records[0];

    return records.reduce((winner, candidate) => {
      if (!winner) return candidate;

      // Rule 1: locked wins
      if (candidate.locked && !winner.locked) return candidate;
      if (winner.locked && !candidate.locked) return winner;

      // Rule 2: manual source wins over import
      if (candidate.source === 'manual' && winner.source !== 'manual') return candidate;
      if (winner.source === 'manual' && candidate.source !== 'manual') return winner;

      // Rule 3: newest timestamp
      const timeC = candidate.updatedAt || candidate.importedAt || '0';
      const timeW = winner.updatedAt || winner.importedAt || '0';
      if (timeC > timeW) return candidate;

      return winner;
    });
  }

  // ---- Deduplication & Migration -------------------------------------
  // Migrates existing database records to canonical keys and removes duplicates
  async function cleanupAndMigrate(dbInstance) {
    try {
      const [allAttendance, allStudents, allSubjects, allTimetable] = await Promise.all([
        dbInstance.getAll('attendance'),
        dbInstance.getAll('students'),
        dbInstance.getAll('subjects'),
        dbInstance.getAll('timetable'),
      ]);

      if (!allAttendance || allAttendance.length === 0) {
        return { duplicatesRemoved: 0, migrated: 0 };
      }

      // Group by canonical identity
      const groups = new Map();
      for (const rec of allAttendance) {
        if (!rec) continue;
        const normSt = resolveStudent(rec.studentId, allStudents);
        const canonStudentId = normSt ? normSt.id : studentId(rec.studentId);
        const canonDate = date(rec.date);
        const canonPeriod = period(rec.period);
        const canonSubj = resolveSubjectCode(rec.subjectCode, allSubjects, allTimetable);
        const canonKey = makeKey(canonStudentId, canonDate, canonPeriod, canonSubj);

        if (!groups.has(canonKey)) groups.set(canonKey, []);
        groups.get(canonKey).push({
          ...rec,
          _canonKey: canonKey,
          _canonStudentId: canonStudentId,
          _canonDate: canonDate,
          _canonPeriod: canonPeriod,
          _canonSubj: canonSubj,
        });
      }

      const toPut = [];
      const toDelete = [];
      let duplicatesRemoved = 0;
      let migrated = 0;

      for (const [canonKey, items] of groups.entries()) {
        const winner = resolveWinningRecord(items);
        const canonicalRecord = {
          key: canonKey,
          studentId: winner._canonStudentId,
          date: winner._canonDate,
          period: winner._canonPeriod,
          subjectCode: winner._canonSubj,
          status: winner.status === 'P' ? 'P' : 'A',
          source: winner.source || 'manual',
          locked: !!winner.locked,
          note: winner.note || '',
          importedAt: winner.importedAt || new Date().toISOString(),
          updatedAt: winner.updatedAt || winner.importedAt || new Date().toISOString(),
        };

        toPut.push(canonicalRecord);

        // Delete any records whose original key does not match canonKey, or duplicates
        for (const it of items) {
          if (it.key !== canonKey) {
            toDelete.push(it.key);
            migrated++;
          }
        }
        if (items.length > 1) {
          duplicatesRemoved += (items.length - 1);
        }
      }

      // Batch delete old keys
      for (const oldKey of toDelete) {
        await dbInstance.del('attendance', oldKey);
      }

      // Batch put canonical records
      if (toPut.length > 0) {
        await dbInstance.putMany('attendance', toPut);
      }

      return { duplicatesRemoved, migrated, totalCanonical: toPut.length };
    } catch (err) {
      console.warn('Attendance cleanup error:', err);
      return { error: err };
    }
  }

  // ---- Academic Calendar Helpers ------------------------------------
  const CALENDAR_TYPES = {
    NORMAL: { code: 'NORMAL', label: 'Normal Working Day', emoji: '📅', color: 'var(--text-muted)' },
    GOVERNMENT_HOLIDAY: { code: 'GOVERNMENT_HOLIDAY', label: 'Government Holiday', emoji: '🏛️', color: 'var(--present)' },
    COLLEGE_HOLIDAY: { code: 'COLLEGE_HOLIDAY', label: 'College Holiday', emoji: '🏫', color: '#a78bfa' },
    CLASS_LEAVE: { code: 'CLASS_LEAVE', label: 'Class Leave', emoji: '🏖️', color: '#38bdf8' },
    INTERNAL_EXAM: { code: 'INTERNAL_EXAM', label: 'Internal Examination', emoji: '📝', color: '#f59e0b' },
    OTHER_NO_CLASS: { code: 'OTHER_NO_CLASS', label: 'Other No-Class Day', emoji: '⛔', color: '#ef4444' },
  };

  function getCalTypeCode(input) {
    if (!input) return 'NORMAL';
    if (typeof input === 'string') return input.toUpperCase();
    return (input.type || input.code || 'NORMAL').toUpperCase();
  }

  function isHoliday(input) {
    const code = getCalTypeCode(input);
    return code === 'GOVERNMENT_HOLIDAY' || code === 'COLLEGE_HOLIDAY' || code === 'CLASS_LEAVE' || code === 'OTHER_NO_CLASS';
  }

  function isInternalExam(input) {
    const code = getCalTypeCode(input);
    return code === 'INTERNAL_EXAM';
  }

  function isNoClassDay(input) {
    const code = getCalTypeCode(input);
    return code !== 'NORMAL' && code in CALENDAR_TYPES;
  }

  function getCalendarTypeMeta(input) {
    const code = getCalTypeCode(input);
    return CALENDAR_TYPES[code] || CALENDAR_TYPES.NORMAL;
  }

  return {
    rollNo,
    regNo,
    studentName,
    nameKey,
    studentId,
    isSameStudent,
    resolveStudent,
    date,
    period,
    subjectCode,
    makeAcronym,
    isSameSubject,
    resolveSubjectCode,
    makeKey,
    resolveWinningRecord,
    cleanupAndMigrate,
    CALENDAR_TYPES,
    isHoliday,
    isInternalExam,
    isNoClassDay,
    getCalendarTypeMeta,
  };
})();

if (typeof window !== 'undefined') window.Norm = Norm;
if (typeof globalThis !== 'undefined') globalThis.Norm = Norm;
