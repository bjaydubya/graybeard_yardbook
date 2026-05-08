/**
 * puttbook.js — Graybeard's PuttBook
 *
 * Physics: backswing length (cm) = baseline × √((dist/baseline_dist) × (μ + slope%) / μ)
 * where μ (rolling friction) = 0.559 / Stimp
 *
 * Verified against Pellicani/Brede spreadsheet (Stimp 10, 23cm baseline at 10ft flat).
 */

(() => {

  // ── Constants ─────────────────────────────────────────────────────────────
  const MU_NUM      = 0.559;   // stimpmeter constant
  const DISTANCES   = [6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50]; // feet
  const SLOPES      = [-4,-3,-2,-1,0,1,2,3,4];  // % (negative = downhill)
  const CM_TO_IN    = 1 / 2.54;
  const FT_TO_M     = 0.3048;
  const STORAGE_KEY = 'graybeards_puttbook';
  const SAVE_DELAY  = 600;

  // Column header colors — mirrors the Google Sheet palette
  const SLOPE_STYLE = {
    '-4': { hdrBg:'#922b21', hdrFg:'#fff', cellRgb:'192,57,43'   },
    '-3': { hdrBg:'#ba4a00', hdrFg:'#fff', cellRgb:'186,74,0'    },
    '-2': { hdrBg:'#d4ac0d', hdrFg:'#000', cellRgb:'212,172,13'  },
    '-1': { hdrBg:'#b7950b', hdrFg:'#fff', cellRgb:'183,149,11'  },
     '0': { hdrBg:'#1e2533', hdrFg:'#fff', cellRgb:'0,0,0'       },
     '1': { hdrBg:'#1e8449', hdrFg:'#fff', cellRgb:'30,132,73'   },
     '2': { hdrBg:'#196f3d', hdrFg:'#fff', cellRgb:'25,111,61'   },
     '3': { hdrBg:'#117a65', hdrFg:'#fff', cellRgb:'17,122,101'  },
     '4': { hdrBg:'#0e6655', hdrFg:'#fff', cellRgb:'14,102,85'   },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let stimp         = 10;     // green speed
  let baselineStroke = 23.0;  // cm at baselineDist on flat
  let baselineDist   = 10;    // ft
  let myZeroStroke   = 23.0;  // cm — minimum (zero) stroke calibration
  let myMaxStroke    = 46.0;  // cm — maximum stroke; beyond this use more velocity
  let zeroPuttSlope  = 2.0;   // % — for the zero-putt calculator
  let strokeInCm     = true;  // false = inches
  let distInFt       = true;  // false = meters
  let saveTimer      = null;

  // ── Formulas ──────────────────────────────────────────────────────────────
  function mu() { return MU_NUM / stimp; }

  // Required backswing length (cm) for a given distance and slope
  function calcStroke(distFt, slopePct) {
    const m = mu();
    const s = slopePct / 100;
    const eff = m + s;
    if (eff <= 0) return null;  // ball can't be stopped on this extreme downhill
    const ratio = (distFt / baselineDist) * (eff / m);
    return baselineStroke * Math.sqrt(ratio);
  }

  // Distance ball rolls for a given stroke on a given slope
  function calcRoll(strokeCm, slopePct) {
    const m = mu();
    const s = slopePct / 100;
    const eff = m + s;
    if (eff <= 0) return Infinity;
    return baselineDist * Math.pow(strokeCm / baselineStroke, 2) * m / eff;
  }

  // ── Display helpers ───────────────────────────────────────────────────────
  function dispStroke(cm) {
    if (cm == null) return '—';
    if (!isFinite(cm)) return '∞';
    const v = strokeInCm ? cm : cm * CM_TO_IN;
    return v.toFixed(1);
  }

  function dispDist(ft) {
    if (!isFinite(ft)) return '∞';
    const v = distInFt ? ft : ft * FT_TO_M;
    return v.toFixed(1);
  }

  function strokeUnit() { return strokeInCm ? 'cm' : 'in'; }
  function distUnit()   { return distInFt   ? 'ft' : 'm';  }

  function fromDispStroke(val) {
    const n = parseFloat(val);
    return strokeInCm ? n : n / CM_TO_IN;
  }
  function fromDispDist(val) {
    const n = parseFloat(val);
    return distInFt ? n : n / FT_TO_M;
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  function schedSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          stimp, baselineStroke, baselineDist,
          myZeroStroke, myMaxStroke,
          zeroPuttSlope, strokeInCm, distInFt,
        }));
      } catch(e) {}
    }, SAVE_DELAY);
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.stimp          != null) stimp          = d.stimp;
      if (d.baselineStroke != null) baselineStroke = d.baselineStroke;
      if (d.baselineDist   != null) baselineDist   = d.baselineDist;
      if (d.myZeroStroke   != null) myZeroStroke   = d.myZeroStroke;
      if (d.myMaxStroke    != null) myMaxStroke    = d.myMaxStroke;
      if (d.zeroPuttSlope  != null) zeroPuttSlope  = d.zeroPuttSlope;
      if (d.strokeInCm     != null) strokeInCm     = d.strokeInCm;
      if (d.distInFt       != null) distInFt       = d.distInFt;
    } catch(e) {}
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function $id(id) { return document.getElementById(id); }

  // ── Render — Left panels ──────────────────────────────────────────────────
  function renderPanels() {
    // Stimp buttons
    document.querySelectorAll('.stimp-btn').forEach(btn =>
      btn.classList.toggle('active', +btn.dataset.stimp === stimp)
    );

    // μ value
    const muEl = $id('muDisplay');
    if (muEl) muEl.textContent = mu().toFixed(4);

    // Baseline inputs
    const bsEl = $id('baselineStroke');
    if (bsEl) bsEl.value = dispStroke(baselineStroke);

    const bdEl = $id('baselineDist');
    if (bdEl) bdEl.value = dispDist(baselineDist);

    const msEl = $id('myZeroStroke');
    if (msEl) msEl.value = dispStroke(myZeroStroke);

    const mmEl = $id('myMaxStroke');
    if (mmEl) mmEl.value = dispStroke(myMaxStroke);

    // Unit labels
    document.querySelectorAll('.lbl-stroke-unit').forEach(el =>
      el.textContent = strokeUnit()
    );
    document.querySelectorAll('.lbl-dist-unit').forEach(el =>
      el.textContent = distUnit()
    );

    // Zero putt calculator
    const zpEl = $id('zeroPuttSlope');
    if (zpEl) zpEl.value = zeroPuttSlope;

    renderZeroPutt();
    renderNotes();

    // Unit toggles
    document.querySelectorAll('.stroke-unit-opt').forEach(el =>
      el.classList.toggle('active', el.dataset.unit === (strokeInCm ? 'cm' : 'in'))
    );
    document.querySelectorAll('.dist-unit-opt').forEach(el =>
      el.classList.toggle('active', el.dataset.unit === (distInFt ? 'ft' : 'm'))
    );
  }

  function renderZeroPutt() {
    const rollUp   = calcRoll(myZeroStroke,  zeroPuttSlope);
    const rollDown = calcRoll(myZeroStroke, -zeroPuttSlope);

    const upEl   = $id('rollUp');
    const downEl = $id('rollDown');
    if (upEl)   upEl.textContent   = dispDist(rollUp)   + ' ' + distUnit();
    if (downEl) downEl.textContent = dispDist(rollDown) + ' ' + distUnit();
  }

  // ── Render — Matrix ───────────────────────────────────────────────────────
  function renderMatrix() {
    const thead = $id('puttHead');
    const tbody = $id('puttBody');
    if (!thead || !tbody) return;

    // For each slope column, find which displayed row a given stroke length rolls to.
    // Uses calcRoll() (the physical roll distance) then snaps to nearest row.
    // Returns null if the roll distance falls outside the displayed range — this
    // prevents highlighting the bottom row just because it's the "least wrong" match
    // when the actual distance would be off the matrix entirely.
    const DIST_MIN = DISTANCES[0];
    const DIST_MAX = DISTANCES[DISTANCES.length - 1];

    function rowForStroke(strokeCm, slopePct) {
      const rollDist = calcRoll(strokeCm, slopePct);
      // Bail out if the ball rolls outside (or well outside) the visible range
      if (!isFinite(rollDist) || rollDist < DIST_MIN - 1 || rollDist > DIST_MAX + 1) return null;
      return DISTANCES.reduce((best, d) =>
        Math.abs(d - rollDist) < Math.abs(best - rollDist) ? d : best
      );
    }

    const zeroRow = {};
    const midRow  = {};
    const dblRow  = {};
    for (const s of SLOPES) {
      zeroRow[s] = rowForStroke(myZeroStroke,       s);
      midRow[s]  = rowForStroke(myZeroStroke * 1.5, s);
      dblRow[s]  = rowForStroke(myZeroStroke * 2,   s);
    }

    // ── Header ──
    const htr = document.createElement('tr');

    const thDist = document.createElement('th');
    thDist.className = 'pb-th-dist';
    thDist.textContent = distUnit().toUpperCase();
    htr.appendChild(thDist);

    for (const s of SLOPES) {
      const th  = document.createElement('th');
      const sty = SLOPE_STYLE[String(s)];
      th.className = 'pb-th-slope';
      th.style.cssText = `background:${sty.hdrBg};color:${sty.hdrFg};`;

      const label = s === 0 ? 'Flat'
                  : s < 0  ? `${Math.abs(s)}%↓`
                  :           `${s}%↑`;
      th.innerHTML = `<span class="pb-slope-lbl">${label}</span>`;
      htr.appendChild(th);
    }

    thead.innerHTML = '';
    thead.appendChild(htr);

    // ── Body ──
    tbody.innerHTML = '';

    for (const dist of DISTANCES) {
      const tr = document.createElement('tr');
      const isRefRow = dist === baselineDist;

      const tdDist = document.createElement('td');
      tdDist.className = 'pb-td-dist' + (isRefRow ? ' pb-ref-dist' : '');
      tdDist.textContent = dispDist(dist);
      tr.appendChild(tdDist);

      for (const s of SLOPES) {
        const td        = document.createElement('td');
        const req       = calcStroke(dist, s);
        const isRefCell = isRefRow && s === 0;
        const isZeroRow = zeroRow[s] === dist;
        const isMidRow  = midRow[s]  === dist && !isZeroRow;
        const isDblRow  = dblRow[s]  === dist && !isZeroRow && !isMidRow;
        const isOverMax = req != null && req > myMaxStroke;
        const sty       = SLOPE_STYLE[String(s)];

        if (req == null) {
          // Ball can't stop — extreme downhill on fast green
          td.className   = 'pb-td-cell pb-impossible';
          td.textContent = '—';
        } else if (isRefCell) {
          // Calibration baseline (e.g., 10ft flat = 23cm)
          td.className   = 'pb-td-cell pb-ref-cell';
          td.textContent = dispStroke(req);
        } else if (isZeroRow) {
          // Zero stroke distance for this slope
          td.className     = 'pb-td-cell pb-zero-row';
          td.style.cssText = `background:${sty.hdrBg}; color:${sty.hdrFg}; font-weight:800;`;
          td.textContent   = dispStroke(req);
        } else if (isMidRow) {
          // Mid stroke (1.5×) distance for this slope
          td.className   = 'pb-td-cell pb-mid-row';
          td.textContent = dispStroke(req);
        } else if (isDblRow) {
          // Double stroke distance for this slope
          td.className   = 'pb-td-cell pb-dbl-row';
          td.textContent = dispStroke(req);
        } else if (isOverMax) {
          // Required stroke exceeds max — needs more velocity, not more length
          td.className   = 'pb-td-cell pb-max-exceeded';
          td.textContent = dispStroke(req);
        } else {
          // Normal cell with slope-direction tint
          td.className = 'pb-td-cell';
          const op = (Math.abs(s) / 4) * 0.30;
          if (s !== 0) td.style.background = `rgba(${sty.cellRgb},${op})`;
          td.textContent = dispStroke(req);
        }

        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  function renderNotes() {
    const set = (id, val) => { const el = $id(id); if (el) el.textContent = val; };
    set('noteZeroStroke', `${dispStroke(myZeroStroke)} ${strokeUnit()}`);
    set('noteMidStroke',  `${dispStroke(myZeroStroke * 1.5)} ${strokeUnit()}`);
    set('noteDblStroke',  `${dispStroke(myZeroStroke * 2)} ${strokeUnit()}`);
    set('noteMaxStroke',  `${dispStroke(myMaxStroke)} ${strokeUnit()}`);
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function downloadMatrix() {
    const btn = $id('pbExportBtn');
    const tbl = $id('puttTable');
    if (!tbl || typeof html2canvas === 'undefined') {
      alert('Export library not loaded — check internet connection.');
      return;
    }
    if (btn) { btn.textContent = '⏳ Capturing…'; btn.disabled = true; }
    const bg = getComputedStyle(document.documentElement)
                 .getPropertyValue('--surface').trim() || '#1c1c1e';
    html2canvas(tbl, { backgroundColor: bg, scale: 2, useCORS: true, logging: false })
      .then(canvas => {
        const link = document.createElement('a');
        link.download = 'graybeards-puttbook.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        if (btn) { btn.textContent = '📸 Export'; btn.disabled = false; }
      }).catch(() => {
        if (btn) { btn.textContent = '📸 Export'; btn.disabled = false; }
      });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function wireEvents() {
    // Stimp buttons
    document.querySelectorAll('.stimp-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        stimp = +btn.dataset.stimp;
        renderPanels();
        renderMatrix();
        schedSave();
      })
    );

    // Stimp manual input
    const stimpInput = $id('stimpInput');
    if (stimpInput) {
      stimpInput.addEventListener('input', () => {
        const v = parseFloat(stimpInput.value);
        if (v >= 6 && v <= 16) {
          stimp = v;
          renderPanels();
          renderMatrix();
          schedSave();
        }
      });
    }

    // Baseline stroke
    $id('baselineStroke')?.addEventListener('change', () => {
      baselineStroke = fromDispStroke($id('baselineStroke').value);
      renderMatrix();
      schedSave();
    });

    // Baseline distance
    $id('baselineDist')?.addEventListener('change', () => {
      baselineDist = fromDispDist($id('baselineDist').value);
      renderMatrix();
      schedSave();
    });

    // My zero stroke
    $id('myZeroStroke')?.addEventListener('change', () => {
      myZeroStroke = fromDispStroke($id('myZeroStroke').value);
      renderMatrix();
      renderZeroPutt();
      renderNotes();
      schedSave();
    });

    // My max stroke
    $id('myMaxStroke')?.addEventListener('change', () => {
      myMaxStroke = fromDispStroke($id('myMaxStroke').value);
      renderMatrix();
      renderNotes();
      schedSave();
    });

    // Zero putt slope — input updates calc; double-click resets to 0
    $id('zeroPuttSlope')?.addEventListener('input', () => {
      zeroPuttSlope = parseFloat($id('zeroPuttSlope').value) || 0;
      renderZeroPutt();
      schedSave();
    });
    $id('zeroPuttSlope')?.addEventListener('dblclick', () => {
      zeroPuttSlope = 0;
      $id('zeroPuttSlope').value = '0';
      renderZeroPutt();
      schedSave();
    });

    // Stroke unit toggle (cm / in)
    document.querySelectorAll('.stroke-unit-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        strokeInCm = btn.dataset.unit === 'cm';
        renderPanels();
        renderMatrix();
        schedSave();
      })
    );

    // Distance unit toggle (ft / m)
    document.querySelectorAll('.dist-unit-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        distInFt = btn.dataset.unit === 'ft';
        renderPanels();
        renderMatrix();
        schedSave();
      })
    );

    // Theme — shared with YardBook via graybeards_theme key
    const MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    const SUN  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>`;
    function pbApplyTheme(t) {
      const safe = t === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = safe;
      localStorage.setItem('graybeards_theme', safe);
      const btn = $id('themeBtn');
      if (btn) btn.innerHTML = safe === 'dark' ? MOON : SUN;
    }
    pbApplyTheme(localStorage.getItem('graybeards_theme') || 'dark');
    $id('themeBtn')?.addEventListener('click', () => {
      pbApplyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    loadSaved();
    renderPanels();
    renderMatrix();
    wireEvents();
  }

  // Expose export to inline onclick handler
  window.downloadMatrix = downloadMatrix;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
