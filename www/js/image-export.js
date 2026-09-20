/* ---------------------------------------------------------------------
 * High-Resolution Canvas Image Generator & Exporter
 * Generates beautiful, shareable PNG cards for WhatsApp / Reports:
 * - Student Attendance Report Card
 * - Subject Attendance Breakdown Card
 * - Low Attendance / Defaulters Notice Card
 * ------------------------------------------------------------------- */
const ImageExport = (() => {

  // Canvas drawing helper utilities
  function createHiDPICanvas(width, height) {
    const scale = 2; // 2x retina sharpness
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    return { canvas, ctx, width, height };
  }

  function roundRect(ctx, x, y, w, h, r, fill = true, stroke = false) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function drawBadge(ctx, text, x, y, bg, fg, fontSize = 12) {
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const metrics = ctx.measureText(text);
    const padX = 10, padY = 5;
    const w = metrics.width + padX * 2;
    const h = fontSize + padY * 2;
    ctx.fillStyle = bg;
    roundRect(ctx, x, y - h + padY, w, h, 8, true, false);
    ctx.fillStyle = fg;
    ctx.fillText(text, x + padX, y);
    return w;
  }

  function getStatusColors(pct, isDark = true) {
    if (pct === null || pct === undefined) {
      return { bg: isDark ? 'rgba(156,163,175,0.15)' : '#f3f4f6', fg: '#9ca3af', text: 'No Data' };
    }
    if (pct >= 75) {
      return { bg: isDark ? 'rgba(52,211,153,0.2)' : '#dcfce7', fg: isDark ? '#34d399' : '#166534', text: 'Safe' };
    }
    if (pct >= 65) {
      return { bg: isDark ? 'rgba(251,191,36,0.2)' : '#fef3c7', fg: isDark ? '#fbbf24' : '#92400e', text: 'Warning' };
    }
    return { bg: isDark ? 'rgba(248,113,113,0.2)' : '#fee2e2', fg: isDark ? '#f87171' : '#991b1b', text: 'Shortage' };
  }

  // ------------------------------------------------------------------
  // 1. Student Report Card Image
  // ------------------------------------------------------------------
  function generateStudentCard(student, stats, subjectNames = {}, classInfo = {}, isDark = true) {
    const W = 800;
    const subEntries = Object.entries(stats.subjects || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const rowH = 46;
    const tableTop = 295;
    const H = Math.max(580, tableTop + (subEntries.length + 2) * rowH + 90);

    const { canvas, ctx } = createHiDPICanvas(W, H);

    // Background
    const bg = isDark ? '#0c0c14' : '#f8f9fd';
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#ffffff';
    const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0';
    const textMain = isDark ? '#f8fafc' : '#0f172a';
    const textDim = isDark ? '#94a3b8' : '#64748b';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Header gradient banner
    const grad = ctx.createLinearGradient(30, 25, W - 30, 100);
    grad.addColorStop(0, '#7c3aed');
    grad.addColorStop(0.5, '#a78bfa');
    grad.addColorStop(1, '#06b6d4');

    // Container Card
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = cardBorder;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 24, 24, W - 48, H - 48, 20, true, true);

    // Accent header pill
    ctx.fillStyle = grad;
    roundRect(ctx, 44, 42, 6, 42, 3, true, false);

    // Header Titles
    const institution = [classInfo.className, classInfo.department, classInfo.semester ? `Sem ${classInfo.semester}` : '']
      .filter(Boolean).join(' • ') || 'Class Attendance Record';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#a78bfa';
    ctx.fillText(institution.toUpperCase(), 60, 56);

    ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textMain;
    ctx.fillText(student.name, 60, 83);

    // Roll & Reg No
    const idInfo = [`Roll No: ${student.rollNo || '—'}`, student.regNo ? `Reg No: ${student.regNo}` : '']
      .filter(Boolean).join('   |   ');
    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textDim;
    ctx.fillText(idInfo, 60, 104);

    // Summary Stat Boxes (3 columns)
    const boxY = 125, boxH = 92, boxW = (W - 48 - 40 - 24) / 3;
    const statCards = [
      {
        label: 'OVERALL ATTENDANCE',
        val: stats.pct !== null ? `${stats.pct.toFixed(1)}%` : '—',
        color: stats.pct >= 75 ? '#34d399' : (stats.pct >= 65 ? '#fbbf24' : '#f87171'),
      },
      {
        label: 'PERIODS ATTENDED / TOTAL',
        val: `${stats.present} / ${stats.total}`,
        color: textMain,
      },
      {
        label: 'PERIODS MISSED (ABSENT)',
        val: `${stats.absent} Absent`,
        color: stats.absent > 0 ? '#f87171' : '#34d399',
      },
    ];

    statCards.forEach((sc, i) => {
      const bx = 44 + i * (boxW + 12);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.03)' : '#f1f5f9';
      ctx.strokeStyle = cardBorder;
      roundRect(ctx, bx, boxY, boxW, boxH, 14, true, true);

      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textDim;
      ctx.fillText(sc.label, bx + 16, boxY + 28);

      ctx.font = '800 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = sc.color;
      ctx.fillText(sc.val, bx + 16, boxY + 62);
    });

    // Overall Status banner & Margin
    const bannerY = 230;
    const m = stats.margin || {};
    let statusTxt = 'TARGET: 75% MINIMUM';
    if (m.type === 'safe') {
      statusTxt = m.count > 0 ? `STATUS: SAFE • Can safely miss ${m.count} class(es)` : 'STATUS: SAFE • On edge (0 margin)';
    } else if (m.type === 'need') {
      statusTxt = `ATTENTION: Shortage • Must attend next ${m.count} class(es) consecutive`;
    }
    const colors = getStatusColors(stats.pct, isDark);
    drawBadge(ctx, statusTxt, 44, bannerY + 16, colors.bg, colors.fg, 12);

    // Subject Breakdown Table Header
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0';
    roundRect(ctx, 44, tableTop, W - 88, 38, 10, true, false);

    ctx.font = '700 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textDim;
    ctx.fillText('SUBJECT', 58, tableTop + 24);
    ctx.fillText('TOTAL', 370, tableTop + 24);
    ctx.fillText('PRESENT', 445, tableTop + 24);
    ctx.fillText('ABSENT', 525, tableTop + 24);
    ctx.fillText('ATTENDANCE %', 605, tableTop + 24);
    ctx.fillText('MARGIN', 710, tableTop + 24);

    // Table Rows
    let curY = tableTop + 38;
    if (subEntries.length === 0) {
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textDim;
      ctx.fillText('No attendance recorded yet for this student.', 58, curY + 30);
    } else {
      subEntries.forEach(([code, v], idx) => {
        const rowBg = idx % 2 === 1 ? (isDark ? 'rgba(255,255,255,0.02)' : '#f8fafc') : 'transparent';
        if (rowBg !== 'transparent') {
          ctx.fillStyle = rowBg;
          roundRect(ctx, 44, curY, W - 88, rowH, 6, true, false);
        }

        // Subject code & name
        const subName = subjectNames[code] ? `${code} — ${subjectNames[code]}` : code;
        ctx.font = '600 13.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = textMain;
        const truncated = subName.length > 34 ? subName.slice(0, 32) + '…' : subName;
        ctx.fillText(truncated, 58, curY + 28);

        // Total, Present, Absent
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = textDim;
        ctx.fillText(String(v.total), 370, curY + 28);
        ctx.fillStyle = '#34d399';
        ctx.fillText(String(v.present), 445, curY + 28);
        ctx.fillStyle = v.absent > 0 ? '#f87171' : textDim;
        ctx.fillText(String(v.absent), 525, curY + 28);

        // Percentage badge
        const pStr = v.pct !== null ? `${v.pct.toFixed(1)}%` : '—';
        const pColors = getStatusColors(v.pct, isDark);
        drawBadge(ctx, pStr, 605, curY + 26, pColors.bg, pColors.fg, 11);

        // Margin text & semester quota
        const sm = v.margin || {};
        let mText = '—';
        let mColor = textDim;
        if (v.semesterMargin && v.allocated) {
          mText = v.semesterMargin.text || (sm.type === 'safe' ? `+${sm.count}` : `-${sm.count}`);
          mColor = v.semesterMargin.possible ? '#34d399' : '#f87171';
        } else if (sm.type === 'safe') {
          mText = sm.count > 0 ? `+${sm.count}` : '0';
          mColor = '#34d399';
        } else if (sm.type === 'need') {
          mText = `-${sm.count}`;
          mColor = '#f87171';
        }
        ctx.fillStyle = mColor;
        ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(mText, 700, curY + 28);

        curY += rowH;
      });
    }

    // Footer
    const footerY = H - 42;
    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textDim;
    const nowStr = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    ctx.fillText(`CR Attendance App • Generated on ${nowStr}`, 58, footerY);
    ctx.fillText('Confidential Student Academic Record', W - 280, footerY);

    return canvas;
  }

  // ------------------------------------------------------------------
  // 2. Subject Breakdown Card Image
  // ------------------------------------------------------------------
  function generateSubjectCard(subject, summary, classInfo = {}, isDark = true) {
    const W = 800;
    const students = summary.students || [];
    const rowH = 42;
    const tableTop = 270;
    const maxStudents = Math.min(60, students.length);
    const H = Math.max(540, tableTop + (maxStudents + 2) * rowH + 80);

    const { canvas, ctx } = createHiDPICanvas(W, H);

    const bg = isDark ? '#0c0c14' : '#f8f9fd';
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#ffffff';
    const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0';
    const textMain = isDark ? '#f8fafc' : '#0f172a';
    const textDim = isDark ? '#94a3b8' : '#64748b';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Card boundary
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = cardBorder;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 24, 24, W - 48, H - 48, 20, true, true);

    // Accent line
    ctx.fillStyle = '#06b6d4';
    roundRect(ctx, 44, 42, 6, 42, 3, true, false);

    // Header
    const institution = [classInfo.className, classInfo.department, classInfo.semester ? `Sem ${classInfo.semester}` : '']
      .filter(Boolean).join(' • ') || 'Subject Performance Report';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(institution.toUpperCase(), 60, 56);

    ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textMain;
    ctx.fillText(`${subject.code} — ${subject.name}`, 60, 83);

    // Stat Boxes
    const boxY = 110, boxH = 90, boxW = (W - 48 - 40 - 24) / 3;
    const statCards = [
      {
        label: 'PERIODS CONDUCTED',
        val: `${summary.conducted} Periods`,
        color: '#a78bfa',
      },
      {
        label: 'CLASS AVERAGE',
        val: summary.pct !== null ? `${summary.pct.toFixed(1)}%` : '—',
        color: summary.pct >= 75 ? '#34d399' : '#fbbf24',
      },
      {
        label: 'STUDENTS SUMMARY',
        val: `${summary.above} Above 75%  •  ${summary.below} Below`,
        color: textMain,
        isSmall: true,
      },
    ];

    statCards.forEach((sc, i) => {
      const bx = 44 + i * (boxW + 12);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.03)' : '#f1f5f9';
      ctx.strokeStyle = cardBorder;
      roundRect(ctx, bx, boxY, boxW, boxH, 14, true, true);

      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textDim;
      ctx.fillText(sc.label, bx + 16, boxY + 28);

      ctx.font = sc.isSmall ? '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' : '800 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = sc.color;
      ctx.fillText(sc.val, bx + 16, boxY + 60);
    });

    // Table Header
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0';
    roundRect(ctx, 44, tableTop, W - 88, 36, 10, true, false);

    ctx.font = '700 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textDim;
    ctx.fillText('#', 58, tableTop + 23);
    ctx.fillText('STUDENT NAME', 90, tableTop + 23);
    ctx.fillText('TOTAL', 440, tableTop + 23);
    ctx.fillText('PRESENT', 510, tableTop + 23);
    ctx.fillText('ABSENT', 585, tableTop + 23);
    ctx.fillText('ATTENDANCE %', 660, tableTop + 23);

    // Table Rows
    let curY = tableTop + 36;
    students.slice(0, maxStudents).forEach((s, idx) => {
      const rowBg = idx % 2 === 1 ? (isDark ? 'rgba(255,255,255,0.02)' : '#f8fafc') : 'transparent';
      if (rowBg !== 'transparent') {
        ctx.fillStyle = rowBg;
        roundRect(ctx, 44, curY, W - 88, rowH, 6, true, false);
      }

      ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textDim;
      ctx.fillText(String(idx + 1), 58, curY + 26);

      ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textMain;
      const nm = s.name.length > 35 ? s.name.slice(0, 33) + '…' : s.name;
      ctx.fillText(nm, 90, curY + 26);

      ctx.font = '600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textDim;
      ctx.fillText(String(s.total), 440, curY + 26);
      ctx.fillStyle = '#34d399';
      ctx.fillText(String(s.present), 510, curY + 26);
      ctx.fillStyle = s.absent > 0 ? '#f87171' : textDim;
      ctx.fillText(String(s.absent), 585, curY + 26);

      const pColors = getStatusColors(s.pct, isDark);
      drawBadge(ctx, s.pct !== null ? `${s.pct.toFixed(1)}%` : '—', 660, curY + 24, pColors.bg, pColors.fg, 11);

      curY += rowH;
    });

    // Footer
    const footerY = H - 38;
    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textDim;
    ctx.fillText(`Generated by CR Attendance • ${new Date().toLocaleDateString()}`, 58, footerY);

    return canvas;
  }

  // ------------------------------------------------------------------
  // 3. Defaulters / Shortage Notice Image
  // ------------------------------------------------------------------
  function generateDefaultersNotice(rows, threshold = 75, classInfo = {}, isDark = true) {
    const W = 800;
    const rowH = 44;
    const tableTop = 230;
    const H = Math.max(520, tableTop + (rows.length + 2) * rowH + 90);

    const { canvas, ctx } = createHiDPICanvas(W, H);

    const bg = isDark ? '#0c0c14' : '#f8f9fd';
    const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#ffffff';
    const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0';
    const textMain = isDark ? '#f8fafc' : '#0f172a';
    const textDim = isDark ? '#94a3b8' : '#64748b';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Card boundary
    ctx.fillStyle = cardBg;
    ctx.strokeStyle = cardBorder;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 24, 24, W - 48, H - 48, 20, true, true);

    // Red alert accent line
    ctx.fillStyle = '#ef4444';
    roundRect(ctx, 44, 42, 6, 42, 3, true, false);

    const institution = [classInfo.className, classInfo.department, classInfo.semester ? `Sem ${classInfo.semester}` : '']
      .filter(Boolean).join(' • ') || 'Department Notice';
    ctx.font = '700 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#f87171';
    ctx.fillText('OFFICIAL ATTENDANCE NOTICE', 60, 56);

    ctx.font = '800 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textMain;
    ctx.fillText(`Students with Attendance Below ${threshold}%`, 60, 84);

    // Alert Callout box
    const calloutY = 110;
    ctx.fillStyle = isDark ? 'rgba(239,68,68,0.1)' : '#fee2e2';
    ctx.strokeStyle = isDark ? 'rgba(239,68,68,0.3)' : '#fca5a5';
    roundRect(ctx, 44, calloutY, W - 88, 86, 12, true, true);

    ctx.font = '700 13.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = isDark ? '#fca5a5' : '#991b1b';
    ctx.fillText(`TOTAL DEFAULTERS: ${rows.length} STUDENT(S)`, 62, calloutY + 28);

    ctx.font = '400 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = isDark ? '#cbd5e1' : '#475569';
    ctx.fillText(
      `The following students have fallen below the mandatory ${threshold}% threshold. Please verify periods missed and attend consecutive classes.`,
      62,
      calloutY + 52
    );

    // Table Header
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0';
    roundRect(ctx, 44, tableTop, W - 88, 36, 10, true, false);

    ctx.font = '700 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textDim;
    ctx.fillText('#', 58, tableTop + 23);
    ctx.fillText('STUDENT NAME', 90, tableTop + 23);
    ctx.fillText('ROLL NO', 360, tableTop + 23);
    ctx.fillText('ATTENDED / TOTAL', 460, tableTop + 23);
    ctx.fillText('ABSENT', 590, tableTop + 23);
    ctx.fillText('PERCENTAGE', 670, tableTop + 23);

    // Rows
    let curY = tableTop + 36;
    rows.forEach((r, idx) => {
      const rowBg = idx % 2 === 1 ? (isDark ? 'rgba(255,255,255,0.02)' : '#f8fafc') : 'transparent';
      if (rowBg !== 'transparent') {
        ctx.fillStyle = rowBg;
        roundRect(ctx, 44, curY, W - 88, rowH, 6, true, false);
      }

      ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textDim;
      ctx.fillText(String(idx + 1), 58, curY + 27);

      ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textMain;
      ctx.fillText(r.name, 90, curY + 27);

      ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = textDim;
      ctx.fillText(r.rollNo || '—', 360, curY + 27);

      ctx.font = '600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = '#34d399';
      ctx.fillText(`${r.present} / ${r.total}`, 460, curY + 27);

      ctx.fillStyle = '#f87171';
      ctx.fillText(`${r.absent} Periods`, 590, curY + 27);

      drawBadge(ctx, `${r.pct.toFixed(1)}%`, 670, curY + 25, 'rgba(248,113,113,0.2)', '#f87171', 11);

      curY += rowH;
    });

    const footerY = H - 38;
    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = textDim;
    ctx.fillText(`Issued on ${new Date().toLocaleDateString()} • Class Representative Portal`, 58, footerY);

    return canvas;
  }

  // ------------------------------------------------------------------
  // Export & Share Helpers
  // ------------------------------------------------------------------
  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  async function downloadCanvas(canvas, filename) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename || 'attendance_stats.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (err) {
      console.warn('DataURL download error, attempting blob fallback:', err);
      const blob = await canvasToBlob(canvas);
      if (!blob) return false;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'attendance_stats.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    }
  }

  async function shareCanvas(canvas, title, filename) {
    // 1. Check if running inside Capacitor Android app
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.split(',')[1];
        const fname = filename || `attendance_${Date.now()}.png`;
        if (window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
          const res = await window.Capacitor.Plugins.Filesystem.writeFile({
            path: fname,
            data: base64Data,
            directory: 'CACHE',
          });
          if (window.Capacitor.Plugins.Share) {
            await window.Capacitor.Plugins.Share.share({
              title: title || 'Attendance Report',
              url: res.uri,
            });
            return true;
          }
        }
      } catch (nativeErr) {
        console.warn('Capacitor native share failed, falling back:', nativeErr);
      }
    }

    // 2. Try Web Share API with File
    try {
      const blob = await canvasToBlob(canvas);
      if (blob) {
        const file = new File([blob], filename || 'attendance_stats.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: title || 'Attendance Statistics',
            text: 'Attendance report card from CR Attendance App.',
          });
          return true;
        }
      }
    } catch (webShareErr) {
      if (webShareErr.name !== 'AbortError') console.warn('WebShare error:', webShareErr);
    }

    // 3. Fallback: Download file directly and notify user
    await downloadCanvas(canvas, filename);
    alert('Image downloaded to your device! You can now share it via WhatsApp or Gallery.');
    return true;
  }

  return {
    generateStudentCard,
    generateSubjectCard,
    generateDefaultersNotice,
    downloadCanvas,
    shareCanvas,
    canvasToBlob,
  };
})();
