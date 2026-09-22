/* ---------------------------------------------------------------------
 * App controller: data cache, router, and all user-triggered actions.
 * ------------------------------------------------------------------- */
(() => {
  const view = () => document.getElementById('view');
  const nav = () => document.getElementById('bottomnav');

  let cache = {
    students: [], subjects: [], timetable: [], attendance: [],
    threshold: 75, theme: 'system', classInfo: {}, lastImport: null,
    allocatedPeriods: {}, syncConfig: { enabled: false, syncKey: '', autoSync: true }
  };

  // Transient (non-persisted) UI state
  const studentsState = { query: '', sort: 'name' };
  const markHomeState = { date: todayIso() };
  const calendarState = { date: todayIso() };
  let lowAttThreshold = null;
  let markPeriodState = null;
  let importState = null;
  let backupPending = false;
  let activeModalCanvas = null;
  let pendingModalResolve = null;

  function showImageModal(canvas, title, filename) {
    closeModal(); // clear any existing modal (and its stale canvas) FIRST
    activeModalCanvas = canvas; // THEN set the new canvas, so it isn't wiped out
    const imageUrl = canvas.toDataURL('image/png');
    const modalHtml = Render.imagePreviewModal({ title, imageUrl, filename });
    const div = document.createElement('div');
    div.id = 'active-modal-container';
    div.innerHTML = modalHtml;
    document.body.appendChild(div);
  }

  function closeModal() {
    const el = document.getElementById('active-modal-container');
    if (el) el.remove();
    activeModalCanvas = null;
    if (pendingModalResolve) { const r = pendingModalResolve; pendingModalResolve = null; r(null); }
  }

  // ---- In-app replacements for confirm() / prompt() / alert() ---------
  // The app must never rely on native browser dialogs for normal workflows.
  function openConfirmModal({ title = 'Please confirm', message = '', confirmLabel = 'Confirm', danger = false } = {}) {
    closeModal();
    return new Promise((resolve) => {
      pendingModalResolve = resolve;
      const div = document.createElement('div');
      div.id = 'active-modal-container';
      div.innerHTML = Render.confirmModal({ title, message, confirmLabel, danger });
      document.body.appendChild(div);
      window.__resolveActiveModal = (val) => {
        pendingModalResolve = null;
        closeModal();
        resolve(val);
      };
    });
  }

  function openPromptModal({ title = 'Enter a value', label = '', value = '', placeholder = '', numeric = true } = {}) {
    closeModal();
    return new Promise((resolve) => {
      pendingModalResolve = resolve;
      const div = document.createElement('div');
      div.id = 'active-modal-container';
      div.innerHTML = Render.promptModal({ title, label, value, placeholder });
      document.body.appendChild(div);
      const input = document.getElementById('prompt-modal-input');
      if (input) { input.focus(); input.select(); }
      window.__resolveActiveModal = (val) => {
        pendingModalResolve = null;
        closeModal();
        resolve(val);
      };
    });
  }

  function showToast(message, type = 'success', duration = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, duration);
  }
  window.addEventListener('app:toast', (e) => {
    showToast(e.detail?.message || '', e.detail?.type || 'success');
  });

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function studentById(id) { return cache.students.find((s) => s.id === id); }
  function subjectByCode(code) { return cache.subjects.find((s) => s.code === code); }
  function matchSubjectByNormCode(normCode) { return cache.subjects.find((s) => Importer.normCode(s.code) === normCode); }
  function nameKeyOf(studentId) {
    const s = studentById(studentId);
    return s ? (s.nameKey || Importer.nameKey(s.name)) : '';
  }

  async function loadCache() {
    cache.students = await DB.getAll('students');
    cache.subjects = await DB.getAll('subjects');
    cache.timetable = await DB.getAll('timetable');
    cache.attendance = await DB.getAll('attendance');
    cache.threshold = await DB.getMeta('threshold', 75);
    cache.theme = await DB.getMeta('theme', 'system');
    cache.classInfo = await DB.getMeta('classInfo', {});
    cache.lastImport = await DB.getMeta('lastImport', null);
    cache.allocatedPeriods = await DB.getMeta('allocatedPeriods', {});
    // Normalize syncConfig field names — fall back to hardcoded defaults if DB record is stale
    const sc = await DB.getMeta('syncConfig', null) || {};
    const SC_DEFAULTS = { enabled: true, syncKey: 'ED-1A-2026', supabaseUrl: 'https://dnslnjlpkshmaiwkbjuu.supabase.co', supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuc2xuamxwa3NobWFpd2tianV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTAxNTUsImV4cCI6MjEwNTYyNjE1NX0.pv1x2Rqe0eFuODCeqcG2Sgbn17ZYZq2WNioGRd6MidM', autoSync: true };
    cache.syncConfig = {
      enabled:         sc.enabled !== undefined ? !!sc.enabled : SC_DEFAULTS.enabled,
      syncKey:         sc.syncKey         || sc.key || SC_DEFAULTS.syncKey,
      supabaseUrl:     sc.supabaseUrl     || SC_DEFAULTS.supabaseUrl,
      supabaseAnonKey: sc.supabaseAnonKey || SC_DEFAULTS.supabaseAnonKey,
      autoSync:        sc.autoSync        !== undefined ? sc.autoSync
                     : sc.auto           !== undefined ? sc.auto : SC_DEFAULTS.autoSync,
      lastSync:        sc.lastSync        || null,
    };
    applyTheme();
    if (window.SyncEngine && !window.SyncEngine._hasInit) {
      window.SyncEngine._hasInit = true;
      SyncEngine.init();
      // Live status indicator — updates the dot + text in Settings without a full re-render
      SyncEngine.onStatusChange((s) => {
        const el = document.getElementById('sync-status-text');
        if (!el) return;
        const dotColor = {
          synced:       'var(--present)',
          syncing:      'var(--warn, #f59e0b)',
          offline:      '#666',
          error:        'var(--absent)',
          unconfigured: '#444',
        }[s.status] || '#444';
        const label = {
          syncing:      'Syncing…',
          synced:       s.lastSync
            ? 'Last synced: ' + new Date(s.lastSync).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
            : 'Synced',
          offline:      'Offline — changes saved locally',
          error:        'Sync error — tap Sync Now to retry',
          unconfigured: 'Not configured — enter a Sync Key above',
        }[s.status] || 'Unknown';
        el.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></span> ${label}`;
      });
    }
  }

  function applyTheme() {
    const root = document.documentElement;
    let effective = cache.theme;
    if (effective === 'system') {
      effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    if (effective === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  function setActiveNav(key) { nav().innerHTML = Render.bottomNav(key); }

  // ------------------------------------------------------------------
  // Routes
  // ------------------------------------------------------------------
  const routes = [
    [/^#\/students\/new$/, () => viewStudentForm(null)],
    [/^#\/students\/([^/]+)\/edit$/, (m) => viewStudentForm(m[1])],
    [/^#\/students\/([^/]+)$/, (m) => viewStudentDetail(m[1])],
    [/^#\/students$/, viewStudents],
    [/^#\/mark\/period\/([^/]+)\/(\d+)\/([^/]+)$/, (m) => viewMarkPeriod(m[1], parseInt(m[2], 10), decodeURIComponent(m[3]))],
    [/^#\/mark$/, viewMarkHome],
    [/^#\/subjects\/([^/]+)$/, (m) => viewSubjectDetail(decodeURIComponent(m[1]))],
    [/^#\/subjects$/, viewSubjects],
    [/^#\/low-attendance$/, viewLowAttendance],
    [/^#\/calendar\/([^/]+)$/, (m) => viewCalendarDay(m[1])],
    [/^#\/calendar$/, viewCalendarHome],
    [/^#\/reports$/, viewReports],
    [/^#\/import$/, viewImport],
    [/^#\/backup$/, viewBackup],
    [/^#\/settings$/, viewSettings],
    [/^#\/more$/, viewMore],
    [/^#\/dashboard$/, viewDashboard],
  ];

  function navKeyForHash(hash) {
    if (hash.startsWith('#/students')) return 'students';
    if (hash.startsWith('#/mark')) return 'mark';
    if (hash.startsWith('#/subjects')) return 'subjects';
    if (hash.startsWith('#/dashboard') || hash === '' || hash === '#') return 'dashboard';
    return 'more';
  }

  async function dispatch() {
    const hash = location.hash || '#/dashboard';
    await loadCache();
    setActiveNav(navKeyForHash(hash));
    for (const [re, handler] of routes) {
      const m = hash.match(re);
      if (m) { await handler(m); window.scrollTo(0, 0); return; }
    }
    await viewDashboard();
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------
  async function viewDashboard() {
    const stats = Calc.buildStats(cache.attendance);
    const overall = Calc.classOverall(stats);
    const today = todayIso();
    const dayName = Render.dayNameOf(today);
    const todaysTT = cache.timetable.filter((t) => t.day === dayName).sort((a, b) => a.period - b.period);
    const todayClasses = todaysTT.map((t) => {
      const subject = matchSubjectByNormCode(t.code);
      const recs = cache.attendance.filter((a) => a.date === today && a.period === t.period && Importer.normCode(a.subjectCode) === t.code);
      return {
        period: t.period, time: t.time, code: subject ? subject.code : t.code,
        subjectName: subject ? subject.name : t.subject,
        done: recs.length > 0,
        present: recs.filter((r) => r.status === 'P').length,
        absent: recs.filter((r) => r.status === 'A').length,
      };
    });
    const todayRecs = cache.attendance.filter((a) => a.date === today);
    const data = {
      overallPct: overall.pct,
      totalStudents: cache.students.length,
      presentToday: todayRecs.filter((r) => r.status === 'P').length,
      absentToday: todayRecs.filter((r) => r.status === 'A').length,
      todayDayName: dayName,
      todayIso: today,
      todayClasses,
      threshold: cache.threshold,
      lowCount: Calc.lowAttendance(stats, cache.threshold).length,
      lastImport: cache.lastImport,
    };
    view().innerHTML = Render.dashboard(data);
  }

  function filteredSortedStudents() {
    const stats = Calc.buildStats(cache.attendance);
    let list = cache.students.map((s) => ({ ...s, pct: Calc.studentOverall(stats, s.id, cache.threshold, cache.allocatedPeriods).pct }));
    const q = studentsState.query.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.rollNo || '').toLowerCase().includes(q) || (s.regNo || '').toLowerCase().includes(q));
    }
    if (studentsState.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (studentsState.sort === 'roll') {
      list.sort((a, b) => {
        const ra = parseInt(a.rollNo, 10);
        const rb = parseInt(b.rollNo, 10);
        if (!isNaN(ra) && !isNaN(rb)) return ra - rb;
        return (a.rollNo || '').localeCompare(b.rollNo || '');
      });
    }
    else if (studentsState.sort === 'high') list.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    else if (studentsState.sort === 'low') list.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
    return list;
  }

  async function viewStudents() {
    view().innerHTML = Render.studentsList({ students: filteredSortedStudents(), query: studentsState.query, sort: studentsState.sort, threshold: cache.threshold });
  }

  function rerenderStudentsListOnly() {
    view().innerHTML = Render.studentsList({ students: filteredSortedStudents(), query: studentsState.query, sort: studentsState.sort, threshold: cache.threshold });
    const input = document.getElementById('student-search');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  async function viewStudentDetail(id) {
    const s = studentById(id);
    if (!s) { location.hash = '#/students'; return; }
    const stats = Calc.buildStats(cache.attendance);
    const overall = Calc.studentOverall(stats, id, cache.threshold, cache.allocatedPeriods);
    const subjectNames = Object.fromEntries(cache.subjects.map((sub) => [sub.code, sub.name]));
    const byDate = new Map();
    cache.attendance.filter((a) => a.studentId === id && (a.status === 'P' || a.status === 'A')).forEach((a) => {
      if (!byDate.has(a.date)) byDate.set(a.date, { date: a.date, present: 0, absent: 0 });
      byDate.get(a.date)[a.status === 'P' ? 'present' : 'absent']++;
    });
    const recentDays = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    view().innerHTML = Render.studentDetail({
      student: s,
      stats: overall,
      subjectNames,
      recentDays,
      threshold: cache.threshold,
    });
  }

  async function viewStudentForm(id) {
    const s = id ? studentById(id) : null;
    view().innerHTML = Render.studentForm({ student: s });
  }

  async function viewMarkHome() {
    const date = markHomeState.date;
    const dayName = Render.dayNameOf(date);
    const stats = Calc.buildStats(cache.attendance);
    const tt = cache.timetable.filter((t) => t.day === dayName).sort((a, b) => a.period - b.period);
    const classes = tt.map((t) => {
      const subject = matchSubjectByNormCode(t.code);
      const code = subject ? subject.code : t.code;
      const recs = cache.attendance.filter((a) => a.date === date && a.period === t.period && Importer.normCode(a.subjectCode) === t.code);
      return {
        period: t.period, time: t.time, code,
        subjectName: subject ? subject.name : t.subject,
        marked: recs.length > 0,
        present: recs.filter((r) => r.status === 'P').length,
        absent: recs.filter((r) => r.status === 'A').length,
      };
    });
    view().innerHTML = Render.markHome({ date, dayName, classes, subjects: cache.subjects, today: todayIso() });
  }

  async function viewMarkPeriod(date, period, code) {
    const subject = subjectByCode(code) || { code, name: code };
    const existing = cache.attendance.filter((a) => a.date === date && a.period === period && a.subjectCode === code);
    const existingByStudent = new Map(existing.map((r) => [r.studentId, r]));
    const locked = existing.some((r) => r.locked);
    const rows = cache.students.filter((s) => s.active !== false).map((s) => ({
      studentId: s.id, name: s.name,
      status: existingByStudent.has(s.id) ? existingByStudent.get(s.id).status : null,
    }));
    markPeriodState = { date, period, code, locked, rows };
    view().innerHTML = Render.markPeriod({ date, period, subjectName: subject.name, locked, rows });
  }

  function rerenderMarkPeriod() {
    const { date, period, code, locked, rows } = markPeriodState;
    const subject = subjectByCode(code) || { code, name: code };
    view().innerHTML = Render.markPeriod({ date, period, subjectName: subject.name, locked, rows });
  }

  async function viewSubjects() {
    const stats = Calc.buildStats(cache.attendance);
    const subjects = cache.subjects.map((s) => ({ ...s, pct: Calc.subjectSummary(stats, s.code, cache.threshold, cache.allocatedPeriods).pct }));
    subjects.sort((a, b) => a.code.localeCompare(b.code));
    view().innerHTML = Render.subjectsList({ subjects, threshold: cache.threshold });
  }

  async function viewSubjectDetail(code, filter = 'all') {
    const subject = subjectByCode(code) || { code, name: code };
    const stats = Calc.buildStats(cache.attendance);
    const summary = Calc.subjectSummary(stats, code, cache.threshold, cache.allocatedPeriods);
    const students = summary.students.map((r) => ({ ...r, name: (studentById(r.studentId) || {}).name || '—' }));
    const above = students.filter((s) => s.pct !== null && s.pct >= cache.threshold).length;
    const below = students.filter((s) => s.pct !== null && s.pct < cache.threshold).length;
    view().innerHTML = Render.subjectDetail({
      code: subject.code,
      name: subject.name,
      pct: summary.pct,
      conducted: summary.conducted,
      students,
      above,
      below,
      filter,
      threshold: cache.threshold,
      allocatedPeriods: cache.allocatedPeriods[code] || null,
    });
  }

  async function viewLowAttendance() {
    const threshold = lowAttThreshold ?? cache.threshold;
    const stats = Calc.buildStats(cache.attendance);
    const rows = Calc.lowAttendance(stats, threshold).map((r) => ({ ...r, name: (studentById(r.studentId) || {}).name || '—' }));
    view().innerHTML = Render.lowAttendance({ threshold, rows });
  }

  async function viewCalendarHome() {
    const dates = [...new Set(cache.attendance.map((a) => a.date))].sort((a, b) => b.localeCompare(a)).slice(0, 15);
    view().innerHTML = Render.calendarHome({ date: calendarState.date, recentDates: dates });
  }

  async function viewCalendarDay(date) {
    const stats = Calc.buildStats(cache.attendance);
    const bd = Calc.dateBreakdown(stats, date);
    view().innerHTML = Render.calendarDay({ date, periods: bd ? bd.periods : [] });
  }

  async function viewReports() {
    const stats = Calc.buildStats(cache.attendance);
    const overall = Calc.classOverall(stats);
    const subjects = cache.subjects.map((s) => {
      const sum = Calc.subjectSummary(stats, s.code, cache.threshold, cache.allocatedPeriods);
      return {
        code: s.code,
        name: s.name,
        pct: sum.pct,
        conducted: sum.conducted,
        present: sum.present,
        absent: sum.absent,
        above: sum.above,
        below: sum.below,
      };
    });
    subjects.sort((a, b) => a.code.localeCompare(b.code));
    const now = new Date();
    const month = Calc.monthly(cache.attendance, now.getFullYear(), now.getMonth() + 1);
    const studentsList = cache.students
      .filter((s) => s.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name));
    view().innerHTML = Render.reports({
      classPct: overall.pct,
      subjects,
      month,
      studentsList,
      threshold: cache.threshold,
    });
  }

  async function viewMore() { view().innerHTML = Render.more(); }
  async function viewImport() { importState = null; view().innerHTML = Render.importHome(); }
  async function viewBackup() { view().innerHTML = Render.backup(); }
  async function viewSettings() { view().innerHTML = Render.settings({ theme: cache.theme, classInfo: cache.classInfo, threshold: cache.threshold, syncConfig: cache.syncConfig }); }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  async function saveAttendanceRow(studentId, date, period, subjectCode, status, locked) {
    const nk = nameKeyOf(studentId);
    const key = `${nk}|${date}|${period}`;
    await DB.put('attendance', { key, studentId, date, period, subjectCode, status, source: 'manual', locked: !!locked, note: '', importedAt: new Date().toISOString() });
    if (window.SyncEngine) SyncEngine.autoSync();
  }

  async function handleClick(e) {
    // Backdrop click-outside-to-close: only when the backdrop element itself
    // (not a descendant like the card, image, or a button inside it) is the
    // actual click target.
    if (e.target && e.target.id === 'app-modal-backdrop') {
      if (window.__resolveActiveModal) window.__resolveActiveModal(null);
      else closeModal();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'back') { history.back(); return; }

    // Generic confirm/prompt modal wiring (used by openConfirmModal/openPromptModal)
    if (action === 'confirm-modal-yes') { if (window.__resolveActiveModal) window.__resolveActiveModal(true); return; }
    if (action === 'confirm-modal-no') { if (window.__resolveActiveModal) window.__resolveActiveModal(false); return; }
    if (action === 'prompt-modal-ok') {
      const input = document.getElementById('prompt-modal-input');
      const val = input ? input.value : null;
      if (window.__resolveActiveModal) window.__resolveActiveModal(val);
      return;
    }
    if (action === 'prompt-modal-cancel') { if (window.__resolveActiveModal) window.__resolveActiveModal(null); return; }

    if (action === 'open-sort') {
      const modes = ['name', 'roll', 'low', 'high'];
      const nextIndex = (modes.indexOf(studentsState.sort) + 1) % modes.length;
      studentsState.sort = modes[nextIndex];
      rerenderStudentsListOnly();
      return;
    }
    if (action === 'set-student-sort') {
      studentsState.sort = btn.dataset.sort || 'name';
      rerenderStudentsListOnly();
      return;
    }

    if (action === 'set-allocated-periods') {
      // Quota is a SUBJECT property only. This action always requires a subject
      // code — there is no class-wide/default/student-level quota to set.
      const code = btn.dataset.code;
      if (!code) return;
      const cur = cache.allocatedPeriods[code] || '';
      const input = await openPromptModal({
        title: 'Semester Planned Periods',
        label: `Total periods planned for ${code} this semester`,
        value: cur,
        placeholder: 'e.g. 60',
      });
      if (input === null) return;
      const num = parseInt(String(input).trim(), 10);
      if (isNaN(num) || num <= 0) {
        showToast('Please enter a valid positive number.', 'error');
        return;
      }
      cache.allocatedPeriods[code] = num;
      await DB.setMeta('allocatedPeriods', cache.allocatedPeriods);
      if (window.SyncEngine) SyncEngine.autoSync();
      await viewSubjectDetail(code);
      showToast(`Semester planned periods for ${code} set to ${num}.`, 'success');
      return;
    }

    if (action === 'save-sync-config') {
      const syncKey  = (document.getElementById('sync-key')?.value || '').trim();
      const autoSync = !!document.getElementById('sync-auto')?.checked;
      // URL and anon key are hardcoded in SyncEngine — not read from DOM
      const enabled  = !!syncKey;
      cache.syncConfig = {
        ...cache.syncConfig,
        enabled, syncKey, autoSync,
        lastSync: cache.syncConfig?.lastSync || null,
      };
      if (window.SyncEngine) {
        await SyncEngine.saveConfig(cache.syncConfig);
        const res = await SyncEngine.syncNow();
        await loadCache();
        showToast(res.message, res.success ? 'success' : 'error');
      } else {
        await DB.setMeta('syncConfig', cache.syncConfig);
        showToast('Sync settings saved.', 'success');
      }
      viewSettings();
      return;
    }

    if (action === 'copy-sync-key') {
      const key = (document.getElementById('sync-key')?.value || cache.syncConfig?.syncKey || '').trim();
      if (!key) { showToast('Enter a Sync Key first.', 'error'); return; }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(key)
          .then(() => showToast('Sync key copied! 📋', 'success'))
          .catch(() => showToast('Copy manually: ' + key, 'info', 5000));
      } else {
        showToast('Your key: ' + key, 'success', 6000);
      }
      return;
    }

    if (action === 'sync-now') {
      if (!window.SyncEngine) {
        showToast('Sync engine is initializing. Please try again in a moment.', 'error');
        return;
      }
      const stEl = document.getElementById('sync-status-text');
      if (stEl) stEl.innerText = 'Status: Syncing...';
      const res = await SyncEngine.syncNow();
      await loadCache();
      showToast(res.message, res.success ? 'success' : 'error');
      const h = location.hash;
      if (h === '#/settings') viewSettings();
      else if (h === '#/dashboard' || h === '' || h === '#') viewDashboard();
      return;
    }

    if (action === 'go-mark-period') {
      location.hash = `#/mark/period/${btn.dataset.date}/${btn.dataset.period}/${encodeURIComponent(btn.dataset.code)}`;
      return;
    }
    if (action === 'go-mark-manual') {
      const code = document.getElementById('manual-subject').value;
      const period = document.getElementById('manual-period').value;
      if (!code) { showToast('Choose a subject first.', 'error'); return; }
      location.hash = `#/mark/period/${markHomeState.date}/${period}/${encodeURIComponent(code)}`;
      return;
    }
    if (action === 'go-calendar-day') {
      const date = document.getElementById('cal-date').value;
      location.hash = `#/calendar/${date}`;
      return;
    }

    if (action === 'set-status') {
      const studentId = btn.dataset.student, status = btn.dataset.status;
      if (markPeriodState.locked) {
        const ok = await openConfirmModal({
          title: 'Period is locked',
          message: 'This period is locked. Edit attendance anyway?',
          confirmLabel: 'Edit anyway',
        });
        if (!ok) return;
      }
      const row = markPeriodState.rows.find((r) => r.studentId === studentId);
      if (row) row.status = row.status === status ? row.status : status;
      rerenderMarkPeriod();
      return;
    }
    if (action === 'mark-all') {
      if (markPeriodState.locked) {
        const ok = await openConfirmModal({
          title: 'Period is locked',
          message: 'This period is locked. Edit attendance anyway?',
          confirmLabel: 'Edit anyway',
        });
        if (!ok) return;
      }
      markPeriodState.rows.forEach((r) => { r.status = btn.dataset.status; });
      rerenderMarkPeriod();
      return;
    }
    if (action === 'toggle-lock') {
      markPeriodState.locked = !markPeriodState.locked;
      rerenderMarkPeriod();
      return;
    }
    if (action === 'save-period') {
      const { date, period, code, locked, rows } = markPeriodState;
      for (const r of rows) {
        if (r.status === 'P' || r.status === 'A') {
          await saveAttendanceRow(r.studentId, date, period, code, r.status, locked);
        }
      }
      await loadCache();
      showToast('Attendance saved.', 'success');
      location.hash = '#/mark';
      return;
    }

    if (action === 'add-student') { location.hash = '#/students/new'; return; }
    if (action === 'edit-student') { location.hash = `#/students/${btn.dataset.id}/edit`; return; }
    if (action === 'save-student') {
      const name = document.getElementById('f-name').value.trim();
      if (!name) { showToast('Name is required.', 'error'); return; }
      const regNo = document.getElementById('f-regno').value.trim();
      const rollNo = document.getElementById('f-rollno').value.trim();
      const id = btn.dataset.id;
      const nameKey = Importer.nameKey(name);
      if (id) {
        const existing = studentById(id);
        await DB.put('students', { ...existing, name, regNo, rollNo, nameKey });
      } else {
        await DB.put('students', { id: 'stu_' + Date.now().toString(36), name, regNo, rollNo, nameKey, active: true });
      }
      await loadCache();
      location.hash = '#/students';
      return;
    }
    if (action === 'delete-student') {
      const ok = await openConfirmModal({
        title: 'Remove student',
        message: 'Remove this student? Their recorded attendance history will be kept but no longer shown against a name.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      await DB.del('students', btn.dataset.id);
      await loadCache();
      showToast('Student removed.', 'success');
      location.hash = '#/students';
      return;
    }

    if (action === 'set-threshold') {
      lowAttThreshold = parseInt(btn.dataset.value, 10);
      viewLowAttendance();
      return;
    }
    if (action === 'set-threshold-default') {
      await DB.setMeta('threshold', parseInt(btn.dataset.value, 10));
      await loadCache();
      viewSettings();
      return;
    }
    if (action === 'set-theme') {
      await DB.setMeta('theme', btn.dataset.value);
      await loadCache();
      viewSettings();
      return;
    }
    if (action === 'save-class-info') {
      const info = {
        className: document.getElementById('s-classname').value.trim(),
        department: document.getElementById('s-dept').value.trim(),
        section: document.getElementById('s-section').value.trim(),
        semester: document.getElementById('s-semester').value.trim(),
        academicYear: document.getElementById('s-year').value.trim(),
      };
      await DB.setMeta('classInfo', info);
      showToast('Class setup saved.', 'success');
      return;
    }

    if (action === 'cancel-import') { importState = null; viewImport(); return; }
    if (action === 'commit-import') {
      if (!importState) return;
      const result = await Importer.commitImport(importState.analysis, importState.planResult, {});
      await loadCache();
      if (window.SyncEngine) SyncEngine.autoSync();
      const resultBox = document.getElementById('import-result');
      if (resultBox) resultBox.innerHTML = Render.importSuccess(result);
      showToast(`Import complete — ${result.written} record(s) written.`, 'success');
      return;
    }
    if (action === 'import-done') { location.hash = '#/dashboard'; return; }

    if (action === 'export') { await exportAttendance(btn.dataset.format); return; }
    if (action === 'backup-export') { await exportBackup(); return; }
    if (action === 'backup-import-trigger') { document.getElementById('backup-file').click(); return; }

    // Image Export & Modal actions
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'modal-download') {
      if (!activeModalCanvas) { showToast('Nothing to download — please regenerate the image.', 'error'); return; }
      const ok = await ImageExport.downloadCanvas(activeModalCanvas, btn.dataset.filename);
      showToast(ok ? `Downloaded ${btn.dataset.filename}` : 'Could not download the image. Please try again.', ok ? 'success' : 'error');
      return;
    }
    if (action === 'modal-share') {
      if (!activeModalCanvas) { showToast('Nothing to share — please regenerate the image.', 'error'); return; }
      const result = await ImageExport.shareCanvas(activeModalCanvas, btn.dataset.title, btn.dataset.filename);
      if (result === 'cancelled') return; // user dismissed the native share sheet — no message needed
      showToast(result ? 'Shared successfully.' : 'Sharing is not available on this device/browser.', result ? 'success' : 'error');
      return;
    }

    if (action === 'export-student-card') {
      const sId = btn.dataset.id;
      const student = studentById(sId);
      if (!student) return;
      const stats = Calc.buildStats(cache.attendance);
      const stOverall = Calc.studentOverall(stats, student.id, cache.threshold, cache.allocatedPeriods);
      const subjectNames = Object.fromEntries(cache.subjects.map((s) => [s.code, s.name]));
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const canvas = ImageExport.generateStudentCard(student, stOverall, subjectNames, cache.classInfo, isDark, cache.threshold);
      showImageModal(canvas, `${student.name} — Report Card`, `Attendance_${student.name.replace(/\s+/g, '_')}.png`);
      return;
    }

    if (action === 'export-subject-card') {
      const code = btn.dataset.code;
      const subject = subjectByCode(code) || { code, name: code };
      const stats = Calc.buildStats(cache.attendance);
      const summary = Calc.subjectSummary(stats, code, cache.threshold, cache.allocatedPeriods);
      const students = summary.students.map((r) => ({ ...r, name: (studentById(r.studentId) || {}).name || '—' }));
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const canvas = ImageExport.generateSubjectCard(subject, { ...summary, students }, cache.classInfo, isDark, cache.threshold);
      showImageModal(canvas, `${subject.code} — Subject Stats`, `Subject_${subject.code}_Attendance.png`);
      return;
    }

    if (action === 'export-defaulters-notice-img') {
      const stats = Calc.buildStats(cache.attendance);
      const rows = Calc.lowAttendance(stats, cache.threshold).map((r) => {
        const st = studentById(r.studentId) || {};
        return { ...r, name: st.name || '—', rollNo: st.rollNo || '' };
      });
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const canvas = ImageExport.generateDefaultersNotice(rows, cache.threshold, cache.classInfo, isDark, cache.threshold);
      showImageModal(canvas, `Attendance Shortage Notice (<${cache.threshold}%)`, `Defaulters_Notice_${cache.threshold}pct.png`);
      return;
    }

    if (action === 'export-class-summary-img') {
      const stats = Calc.buildStats(cache.attendance);
      const overall = Calc.classOverall(stats);
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const subject = { code: 'OVERVIEW', name: `${cache.classInfo.className || 'Class'} Attendance Summary` };
      const allStudents = cache.students.filter(s => s.active !== false).map(s => {
        const so = Calc.studentOverall(stats, s.id, cache.threshold, cache.allocatedPeriods);
        return { studentId: s.id, name: s.name, total: so.total, present: so.present, absent: so.absent, pct: so.pct };
      }).sort((a,b) => (b.pct ?? -1) - (a.pct ?? -1));
      const summary = {
        conducted: new Set(cache.attendance.map(a => `${a.date}|${a.period}`)).size,
        pct: overall.pct,
        above: allStudents.filter(s => s.pct !== null && s.pct >= cache.threshold).length,
        below: allStudents.filter(s => s.pct !== null && s.pct < cache.threshold).length,
        students: allStudents,
      };
      const canvas = ImageExport.generateSubjectCard(subject, summary, cache.classInfo, isDark, cache.threshold);
      showImageModal(canvas, 'Class Attendance Performance', 'Class_Attendance_Overview.png');
      return;
    }

    if (action === 'export-quick-student-card') {
      const sel = document.getElementById('quick-student-export');
      const sId = sel ? sel.value : null;
      if (!sId) { showToast('Please select a student from the dropdown first.', 'error'); return; }
      const student = studentById(sId);
      if (!student) return;
      const stats = Calc.buildStats(cache.attendance);
      const stOverall = Calc.studentOverall(stats, student.id, cache.threshold, cache.allocatedPeriods);
      const subjectNames = Object.fromEntries(cache.subjects.map((s) => [s.code, s.name]));
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const canvas = ImageExport.generateStudentCard(student, stOverall, subjectNames, cache.classInfo, isDark, cache.threshold);
      showImageModal(canvas, `${student.name} — Report Card`, `Attendance_${student.name.replace(/\s+/g, '_')}.png`);
      return;
    }

    if (action === 'filter-subject-students') {
      const filter = btn.dataset.filter;
      const code = btn.dataset.code;
      await viewSubjectDetail(code, filter);
      return;
    }
  }

  async function handleChange(e) {
    if (e.target.id === 'mark-date') {
      markHomeState.date = e.target.value;
      viewMarkHome();
      return;
    }
    if (e.target.id === 'cal-date') { calendarState.date = e.target.value; return; }
    if (e.target.id === 'import-file') {
      const file = e.target.files[0];
      if (!file) return;
      const resultBox = document.getElementById('import-result');
      resultBox.innerHTML = '<div class="card"><div class="empty small">Reading workbook…</div></div>';
      try {
        const wb = await Importer.readWorkbookFromFile(file);
        const analysis = Importer.analyze(wb);
        const planResult = await Importer.buildImportPlan(analysis);
        importState = { analysis, planResult };
        resultBox.innerHTML = Render.importPreview(planResult);
      } catch (err) {
        resultBox.innerHTML = `<div class="card"><div class="small" style="color:var(--absent)">Could not read this file: ${Render.esc(err.message)}</div></div>`;
      }
      return;
    }
    if (e.target.id === 'backup-file') {
      const file = e.target.files[0];
      if (!file) return;
      const ok = await openConfirmModal({
        title: 'Restore backup',
        message: 'Restoring a backup replaces all current data on this device. Continue?',
        confirmLabel: 'Restore',
        danger: true,
      });
      if (!ok) { e.target.value = ''; return; }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        for (const store of ['students', 'subjects', 'timetable', 'attendance']) {
          await DB.clearStore(store);
          if (data[store]) await DB.putMany(store, data[store]);
        }
        if (data.meta) for (const [k, v] of Object.entries(data.meta)) await DB.setMeta(k, v);
        await loadCache();
        showToast('Backup restored.', 'success');
        location.hash = '#/dashboard';
      } catch (err) {
        showToast('Could not restore this backup file: ' + err.message, 'error');
      }
      return;
    }
  }

  function handleInput(e) {
    if (e.target.id === 'student-search') {
      studentsState.query = e.target.value;
      rerenderStudentsListOnly();
    }
  }

  // ---- Export helpers -------------------------------------------------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportAttendance(format) {
    const rows = cache.attendance
      .filter((a) => a.status === 'P' || a.status === 'A')
      .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period)
      .map((a) => ({
        Date: a.date,
        Period: a.period,
        Subject: a.subjectCode,
        RegisterNo: (studentById(a.studentId) || {}).regNo || '',
        RollNo: (studentById(a.studentId) || {}).rollNo || '',
        Name: (studentById(a.studentId) || {}).name || '',
        Status: a.status === 'P' ? 'Present' : 'Absent',
      }));
    if (format === 'csv') {
      const header = Object.keys(rows[0] || { Date: '', Period: '', Subject: '', RegisterNo: '', RollNo: '', Name: '', Status: '' });
      const csv = [header.join(',')].concat(rows.map((r) => header.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))).join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv' }), 'attendance_export.csv');
    } else {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      downloadBlob(new Blob([wbout], { type: 'application/octet-stream' }), 'attendance_export.xlsx');
    }
  }

  async function exportBackup() {
    const data = {
      students: await DB.getAll('students'),
      subjects: await DB.getAll('subjects'),
      timetable: await DB.getAll('timetable'),
      attendance: await DB.getAll('attendance'),
      meta: {
        threshold: cache.threshold,
        theme: cache.theme,
        classInfo: cache.classInfo,
        lastImport: cache.lastImport,
        allocatedPeriods: cache.allocatedPeriods,
        syncConfig: cache.syncConfig,
      },
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `attendance_backup_${todayIso()}.json`);
  }

  // ------------------------------------------------------------------
  document.addEventListener('click', (e) => handleClick(e));
  document.addEventListener('change', (e) => handleChange(e));
  document.addEventListener('input', (e) => handleInput(e));
  window.addEventListener('hashchange', dispatch);
  window.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) location.hash = '#/dashboard';
    dispatch();
  });
})();
