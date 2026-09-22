/* ---------------------------------------------------------------------
 * Pure view-template functions. Each takes plain data and returns an
 * HTML string. All interactivity happens via data-action attributes
 * handled by the delegated click/change listeners in app.js.
 * ------------------------------------------------------------------- */
const Render = (() => {

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function initials(name) {
    const parts = esc(name).trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateShort(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function dayNameOf(iso) {
    const d = new Date(iso + 'T00:00:00');
    return DAY_NAMES[d.getDay()];
  }
  function pctStr(p) { return p === null || p === undefined ? '—' : p.toFixed(1) + '%'; }
  // Color tiers are relative to the configured attendance target, not a
  // hardcoded 75/65 — e.g. if target is 80%, "warn" starts at 70%, not 65%.
  function pctClass(p, target = 75) {
    if (p === null || p === undefined) return '';
    if (p >= target) return '';
    if (p >= target - 10) return 'warn';
    return 'bad';
  }
  function pctColor(p, target = 75) {
    const cls = pctClass(p, target);
    return cls === 'bad' ? 'var(--absent)' : cls === 'warn' ? 'var(--warn)' : 'var(--present)';
  }
  function barRow(label, p, target = 75) {
    const cls = pctClass(p, target);
    return `<div class="row between small" style="margin-bottom:6px">
      <span>${esc(label)}</span><span class="muted">${pctStr(p)}</span>
    </div>
    <div class="bar-track" style="margin-bottom:12px">
      <div class="bar-fill ${cls}" style="width:${p===null?0:Math.min(100,p)}%"></div>
    </div>`;
  }
  // ONE unambiguous can-miss indicator per subject. Quota-aware when a
  // semester quota is configured; otherwise says so plainly and fabricates
  // nothing. Never shown alongside the quota-free `margin()` figure.
  function subjectMarginChip(v) {
    if (!v || !v.allocated) {
      return `<span class="chip-margin neutral">Semester quota not set</span>`;
    }
    const sm = v.semesterMargin;
    if (!sm) return `<span class="chip-margin neutral">Semester quota not set</span>`;
    const cls = sm.possible === false ? 'need' : 'safe';
    return `<span class="chip-margin ${cls}">${esc(sm.text)}</span>`;
  }

  function topbar(title, opts = {}) {
    return `<div class="topbar">
      ${opts.back ? `<button class="icon-btn" data-action="back">←</button>` : ''}
      <h1>${esc(title)}</h1>
      ${opts.right || ''}
    </div>`;
  }

  function navIcon(name) {
    const icons = {
      dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
      students: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="8" r="2.6"/><path d="M15.5 14c2.7.3 4.7 2.6 4.7 6"/></svg>',
      mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
      subjects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
      more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    };
    return icons[name] || '';
  }

  function bottomNav(active) {
    const items = [
      ['dashboard', '#/dashboard', 'Home'],
      ['students', '#/students', 'Students'],
      ['mark', '#/mark', 'Mark'],
      ['subjects', '#/subjects', 'Subjects'],
      ['more', '#/more', 'More'],
    ];
    return items.map(([key, href, label]) =>
      `<a href="${href}" class="${active === key ? 'active' : ''}">${navIcon(key)}<span>${label}</span></a>`
    ).join('');
  }

  // ---------------- Dashboard ----------------
  function dashboard(d) {
    return `
    ${topbar('Dashboard')}
    <div class="content">
      <div class="card glow">
        <div class="stat-label">Overall class attendance</div>
        <div class="stat-num">${pctStr(d.overallPct)}</div>
      </div>
      <div class="grid-3">
        <div class="card"><div class="stat-num">${d.totalStudents}</div><div class="stat-label">Students</div></div>
        <div class="card"><div class="stat-num" style="color:var(--present)">${d.presentToday}</div><div class="stat-label">Present today</div></div>
        <div class="card"><div class="stat-num" style="color:var(--absent)">${d.absentToday}</div><div class="stat-label">Absent today</div></div>
      </div>

      <div class="section-title">Today &middot; ${esc(d.todayDayName)}</div>
      <div class="card">
        ${d.todayClasses.length === 0 ? `<div class="empty small">No classes scheduled today.</div>` :
          d.todayClasses.map(c => `
          <div class="list-item">
            <div class="avatar">P${c.period}</div>
            <div style="flex:1">
              <div class="name">${esc(c.subjectName)}</div>
              <div class="sub">${esc(c.time || '')}</div>
            </div>
            ${c.done
              ? `<span class="badge present">Done · ${c.present}/${c.present + c.absent}</span>`
              : `<button class="btn sm primary" data-action="go-mark-period" data-date="${d.todayIso}" data-period="${c.period}" data-code="${esc(c.code)}">Mark</button>`}
          </div>`).join('')}
      </div>

      <div class="section-title">Attention needed</div>
      <div class="card">
        ${d.lowCount === 0 ? `<div class="empty small">No students below ${d.threshold}% right now.</div>` :
          `<div class="row between"><span>${d.lowCount} student(s) below ${d.threshold}%</span>
           <a href="#/low-attendance" class="btn sm">View</a></div>`}
      </div>

      <div class="section-title">Latest import</div>
      <div class="card">
        ${d.lastImport
          ? `<div class="small">Imported ${esc(fmtDate(d.lastImport.at.slice(0,10)))} — ${d.lastImport.inserted} new, ${d.lastImport.updated} updated${d.lastImport.conflictsRemaining ? `, <span style="color:var(--warn)">${d.lastImport.conflictsRemaining} unresolved conflicts</span>` : ''}.</div>`
          : `<div class="empty small">No Excel import yet.</div>`}
        <div style="margin-top:10px"><a href="#/import" class="btn sm block">Import / Re-sync Excel</a></div>
      </div>
    </div>`;
  }

  // ---------------- Students ----------------
  function studentsList(d) {
    const sortLabels = { name: 'Name', roll: 'Roll No', low: 'Lowest %', high: 'Highest %' };
    const sortLabel = sortLabels[d.sort] || 'Name';
    return `
    ${topbar('Students', { right: `<button class="icon-btn" data-action="open-sort" title="Tap to toggle sort">Sort: ${sortLabel}</button>` })}
    <div class="content">
      <input id="student-search" placeholder="Search name, roll or register no." value="${esc(d.query||'')}" />
      <div class="tabbar" style="margin-top:10px;margin-bottom:6px">
        <span class="chip ${(!d.sort||d.sort==='name')?'active':''}" data-action="set-student-sort" data-sort="name">Name</span>
        <span class="chip ${d.sort==='roll'?'active':''}" data-action="set-student-sort" data-sort="roll">Roll No</span>
        <span class="chip ${d.sort==='low'?'active':''}" data-action="set-student-sort" data-sort="low">Lowest %</span>
        <span class="chip ${d.sort==='high'?'active':''}" data-action="set-student-sort" data-sort="high">Highest %</span>
      </div>
      <div style="margin-top:8px" class="card">
        ${d.students.length === 0 ? `<div class="empty">No students found.</div>` :
        d.students.map(s => `
        <a href="#/students/${s.id}" class="list-item" style="text-decoration:none;color:inherit">
          <div class="avatar">${initials(s.name)}</div>
          <div style="flex:1">
            <div class="name">${esc(s.name)}</div>
            <div class="sub">Roll ${esc(s.rollNo||'—')}${s.regNo ? ' · ' + esc(s.regNo) : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="name" style="color:${s.pct===null?'var(--text-dim)':pctColor(s.pct, d.threshold)}">${pctStr(s.pct)}</div>
          </div>
        </a>`).join('')}
      </div>
    </div>
    <button class="fab" data-action="add-student">+</button>`;
  }

  function marginBadge(m) {
    if (!m || m.type === 'none') return `<span class="chip-margin neutral">—</span>`;
    if (m.type === 'safe') {
      return `<span class="chip-margin safe" title="Can miss classes safely">${m.count > 0 ? `+${m.count} can miss` : 'On edge (0)'}</span>`;
    }
    return `<span class="chip-margin need" title="Classes needed to reach target">-${m.count} need to attend</span>`;
  }

  function studentDetail(d) {
    const s = d.student;
    const subEntries = Object.entries(d.stats.subjects || {}).sort((a,b)=>a[0].localeCompare(b[0]));
    return `
    ${topbar(s.name, { back: true, right: `<button class="icon-btn" data-action="edit-student" data-id="${s.id}">Edit</button>` })}
    <div class="content">
      <div class="card glow">
        <div class="row between">
          <div>
            <div class="stat-label">Overall attendance</div>
            <div class="stat-num">${pctStr(d.stats.pct)}</div>
          </div>
          <div style="text-align:right">
            ${marginBadge(d.stats.margin)}
            <div class="sub" style="margin-top:4px">Target: ${d.threshold || 75}%</div>
          </div>
        </div>
        <div class="grid-3" style="margin-top:14px">
          <div><div class="stat-num" style="font-size:20px">${d.stats.total}</div><div class="stat-label">Total Periods</div></div>
          <div><div class="stat-num" style="font-size:20px;color:var(--present)">${d.stats.present}</div><div class="stat-label">Present</div></div>
          <div><div class="stat-num" style="font-size:20px;color:var(--absent)">${d.stats.absent}</div><div class="stat-label">Absent</div></div>
        </div>
        <div class="row between" style="margin-top:10px">
          <span class="small muted">Roll ${esc(s.rollNo||'—')} ${s.regNo ? '· Reg. ' + esc(s.regNo) : ''}</span>
        </div>
        <button class="btn primary block" style="margin-top:12px" data-action="export-student-card" data-id="${s.id}">Export Report Card as Image</button>
      </div>

      <div class="section-title">Subject Breakdown &amp; Margins</div>
      <div>
        ${subEntries.length === 0 ? `<div class="card"><div class="empty small">No attendance recorded yet.</div></div>` :
          subEntries.map(([code, v]) => {
            const subName = d.subjectNames[code] || code;
            const cls = pctClass(v.pct, d.threshold);
            return `
            <div class="sub-card">
              <div class="sub-card-header">
                <div>
                  <div class="name">${esc(subName)}</div>
                  <div class="sub">${esc(code)}</div>
                </div>
                <div style="text-align:right">
                  <div class="name" style="color:${v.pct===null?'var(--text-dim)':pctColor(v.pct, d.threshold)}">${pctStr(v.pct)}</div>
                  ${subjectMarginChip(v)}
                </div>
              </div>
              <div class="bar-track" style="margin-bottom:8px">
                <div class="bar-fill ${cls}" style="width:${v.pct===null?0:Math.min(100,v.pct)}%"></div>
              </div>
              <div class="sub-metrics">
                <span>Conducted: <b>${v.conducted ?? v.total}</b></span>
                <span style="color:var(--present)">Present: <b>${v.present}</b></span>
                <span style="color:var(--absent)">Absent: <b>${v.absent}</b></span>
              </div>
              ${v.allocated ? `
              <div style="margin-top:8px;padding:6px 10px;border-radius:8px;background:rgba(103,232,249,0.08);border:1px solid rgba(103,232,249,0.15)">
                <span style="color:var(--accent2);font-size:11.5px">Semester Planned Periods: <b>${v.allocated}</b> &middot; Remaining: <b>${Math.max(0, v.allocated - v.conducted)}</b></span>
              </div>` : `
              <div style="margin-top:8px;font-size:11.5px" class="muted">Semester quota not set for this subject.</div>`}
            </div>`;
          }).join('')}
      </div>

      <div class="section-title">Recent days</div>
      <div class="card">
        ${d.recentDays.length === 0 ? `<div class="empty small">No records yet.</div>` :
          d.recentDays.map(day => `
          <a href="#/calendar/${day.date}" class="list-item" style="text-decoration:none;color:inherit">
            <div style="flex:1">
              <div class="name">${esc(fmtDate(day.date))}</div>
              <div class="sub">${day.present}P / ${day.absent}A</div>
            </div>
          </a>`).join('')}
      </div>
    </div>`;
  }

  function studentForm(d) {
    const s = d.student || {};
    return `
    ${topbar(d.student ? 'Edit student' : 'Add student', { back: true })}
    <div class="content">
      <label>Full name</label>
      <input id="f-name" value="${esc(s.name||'')}" placeholder="Student name" />
      <label>Register number</label>
      <input id="f-regno" value="${esc(s.regNo||'')}" placeholder="e.g. 23EDXXX" />
      <label>Roll number</label>
      <input id="f-rollno" value="${esc(s.rollNo||'')}" placeholder="e.g. 1" />
      <div class="btn-row" style="margin-top:20px">
        <button class="btn primary block" data-action="save-student" data-id="${s.id||''}">Save</button>
      </div>
      ${d.student ? `<button class="btn danger block" style="margin-top:10px" data-action="delete-student" data-id="${s.id}">Remove student</button>` : ''}
    </div>`;
  }

  // ---------------- Mark attendance ----------------
  function markHome(d) {
    return `
    ${topbar('Mark Attendance')}
    <div class="content">
      <label style="margin-top:0">Date</label>
      <input type="date" id="mark-date" value="${d.date}" max="${d.today}" />

      <div class="section-title">${esc(d.dayName)}'s classes</div>
      <div class="card">
        ${d.classes.length === 0 ? `<div class="empty">No classes scheduled this day. You can still mark a subject/period manually.</div>` :
          d.classes.map(c => `
          <div class="list-item">
            <div class="avatar">P${c.period}</div>
            <div style="flex:1">
              <div class="name">${esc(c.subjectName)}</div>
              <div class="sub">${esc(c.time||'')}${c.marked ? ` · ${c.present}P/${c.absent}A` : ''}</div>
            </div>
            <button class="btn sm ${c.marked ? '' : 'primary'}" data-action="go-mark-period" data-date="${d.date}" data-period="${c.period}" data-code="${esc(c.code)}">
              ${c.marked ? 'Edit' : 'Mark'}
            </button>
          </div>`).join('')}
      </div>

      <div class="section-title">Or pick manually</div>
      <div class="card">
        <label style="margin-top:0">Subject</label>
        <select id="manual-subject">
          <option value="">Select subject</option>
          ${d.subjects.map(s => `<option value="${esc(s.code)}">${esc(s.code)} — ${esc(s.name)}</option>`).join('')}
        </select>
        <label>Period</label>
        <select id="manual-period">
          ${Array.from({length:8},(_,i)=>i+1).map(p=>`<option value="${p}">Period ${p}</option>`).join('')}
        </select>
        <button class="btn primary block" style="margin-top:14px" data-action="go-mark-manual">Open student list</button>
      </div>
    </div>`;
  }

  function markPeriod(d) {
    return `
    ${topbar(`${d.subjectName} · P${d.period}`, { back: true })}
    <div class="content">
      <div class="row between" style="margin-bottom:10px">
        <span class="muted small">${esc(fmtDate(d.date))}</span>
        ${d.locked ? `<span class="badge muted">Locked</span>` : ''}
      </div>
      <div class="btn-row" style="margin-bottom:14px">
        <button class="btn block" data-action="mark-all" data-status="P">Mark all present</button>
        <button class="btn block" data-action="mark-all" data-status="A">Mark all absent</button>
      </div>
      <div class="card">
        ${d.rows.map(r => `
        <div class="mark-row">
          <div class="row"><div class="avatar" style="width:30px;height:30px;font-size:11px">${initials(r.name)}</div>
            <span class="name" style="font-size:14px">${esc(r.name)}</span></div>
          <div class="toggle-pa" data-student="${r.studentId}">
            <button class="${r.status==='P'?'on p':''}" data-action="set-status" data-student="${r.studentId}" data-status="P">P</button>
            <button class="${r.status==='A'?'on a':''}" data-action="set-status" data-student="${r.studentId}" data-status="A">A</button>
          </div>
        </div>`).join('')}
      </div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn primary block" data-action="save-period">Save attendance</button>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ${d.locked?'':'danger'} block" data-action="toggle-lock">${d.locked ? 'Unlock period' : 'Lock period'}</button>
      </div>
    </div>`;
  }

  // ---------------- Subjects ----------------
  function subjectsList(d) {
    return `
    ${topbar('Subjects')}
    <div class="content">
      <div class="card">
        ${d.subjects.length === 0 ? `<div class="empty">No subjects yet — import an Excel file first.</div>` :
        d.subjects.map(s => `
        <a href="#/subjects/${encodeURIComponent(s.code)}" class="list-item" style="text-decoration:none;color:inherit">
          <div style="flex:1">
            <div class="name">${esc(s.code)}</div>
            <div class="sub">${esc(s.name)}</div>
          </div>
          <div class="name" style="color:${s.pct===null?'var(--text-dim)':pctColor(s.pct, d.threshold)}">${pctStr(s.pct)}</div>
        </a>`).join('')}
      </div>
    </div>`;
  }

  function subjectDetail(d) {
    const filter = d.filter || 'all';
    let displayedStudents = d.students;
    if (filter === 'below') displayedStudents = d.students.filter(s => s.pct !== null && s.pct < (d.threshold || 75));
    else if (filter === 'above') displayedStudents = d.students.filter(s => s.pct !== null && s.pct >= (d.threshold || 75));

    return `
    ${topbar(d.code, { back: true })}
    <div class="content">
      <div class="card glow">
        <div class="stat-label">${esc(d.name)}</div>
        <div class="stat-num">${pctStr(d.pct)}</div>
        <div class="small muted">Class average attendance</div>
        <div class="grid-3" style="margin-top:14px">
          <div><div class="stat-num" style="font-size:20px;color:var(--accent)">${d.conducted || 0}</div><div class="stat-label">Conducted Periods</div></div>
          <div><div class="stat-num" style="font-size:20px;color:var(--present)">${d.above}</div><div class="stat-label">Above ${d.threshold||75}%</div></div>
          <div><div class="stat-num" style="font-size:20px;color:var(--absent)">${d.below}</div><div class="stat-label">Below ${d.threshold||75}%</div></div>
        </div>
        <div class="row between" style="margin-top:10px">
          <span class="small muted">Semester Planned Periods: <b>${d.allocatedPeriods ? d.allocatedPeriods : 'Not set'}</b>${d.allocatedPeriods ? ` &middot; Remaining: <b>${Math.max(0, d.allocatedPeriods - (d.conducted||0))}</b>` : ''}</span>
          <button class="btn sm" data-action="set-allocated-periods" data-code="${esc(d.code)}" title="Set total semester planned periods for this subject">
            ${d.allocatedPeriods ? `Edit (${d.allocatedPeriods})` : 'Set Semester Planned Periods'}
          </button>
        </div>
        <button class="btn primary block" style="margin-top:12px" data-action="export-subject-card" data-code="${esc(d.code)}">Export Subject Stats as Image</button>
      </div>

      <div class="section-title">Filter Students</div>
      <div class="tabbar" style="margin-bottom:10px">
        <span class="chip ${filter==='all'?'active':''}" data-action="filter-subject-students" data-filter="all" data-code="${esc(d.code)}">All (${d.students.length})</span>
        <span class="chip ${filter==='below'?'active':''}" data-action="filter-subject-students" data-filter="below" data-code="${esc(d.code)}">Below ${d.threshold||75}% (${d.below})</span>
        <span class="chip ${filter==='above'?'active':''}" data-action="filter-subject-students" data-filter="above" data-code="${esc(d.code)}">Above ${d.threshold||75}% (${d.above})</span>
      </div>

      <div class="section-title">Student Breakdown (${displayedStudents.length})</div>
      <div class="card">
        ${displayedStudents.length === 0 ? `<div class="empty small">No students in this view.</div>` :
          displayedStudents.map(s => `
          <a href="#/students/${s.studentId}" class="list-item" style="text-decoration:none;color:inherit">
            <div class="avatar">${initials(s.name)}</div>
            <div style="flex:1">
              <div class="name">${esc(s.name)}</div>
              <div class="sub">Conducted: ${s.total} &middot; <span style="color:var(--present)">${s.present}P</span> / <span style="color:var(--absent)">${s.absent}A</span></div>
            </div>
            <div style="text-align:right">
              <div class="name" style="color:${s.pct===null?'var(--text-dim)':pctColor(s.pct, d.threshold)}">${pctStr(s.pct)}</div>
              ${subjectMarginChip({ allocated: d.allocatedPeriods, semesterMargin: s.semesterMargin })}
            </div>
          </a>`).join('')}
      </div>
    </div>`;
  }

  // ---------------- Low attendance ----------------
  function lowAttendance(d) {
    return `
    ${topbar('Low Attendance', { back: true })}
    <div class="content">
      <div class="tabbar">
        ${[65,75,80,85,90].map(t => `<span class="chip ${t===d.threshold?'active':''}" data-action="set-threshold" data-value="${t}">${t}%</span>`).join('')}
      </div>
      <div class="card">
        <div class="row between" style="margin-bottom:10px">
          <span class="small muted">Total Defaulters: <b>${d.rows.length}</b></span>
          <button class="btn sm primary" data-action="export-defaulters-notice-img">Export Notice Image</button>
        </div>
        ${d.rows.length === 0 ? `<div class="empty">No students below ${d.threshold}%.</div>` :
        d.rows.map(r => `
        <a href="#/students/${r.studentId}" class="list-item" style="text-decoration:none;color:inherit">
          <div class="avatar">${initials(r.name)}</div>
          <div style="flex:1">
            <div class="name">${esc(r.name)}</div>
            <div class="sub">Total: ${r.total} &middot; ${r.present}P / <span style="color:var(--absent)">${r.absent}A</span></div>
          </div>
          <div style="text-align:right">
            <div class="name" style="color:${pctColor(r.pct, d.threshold)}">${pctStr(r.pct)}</div>
            ${marginBadge(r.margin)}
          </div>
        </a>`).join('')}
      </div>
    </div>`;
  }

  // ---------------- Calendar ----------------
  function calendarHome(d) {
    return `
    ${topbar('Calendar', { back: true })}
    <div class="content">
      <input type="date" id="cal-date" value="${d.date}" />
      <div style="margin-top:12px"><button class="btn primary block" data-action="go-calendar-day" data-date="${d.date}">View day</button></div>
      <div class="section-title">Recent</div>
      <div class="card">
        ${d.recentDates.length === 0 ? `<div class="empty small">No attendance recorded yet.</div>` :
          d.recentDates.map(dt => `
          <a href="#/calendar/${dt}" class="list-item" style="text-decoration:none;color:inherit">
            <div class="name">${esc(fmtDate(dt))}</div>
          </a>`).join('')}
      </div>
    </div>`;
  }

  function calendarDay(d) {
    return `
    ${topbar(fmtDate(d.date), { back: true })}
    <div class="content">
      ${d.periods.length === 0 ? `<div class="empty">No attendance recorded for this date.</div>` :
      d.periods.map(p => `
      <a href="#/mark/period/${d.date}/${p.period}/${encodeURIComponent(p.subjectCode)}" class="card" style="display:block;text-decoration:none;color:inherit">
        <div class="row between">
          <div><div class="name">P${p.period} — ${esc(p.subjectCode)}</div></div>
          <div class="row" style="gap:6px">
            <span class="badge present">${p.present} P</span>
            <span class="badge absent">${p.absent} A</span>
          </div>
        </div>
      </a>`).join('')}
    </div>`;
  }

  // ---------------- Reports ----------------
  function reports(d) {
    return `
    ${topbar('Reports', { back: true })}
    <div class="content">
      <div class="card glow">
        <div class="stat-label">Class average attendance</div>
        <div class="stat-num">${pctStr(d.classPct)}</div>
      </div>

      <!-- Image Export Hub -->
      <div class="section-title">Export Stats as Image (WhatsApp / Print)</div>
      <div class="card">
        <p class="small muted" style="margin-top:0">Export formatted, high-resolution PNG image cards ready to share on WhatsApp groups or download:</p>
        <div class="btn-row" style="margin-bottom:10px">
          <button class="btn primary block" data-action="export-class-summary-img">Export Class Summary Image</button>
          <button class="btn danger block" data-action="export-defaulters-notice-img">Export Defaulters Notice Image</button>
        </div>
        <label>Or export individual student report card:</label>
        <div class="row" style="gap:8px">
          <select id="quick-student-export" style="flex:1">
            <option value="">Select a student...</option>
            ${(d.studentsList || []).map(s => `<option value="${s.id}">${esc(s.name)} (${s.rollNo || '—'})</option>`).join('')}
          </select>
          <button class="btn" data-action="export-quick-student-card">Generate Image</button>
        </div>
      </div>

      <!-- Detailed Subject-wise Stats Table -->
      <div class="section-title">Subject Attendance Statistics</div>
      <div class="card">
        <div class="stats-table-wrap">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Conducted</th>
                <th>Avg %</th>
                <th>Present</th>
                <th>Absent</th>
                <th>&lt;${d.threshold||75}%</th>
              </tr>
            </thead>
            <tbody>
              ${d.subjects.map(s => `
              <tr>
                <td>
                  <a href="#/subjects/${encodeURIComponent(s.code)}" style="text-decoration:none">
                    <b>${esc(s.code)}</b>
                    <div class="sub" style="font-size:11px">${esc(s.name || '')}</div>
                  </a>
                </td>
                <td><b>${s.conducted || 0}</b></td>
                <td><span style="color:${pctColor(s.pct, d.threshold)}"><b>${pctStr(s.pct)}</b></span></td>
                <td style="color:var(--present)">${s.present || 0}</td>
                <td style="color:${s.absent > 0 ? 'var(--absent)' : 'inherit'}">${s.absent || 0}</td>
                <td><span class="badge ${s.below > 0 ? 'absent' : 'muted'}">${s.below || 0}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section-title">This month</div>
      <div class="card">
        <div class="grid-3">
          <div><div class="stat-num" style="font-size:20px">${d.month.workingPeriods}</div><div class="stat-label">Working periods</div></div>
          <div><div class="stat-num" style="font-size:20px;color:var(--present)">${d.month.present}</div><div class="stat-label">Present records</div></div>
          <div><div class="stat-num" style="font-size:20px;color:var(--absent)">${d.month.absent}</div><div class="stat-label">Absent records</div></div>
        </div>
      </div>

      <div class="section-title">File Export (Spreadsheets)</div>
      <div class="card btn-row">
        <button class="btn block" data-action="export" data-format="csv">Export CSV</button>
        <button class="btn block" data-action="export" data-format="xlsx">Export Excel</button>
      </div>
    </div>`;
  }

  // ---------------- Image Preview Modal ----------------
  function imagePreviewModal(d) {
    return `
    <div class="modal-backdrop" id="app-modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <h3>${esc(d.title || 'Export Preview')}</h3>
          <button class="icon-btn" data-action="close-modal" style="border:none;background:transparent;font-size:18px">✕</button>
        </div>
        <div class="modal-body">
          <img src="${d.imageUrl}" class="modal-img-preview" alt="Preview" />
        </div>
        <div class="modal-footer">
          <button class="btn primary block" data-action="modal-download" data-filename="${esc(d.filename)}">Download PNG</button>
          <button class="btn block" data-action="modal-share" data-title="${esc(d.title)}" data-filename="${esc(d.filename)}">Share</button>
        </div>
      </div>
    </div>`;
  }

  // ---------------- Confirm / Prompt modals (replace native confirm()/prompt()) ----------------
  function confirmModal(d) {
    return `
    <div class="modal-backdrop" id="app-modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <h3>${esc(d.title)}</h3>
          <button class="icon-btn" data-action="confirm-modal-no" style="border:none;background:transparent;font-size:18px">✕</button>
        </div>
        <div class="modal-body form-body">
          <p class="small" style="margin:0">${esc(d.message)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn block" data-action="confirm-modal-no">Cancel</button>
          <button class="btn ${d.danger ? 'danger' : 'primary'} block" data-action="confirm-modal-yes">${esc(d.confirmLabel || 'Confirm')}</button>
        </div>
      </div>
    </div>`;
  }

  function promptModal(d) {
    return `
    <div class="modal-backdrop" id="app-modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <h3>${esc(d.title)}</h3>
          <button class="icon-btn" data-action="prompt-modal-cancel" style="border:none;background:transparent;font-size:18px">✕</button>
        </div>
        <div class="modal-body form-body">
          ${d.label ? `<label style="margin-top:0">${esc(d.label)}</label>` : ''}
          <input id="prompt-modal-input" type="number" inputmode="numeric" min="1" value="${esc(d.value)}" placeholder="${esc(d.placeholder || '')}" />
        </div>
        <div class="modal-footer">
          <button class="btn block" data-action="prompt-modal-cancel">Cancel</button>
          <button class="btn primary block" data-action="prompt-modal-ok">Save</button>
        </div>
      </div>
    </div>`;
  }

  function importSuccess(r) {
    return `
    <div class="card">
      <div class="row" style="gap:8px;margin-bottom:8px">
        <span class="badge present">✓ Import complete</span>
      </div>
      <div class="row between small" style="margin-bottom:4px"><span>Records written</span><b style="color:var(--present)">${r.written}</b></div>
      ${r.conflictsRemaining ? `<div class="row between small" style="margin-bottom:4px"><span>Unresolved conflicts (manual edits kept)</span><b style="color:var(--warn)">${r.conflictsRemaining}</b></div>` : ''}
      <button class="btn primary block" style="margin-top:12px" data-action="import-done">Done</button>
    </div>`;
  }

  // ---------------- More / Import / Settings ----------------
  function more() {
    return `
    ${topbar('More')}
    <div class="content">
      <div class="card">
        <a href="#/calendar" class="list-item" style="text-decoration:none;color:inherit"><div class="name">Calendar</div></a>
        <a href="#/reports" class="list-item" style="text-decoration:none;color:inherit"><div class="name">Reports</div></a>
        <a href="#/low-attendance" class="list-item" style="text-decoration:none;color:inherit"><div class="name">Low attendance</div></a>
        <a href="#/import" class="list-item" style="text-decoration:none;color:inherit"><div class="name">Import / Re-sync Excel</div></a>
        <a href="#/backup" class="list-item" style="text-decoration:none;color:inherit"><div class="name">Backup &amp; restore</div></a>
        <a href="#/settings" class="list-item" style="text-decoration:none;color:inherit"><div class="name">Settings</div></a>
      </div>
    </div>`;
  }

  function importHome(d) {
    return `
    ${topbar('Import Excel', { back: true })}
    <div class="content">
      <div class="card">
        <p class="small muted">Select the attendance workbook (.xlsx). The importer reads sheet structure automatically — it does not rely on fixed row numbers, so it keeps working as your workbook grows.</p>
        <input type="file" id="import-file" accept=".xlsx,.xls" />
      </div>
      <div id="import-result"></div>
    </div>`;
  }

  function importPreview(r) {
    return `
    <div class="card">
      <div class="section-title" style="margin-top:0">Preview</div>
      <div class="row between small" style="margin-bottom:4px"><span>Students detected</span><b>${r.studentsDetected}</b></div>
      <div class="row between small" style="margin-bottom:4px"><span>Subjects detected</span><b>${r.subjectsDetected}</b></div>
      <div class="row between small" style="margin-bottom:4px"><span>Dates detected</span><b>${r.datesDetected}</b></div>
      <div class="row between small" style="margin-bottom:4px"><span>Attendance records</span><b>${r.recordsDetected}</b></div>
      <div class="row between small" style="margin-bottom:4px"><span>New records</span><b style="color:var(--present)">${r.newRecords}</b></div>
      <div class="row between small" style="margin-bottom:4px"><span>Already up to date</span><b>${r.duplicatesPrevented}</b></div>
      <div class="row between small" style="margin-bottom:4px"><span>Records to update</span><b style="color:var(--warn)">${r.updatedRecords}</b></div>
      <div class="row between small" style="margin-bottom:4px"><span>Conflicts (manual vs import)</span><b style="color:${r.potentialConflicts?'var(--absent)':'inherit'}">${r.potentialConflicts}</b></div>
      ${!r.timetableFound ? `<div class="small" style="color:var(--warn);margin-top:8px">No timetable sheet recognized — "Today's Classes" will be limited until one is added.</div>` : ''}
      ${r.unrecognized.length ? `<div class="small muted" style="margin-top:8px">Sheets not recognized as attendance data: ${r.unrecognized.map(esc).join(', ')}</div>` : ''}
      <div class="btn-row" style="margin-top:14px">
        <button class="btn block" data-action="cancel-import">Cancel</button>
        <button class="btn primary block" data-action="commit-import">Import</button>
      </div>
      ${r.potentialConflicts ? `<div class="small muted" style="margin-top:10px">Conflicting records (previously corrected by hand) will be left untouched unless you resolve them after import.</div>` : ''}
    </div>`;
  }

  function backup(d) {
    return `
    ${topbar('Backup & Restore', { back: true })}
    <div class="content">
      <div class="card">
        <p class="small muted">Back up the entire attendance database to a file you can store safely, and restore it later on this or another device.</p>
        <div class="btn-row">
          <button class="btn block" data-action="backup-export">Export backup</button>
          <button class="btn block" data-action="backup-import-trigger">Restore backup</button>
        </div>
        <input type="file" id="backup-file" accept=".json" style="display:none" />
      </div>
    </div>`;\n  }\n\n  function settings(d) {\n    const sc = d.syncConfig || {};
    // Format last-sync timestamp for display
    let lastSyncLabel = 'Not synced yet';
    if (sc.lastSync) {
      try {
        const dt = new Date(sc.lastSync);
        lastSyncLabel = 'Last synced: ' + dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
          + ' at ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      } catch (e) { lastSyncLabel = sc.lastSync.slice(0, 16).replace('T', ' '); }
    }
    const isConfigured = !!(sc.syncKey && sc.supabaseUrl && sc.supabaseAnonKey);
    const dotColor     = isConfigured ? 'var(--present)' : '#555';
    const statusLabel  = isConfigured ? lastSyncLabel : 'Not configured — fill in the fields below';
    return `
    ${topbar('Settings', { back: true })}
    <div class="content">
      <div class="section-title" style="margin-top:0">Theme</div>
      <div class="card tabbar" style="margin-bottom:0">
        ${['system','light','dark'].map(t => `<span class="chip ${d.theme===t?'active':''}" data-action="set-theme" data-value="${t}">${t[0].toUpperCase()+t.slice(1)}</span>`).join('')}
      </div>

      <div class="section-title">☁️ Cloud Sync</div>
      <div class="card">
        <p class="small muted" style="margin-top:0">Sync attendance across all your devices in real time using <b>Supabase</b> (free). All devices with the same <b>Room Key</b> share data automatically.</p>

        <!-- Setup guide accordion -->
        <details style="margin-bottom:14px;border:1px solid var(--border,#2a2a35);border-radius:10px;overflow:hidden">
          <summary style="padding:12px 14px;cursor:pointer;font-weight:600;font-size:13px;list-style:none;display:flex;align-items:center;gap:8px">
            <span style="font-size:16px">🚀</span> First time? One-time Supabase setup (free, ~3 min)
          </summary>
          <div class="small muted" style="padding:0 14px 14px;line-height:1.7">
            <b>Step 1</b> — Create a free project at <a href="https://supabase.com" target="_blank" style="color:var(--accent,#a78bfa)">supabase.com</a> → New Project<br>
            <b>Step 2</b> — In your project, open <b>SQL Editor</b> and run:<br>
            <pre style="background:var(--surface2,#16161f);border-radius:8px;padding:10px;margin:8px 0;overflow-x:auto;font-size:11px;white-space:pre">CREATE TABLE sync_data (
  sync_key   TEXT PRIMARY KEY,
  payload    JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sync_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON sync_data
  FOR ALL USING (true) WITH CHECK (true);</pre>
            <b>Step 3</b> — Go to <b>Project Settings → API</b> and copy:<br>
            &nbsp;&nbsp;• <b>Project URL</b> → paste in "Supabase URL" below<br>
            &nbsp;&nbsp;• <b>anon / public key</b> → paste in "Anon Key" below<br>
            <b>Step 4</b> — Pick any <b>Room Key</b> (e.g. <code>cse-3a-2026</code>) and use the same key on every device.
          </div>
        </details>

        <label style="margin-top:0">Supabase Project URL</label>
        <input id="sync-sb-url" placeholder="https://xxxxxxxxxxxx.supabase.co" value="${esc(sc.supabaseUrl||'')}" autocomplete="off" />

        <label style="margin-top:12px">Supabase Anon Key <span class="muted small">(public — safe to paste here)</span></label>
        <input id="sync-sb-key" placeholder="eyJhbGci…" value="${esc(sc.supabaseAnonKey||'')}" autocomplete="off" style="font-family:monospace;font-size:12px" />

        <label style="margin-top:12px">Room Key <span class="muted small">(any secret phrase shared across your devices)</span></label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="sync-key" placeholder="e.g. cse-3a-2026-secret" value="${esc(sc.syncKey||'')}" style="flex:1;margin:0" />
          <button class="btn" data-action="copy-sync-key" style="padding:0 14px;height:44px;flex-shrink:0;font-size:18px" title="Copy room key">📋</button>
        </div>

        <div class="row between" style="margin-top:14px">
          <span class="small">Auto-sync when connected</span>
          <input type="checkbox" id="sync-auto" ${sc.autoSync!==false?'checked':''} style="width:auto;margin:0" />
        </div>

        <div class="btn-row" style="margin-top:14px">
          <button class="btn primary block" data-action="save-sync-config">Save &amp; Sync</button>
          <button class="btn block" data-action="sync-now">Sync Now 🔄</button>
        </div>

        <div class="small" style="margin-top:10px;display:flex;align-items:center;gap:6px" id="sync-status-text">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>
          ${esc(statusLabel)}
        </div>
      </div>

      <div class="section-title">Class setup</div>
      <div class="card">
        <label style="margin-top:0">Class name</label>
        <input id="s-classname" value="${esc(d.classInfo.className||'')}" />
        <label>Department</label>
        <input id="s-dept" value="${esc(d.classInfo.department||'')}" />
        <label>Section</label>
        <input id="s-section" value="${esc(d.classInfo.section||'')}" />
        <label>Semester</label>
        <input id="s-semester" value="${esc(d.classInfo.semester||'')}" />
        <label>Academic year</label>
        <input id="s-year" value="${esc(d.classInfo.academicYear||'')}" />
        <button class="btn primary block" style="margin-top:14px" data-action="save-class-info">Save</button>
      </div>

      <div class="section-title">Low attendance threshold</div>
      <div class="card tabbar" style="margin-bottom:0">
        ${[65,70,75,80].map(t => `<span class="chip ${d.threshold===t?'active':''}" data-action="set-threshold-default" data-value="${t}">${t}%</span>`).join('')}
      </div>
    </div>`;
  }

  return {
    esc, initials, fmtDate, fmtDateShort, dayNameOf, pctStr, pctClass, pctColor, barRow, subjectMarginChip, DAY_NAMES,
    topbar, bottomNav,
    dashboard, studentsList, studentDetail, studentForm,
    markHome, markPeriod,
    subjectsList, subjectDetail,
    lowAttendance, calendarHome, calendarDay,
    reports, more, importHome, importPreview, importSuccess, backup, settings,
    imagePreviewModal, confirmModal, promptModal, marginBadge,
  };
})();
