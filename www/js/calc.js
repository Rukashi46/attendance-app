/* ---------------------------------------------------------------------
 * Attendance calculations. Only 'P' and 'A' statuses are ever counted.
 * Blank / holiday / cancelled periods never enter the denominator.
 * ------------------------------------------------------------------- */
const Calc = (() => {

  function pct(present, absent) {
    const total = present + absent;
    return total === 0 ? null : (present / total) * 100;
  }

  // Calculate attendance margin against a target percentage (e.g. 75%).
  // Returns:
  // - type: 'safe' -> student is above target and can miss `count` consecutive periods without falling below target.
  // - type: 'need' -> student is below target and must attend `count` consecutive periods to reach target.
  // - type: 'none' -> no classes recorded yet.
  function margin(present, absent, target = 75) {
    const total = present + absent;
    if (total === 0) return { type: 'none', count: 0, text: 'No classes' };
    const targetRatio = (target || 75) / 100;
    const currentRatio = present / total;

    if (currentRatio >= targetRatio) {
      const canMiss = Math.floor((present - targetRatio * total) / targetRatio);
      return {
        type: 'safe',
        count: Math.max(0, canMiss),
        text: canMiss > 0 ? `Can miss ${canMiss}` : 'On edge (0)',
      };
    } else {
      const need = Math.ceil((targetRatio * total - present) / (1 - targetRatio));
      return {
        type: 'need',
        count: Math.max(1, need),
        text: `Need ${Math.max(1, need)} to reach ${target}%`,
      };
    }
  }

  // Full-semester bunk & attendance margin based on Total Allocated / Planned Periods.
  // E.g. Total Allocated: 45 classes. Conducted so far: 20. Attended so far: 18.
  // Minimum required across 45 classes at 75% = ceil(45 * 0.75) = 34.
  // Remaining classes in semester = 45 - 20 = 25.
  // Classes still needed from remaining = max(0, 34 - 18) = 16.
  // Bunk margin = 25 - 16 = 9 classes can safely be skipped out of 25!
  function semesterMargin(attended, conducted, totalAllocated, target = 75) {
    const alloc = parseInt(totalAllocated, 10);
    if (!alloc || alloc <= 0) return null;
    const targetRatio = (target || 75) / 100;
    const requiredTotal = Math.ceil(alloc * targetRatio);
    const cond = Math.min(alloc, conducted);
    const remaining = Math.max(0, alloc - cond);
    const need = Math.max(0, requiredTotal - attended);

    if (need > remaining) {
      const maxPossible = Math.round(((attended + remaining) / alloc) * 100);
      return {
        possible: false,
        allocated: alloc,
        conducted: cond,
        remaining,
        need,
        canMiss: 0,
        maxPossible,
        text: `Shortage! Cannot reach ${target}% (Max: ${maxPossible}%)`,
      };
    }

    const canMiss = remaining - need;
    return {
      possible: true,
      allocated: alloc,
      conducted: cond,
      remaining,
      need,
      canMiss,
      text: canMiss > 0 ? `Can miss ${canMiss} of ${remaining} remaining` : `Must attend all remaining ${remaining}`,
    };
  }

  // Build a full stats object from the raw attendance record list.
  // records: [{studentId, date, period, subjectCode, status}]
  function buildStats(records) {
    const byStudent = new Map(); // studentId -> { subjects: Map(code -> {p,a}), p, a }
    const bySubject = new Map(); // code -> { p, a, byStudent: Map(id -> {p,a}), periods: Set(date|period) }
    const byDate = new Map();    // date -> { p, a, periods: Map(period -> {p,a,subjectCode}) }
    const conductedBySubject = new Map(); // code -> Set(date|period)

    for (const r of records) {
      if (r.status !== 'P' && r.status !== 'A') continue;
      const inc = r.status === 'P' ? 'p' : 'a';

      if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, { p: 0, a: 0, subjects: new Map() });
      const st = byStudent.get(r.studentId);
      st[inc]++;
      if (!st.subjects.has(r.subjectCode)) st.subjects.set(r.subjectCode, { p: 0, a: 0 });
      st.subjects.get(r.subjectCode)[inc]++;

      if (!bySubject.has(r.subjectCode)) {
        bySubject.set(r.subjectCode, { p: 0, a: 0, byStudent: new Map(), periods: new Set() });
      }
      const su = bySubject.get(r.subjectCode);
      su[inc]++;
      if (!su.byStudent.has(r.studentId)) su.byStudent.set(r.studentId, { p: 0, a: 0 });
      su.byStudent.get(r.studentId)[inc]++;
      su.periods.add(`${r.date}|${r.period}`);

      if (!conductedBySubject.has(r.subjectCode)) conductedBySubject.set(r.subjectCode, new Set());
      conductedBySubject.get(r.subjectCode).add(`${r.date}|${r.period}`);

      if (!byDate.has(r.date)) byDate.set(r.date, { p: 0, a: 0, periods: new Map() });
      const dt = byDate.get(r.date);
      dt[inc]++;
      if (!dt.periods.has(r.period)) dt.periods.set(r.period, { p: 0, a: 0, subjectCode: r.subjectCode });
      dt.periods.get(r.period)[inc]++;
    }

    return { byStudent, bySubject, byDate, conductedBySubject };
  }

  // NOTE: allocatedPeriods is keyed ONLY by subject code (e.g. { AMED: 60 }).
  // There is deliberately no student-level or class-wide default quota here —
  // quota is a property of a subject, never of a student or the class overall.
  function studentOverall(stats, studentId, target = 75, allocatedPeriods = {}) {
    const st = stats.byStudent.get(studentId);
    if (!st) {
      return {
        present: 0, absent: 0, total: 0, pct: null,
        margin: { type: 'none', count: 0, text: 'No classes' },
        semesterMargin: null,
        subjects: {},
      };
    }
    const subjects = {};
    for (const [code, v] of st.subjects.entries()) {
      const subTotal = v.p + v.a;
      const subPct = pct(v.p, v.a);
      const conducted = stats.conductedBySubject?.get(code)?.size || subTotal;
      const subAlloc = allocatedPeriods[code] || 0;
      subjects[code] = {
        code,
        present: v.p,
        absent: v.a,
        total: subTotal,
        conducted,
        allocated: subAlloc || null,
        pct: subPct,
        margin: margin(v.p, v.a, target),
        semesterMargin: subAlloc ? semesterMargin(v.p, conducted, subAlloc, target) : null,
      };
    }
    const total = st.p + st.a;
    const overallPct = pct(st.p, st.a);
    return {
      present: st.p,
      absent: st.a,
      total,
      pct: overallPct,
      margin: margin(st.p, st.a, target),
      subjects,
    };
  }

  function classOverall(stats) {
    let p = 0, a = 0;
    for (const st of stats.byStudent.values()) { p += st.p; a += st.a; }
    return { present: p, absent: a, total: p + a, pct: pct(p, a) };
  }

  function subjectSummary(stats, code, target = 75, allocatedPeriods = {}) {
    const su = stats.bySubject.get(code);
    const conducted = stats.conductedBySubject?.get(code)?.size || 0;
    // Quota is a per-subject property only — no class-wide/default fallback.
    const allocated = allocatedPeriods[code] || 0;
    if (!su) {
      return {
        code,
        present: 0, absent: 0, total: 0, pct: null,
        conducted: 0, allocated, above: 0, below: 0, students: [],
      };
    }
    let above = 0, below = 0;
    const students = [];
    for (const [id, v] of su.byStudent.entries()) {
      const p = pct(v.p, v.a);
      const m = margin(v.p, v.a, target);
      const sm = allocated ? semesterMargin(v.p, conducted, allocated, target) : null;
      if (p !== null) {
        if (p >= target) above++;
        else below++;
      }
      students.push({
        studentId: id,
        present: v.p,
        absent: v.a,
        total: v.p + v.a,
        pct: p,
        margin: m,
        semesterMargin: sm,
      });
    }
    const total = su.p + su.a;
    return {
      code,
      present: su.p,
      absent: su.a,
      total,
      pct: pct(su.p, su.a),
      conducted,
      allocated,
      above,
      below,
      students: students.sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1)),
    };
  }

  function lowAttendance(stats, threshold = 75) {
    const rows = [];
    for (const [id, st] of stats.byStudent.entries()) {
      const p = pct(st.p, st.a);
      if (p !== null && p < threshold) {
        const m = margin(st.p, st.a, threshold);
        rows.push({
          studentId: id,
          pct: p,
          present: st.p,
          absent: st.a,
          total: st.p + st.a,
          margin: m,
        });
      }
    }
    return rows.sort((a, b) => a.pct - b.pct);
  }

  function dateBreakdown(stats, date) {
    const dt = stats.byDate.get(date);
    if (!dt) return null;
    const periods = [...dt.periods.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([period, v]) => ({ period, present: v.p, absent: v.a, subjectCode: v.subjectCode }));
    return { present: dt.p, absent: dt.a, periods };
  }

  function monthly(records, year, month /* 1-12 */) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const filtered = records.filter((r) => r.date.startsWith(prefix) && (r.status === 'P' || r.status === 'A'));
    const stats = buildStats(filtered);
    const overall = classOverall(stats);
    const subjects = {};
    for (const code of stats.bySubject.keys()) subjects[code] = subjectSummary(stats, code);
    return {
      present: overall.present,
      absent: overall.absent,
      total: overall.total,
      pct: overall.pct,
      subjects,
      workingPeriods: new Set(filtered.map((r) => `${r.date}|${r.period}`)).size,
    };
  }

  return {
    buildStats,
    studentOverall,
    classOverall,
    subjectSummary,
    lowAttendance,
    dateBreakdown,
    monthly,
    pct,
    margin,
    semesterMargin,
  };
})();
