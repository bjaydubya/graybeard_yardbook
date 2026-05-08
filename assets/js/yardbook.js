/**
 * yardbook.js — Graybeard's YardBook application logic
 * Depends on: YBStorage (storage.js loaded first)
 *
 * All data stored internally in imperial (yards / mph).
 * toDisplay / fromDisplay convert for metric rendering without touching state.
 */

(() => {

  // ── Constants ─────────────────────────────────────────────────────────────
  const MAX_BAG         = 14;   // golf regulation — badge denominator
  const MAX_BAG_HARD    = 15;   // absolute hard cap (one grace slot above regulation)
  const MAX_GARAGE      = 15;   // garage hard cap
  const MIN_YARDS       = 50;
  const YARD_STEP       = 5;
  const DEFAULT_MAX_Y   = 230;
  const MATRIX_HEADROOM = 20;   // extra yards above longest club (room for cell-hi)
  const SAVE_DELAY_MS   = 600;
  const YARD_TO_M       = 0.9144;
  const MPH_TO_KPH      = 1.60934;
  const FT_TO_M         = 0.3048;
  const SWING_MAX_YARDS = 180;     // show swing cells for 7-iron and shorter

  // ── State ─────────────────────────────────────────────────────────────────
  let uid         = 1;
  let bag         = [];    // { id, name, yardage(yards), speed(mph) }
  let garage      = [];
  let isMetric    = false;
  let swingSystem = 'clock';   // 'clock' | 'body'
  let saveTimer   = null;
  let pctManual   = false;

  // ── Default bag ───────────────────────────────────────────────────────────
  function defaultBag() {
    // Regular clubs start blank so users enter their own numbers
    const clubs = [
      'DR','3W','5W','4H','5I','6I','7I','8I','9I','PW','GW','SW',
    ].map(name => ({ id: uid++, name, yardage: null, speed: null }));
    // Putter always included — no yardage/speed, just a name
    clubs.push({ id: uid++, name: 'P', putterName: 'Billy Baroo', yardage: null, speed: null, isPutter: true });
    return clubs;
  }

  // ── Unit helpers ──────────────────────────────────────────────────────────
  // toDisplay  — internal imperial value → display value (stays imperial or converts)
  // fromDisplay — display value entered by user → internal imperial value
  function toDisplay(val, type) {
    if (val == null || val === '') return '';
    if (!isMetric) return val;
    if (type === 'dist')  return Math.round(val * YARD_TO_M);
    if (type === 'speed') return Math.round(val * MPH_TO_KPH);
    return val;
  }
  function fromDisplay(val, type) {
    if (val == null || val === '') return null;  // blank field → null (not 0)
    if (!isMetric) return +val;
    if (type === 'dist')  return Math.round(+val / YARD_TO_M);
    if (type === 'speed') return Math.round(+val / MPH_TO_KPH);
    return +val;
  }
  function speedUnit()     { return isMetric ? 'kph' : 'mph'; }

  // Elevation adjustment factor from the current Δ% value.
  // Formula: ~2% per 1,000 ft elevation change (industry consensus — TrackMan/PGA Tour rule of thumb).
  // Higher altitude → less air density → less drag → ball travels farther.
  // Lower altitude → more air density → more drag → ball travels shorter.
  function getElevFactor() {
    const pct = parseFloat(($id('pctChange') ?? {}).value) || 0;
    return 1 + pct / 100;
  }

  // ── Generic helpers ───────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function getMaxYards() {
    const ef = getElevFactor();
    const nonPutters = bag.filter(c => !c.isPutter);
    if (isMetric) {
      // Compute ceiling in metres so the grid starts/ends on clean 5m values
      const DEFAULT_MAX_M = Math.round(DEFAULT_MAX_Y * YARD_TO_M);
      const m = nonPutters.reduce((acc, c) =>
        Math.max(acc, Math.round((c.yardage || 0) * ef * YARD_TO_M)), DEFAULT_MAX_M);
      return Math.ceil(m / 5) * 5 + 20;   // 20m headroom
    }
    const m = nonPutters.reduce((acc, c) =>
      Math.max(acc, Math.round((c.yardage || 0) * ef)), DEFAULT_MAX_Y);
    return Math.ceil(m / YARD_STEP) * YARD_STEP + MATRIX_HEADROOM;
  }

  function bagAtLimit() { return bag.length >= MAX_BAG;      }  // regulation — stops Add Club
  function bagFull()    { return bag.length >= MAX_BAG_HARD; }  // hard cap — stops garage move
  function garageFull() { return garage.length >= MAX_GARAGE; }
  function $id(id)   { return document.getElementById(id); }

  // ── Validation toast ──────────────────────────────────────────────────────
  const MAX_YARDS = 350;   // ~320m
  const MIN_YARDS_INPUT = 50;

  let toastTimer = null;
  function showToast(msg) {
    const wrap = $id('toastWrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    clearTimeout(toastTimer);

    const el = document.createElement('div');
    el.className   = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);

    const dismiss = () => {
      el.classList.add('out');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    };
    el.addEventListener('click', dismiss);
    toastTimer = setTimeout(dismiss, 4500);
  }

  function validateYardage(yards) {
    if (yards === null) return true;   // blank is fine
    if (yards > MAX_YARDS) {
      showToast("Woah, there long drive champ — the maximum distance we support is 350 yards (320m)…take it down a notch. 😄");
      return false;
    }
    if (yards < MIN_YARDS_INPUT) {
      showToast("Yeah, if you can't hit this club 50 yards, maybe don't include it in the bag? 😅");
      return false;
    }
    return true;
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  function schedSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commitSave, SAVE_DELAY_MS);
  }

  function commitSave() {
    YBStorage.save({
      bag:    bag.map(({ id, ...rest }) => rest),
      garage: garage.map(({ id, ...rest }) => rest),
      prefs: {
        homeElev:    parseFloat($id('homeElev').value) || 0,
        awayElev:    parseFloat($id('awayElev').value) || 0,
        pctManual,
        pctOverride: pctManual ? (parseFloat($id('pctChange').value) || 0) : null,
        theme:       currentTheme(),
        isMetric,
        swingSystem,
      },
    });
    // also sync theme to shared key for cross-page persistence
    localStorage.setItem('graybeards_theme', currentTheme());
  }

  // ── Restore from storage ──────────────────────────────────────────────────
  function restoreOrDefault() {
    const saved = YBStorage.load();

    if (saved && Array.isArray(saved.bag) && saved.bag.length > 0) {
      uid    = 1;
      bag    = saved.bag.map(c => ({ id: uid++, ...c }));
      garage = (saved.garage ?? []).map(c => ({ id: uid++, ...c }));
      const maxId = [...bag, ...garage].reduce((m, c) => Math.max(m, c.id), 0);
      uid = maxId + 1;

      const p = saved.prefs ?? {};
      if (p.homeElev != null) $id('homeElev').value = p.homeElev;
      if (p.awayElev != null) $id('awayElev').value = p.awayElev;
      if (p.isMetric)      isMetric    = true;
      if (p.swingSystem)   swingSystem = p.swingSystem;

      if (p.pctManual && p.pctOverride != null) {
        pctManual = true;
        $id('pctChange').value = p.pctOverride.toFixed(1);
        updatePctColor();
        showOverrideFlag(true);
      } else {
        recalcPct();
      }

      // theme loaded below from shared key
    } else {
      bag    = defaultBag();
      garage = [];
    }
  }

  // ── Unit label updates ────────────────────────────────────────────────────
  function updateUnitLabels() {
    document.querySelectorAll('.lbl-dist').forEach(
      el => { el.textContent = isMetric ? 'Meters' : 'Yards'; }
    );
    document.querySelectorAll('.lbl-speed').forEach(
      el => { el.textContent = `Speed/${speedUnit()}*`; }
    );
    document.querySelectorAll('.lbl-footnote').forEach(
      el => { el.textContent = `*Clubhead speed in ${speedUnit()} as measured on a launch monitor`; }
    );
    document.querySelectorAll('.lbl-elev-unit').forEach(
      el => { el.textContent = isMetric ? 'm' : 'ft'; }
    );
    // Sync the units toggle buttons
    document.querySelectorAll('.units-opt').forEach(el => {
      el.classList.toggle('active', el.dataset.units === (isMetric ? 'metric' : 'imperial'));
    });
  }

  // ── Render — Bag ──────────────────────────────────────────────────────────
  function renderBag() {
    const tbody = $id('bagBody');
    tbody.innerHTML = '';

    bag.forEach(club => {
      const tr = document.createElement('tr');
      tr.className  = 'club-row';
      tr.draggable  = true;
      tr.dataset.id = club.id;

      if (club.isPutter) {
        tr.className = 'club-row putter-row';
        tr.innerHTML = `
          <td><span class="drag-handle" title="Drag to reorder">⠿</span></td>
          <td>
            <input class="ci name" maxlength="2" value="${esc(club.name)}"
              title="Putter code (2 chars)"
              onchange="YBApp.setClub(${club.id},'name',this.value.toUpperCase().slice(0,2));
                        this.value=this.value.toUpperCase().slice(0,2);">
          </td>
          <td colspan="2" style="padding:3px 6px;">
            <input class="ci" style="width:100%;" maxlength="30"
              value="${esc(club.putterName || '')}"
              placeholder="Putter name"
              onchange="YBApp.setClub(${club.id},'putterName',this.value);">
          </td>
          <td>
            <button class="act-btn" title="Send to Garage"
              onclick="YBApp.toGarage(${club.id})"
              ${garageFull() ? 'disabled' : ''}>↓</button>
          </td>
          <td>
            <button class="del-btn" title="Delete permanently"
              onclick="YBApp.deleteClub(${club.id})">✕</button>
          </td>`;
      } else {
        const dYds = toDisplay(club.yardage, 'dist');
        const dSpd = toDisplay(club.speed,   'speed');

        tr.innerHTML = `
          <td><span class="drag-handle" title="Drag to reorder">⠿</span></td>
          <td>
            <input class="ci name" maxlength="2" value="${esc(club.name)}"
              title="Club abbreviation (2 chars)"
              onchange="YBApp.setClub(${club.id},'name',this.value.toUpperCase().slice(0,2));
                        this.value=this.value.toUpperCase().slice(0,2);">
          </td>
          <td>
            <input class="ci num" type="number" min="0" max="999" value="${dYds}"
              onchange="YBApp.setClub(${club.id},'yardage',this.value)">
          </td>
          <td>
            <input class="ci num" type="number" min="0" max="999"
              value="${dSpd}" placeholder="—"
              onchange="YBApp.setClub(${club.id},'speed',this.value)">
          </td>
          <td>
            <button class="act-btn" title="Send to Garage"
              onclick="YBApp.toGarage(${club.id})"
              ${garageFull() ? 'disabled' : ''}>↓</button>
          </td>
          <td>
            <button class="del-btn" title="Delete permanently"
              onclick="YBApp.deleteClub(${club.id})">✕</button>
          </td>`;
      }

      attachDragHandlers(tr);
      tbody.appendChild(tr);
    });

    updateBagBadge();
    $id('addBtn').disabled = bagAtLimit();
    const hint = $id('addHint');
    if (hint) hint.style.display = bagAtLimit() ? 'block' : 'none';
  }

  function updateBagBadge() {
    const el = $id('bagBadge');
    const n  = bag.length;
    el.textContent = `${n} / ${MAX_BAG}`;
    // < 12: yellow · 12-14: green · 15 (over regulation): red
    const cls = n > MAX_BAG ? ' danger' : n < 12 ? ' warn' : '';
    el.className = 'badge' + cls;
  }

  // ── Render — Garage ───────────────────────────────────────────────────────
  function renderGarage() {
    const tbody = $id('garageBody');
    const empty = $id('garageEmpty');
    const thead = $id('garageThead');
    tbody.innerHTML = '';

    const gBadge = $id('garageBadge');

    if (garage.length === 0) {
      empty.style.display  = 'block';
      thead.style.display  = 'none';
      if (gBadge) gBadge.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    thead.style.display = '';

    if (gBadge) {
      gBadge.style.display = '';
      gBadge.textContent   = `${garage.length} / ${MAX_GARAGE}`;
      gBadge.className     = 'badge' + (garageFull() ? ' warn' : '');
    }

    garage.forEach(club => {
      const tr = document.createElement('tr');
      tr.className = 'club-row';

      const dYds = toDisplay(club.yardage, 'dist');
      const dSpd = toDisplay(club.speed,   'speed');

      if (club.isPutter) {
        tr.className = 'club-row putter-row';
        tr.innerHTML = `
          <td></td>
          <td>
            <input class="ci name" maxlength="2" value="${esc(club.name)}"
              onchange="YBApp.setGarageClub(${club.id},'name',this.value.toUpperCase().slice(0,2));
                        this.value=this.value.toUpperCase().slice(0,2);">
          </td>
          <td colspan="2" style="padding:3px 6px;">
            <input class="ci" style="width:100%;" maxlength="30"
              value="${esc(club.putterName || '')}"
              placeholder="Putter name"
              onchange="YBApp.setGarageClub(${club.id},'putterName',this.value);">
          </td>
          <td>
            <button class="act-btn" title="Move to Bag"
              onclick="YBApp.toBag(${club.id})"
              ${bagFull() ? 'disabled' : ''}>↑</button>
          </td>
          <td>
            <button class="del-btn" title="Delete permanently"
              onclick="YBApp.deleteGarageClub(${club.id})">✕</button>
          </td>`;
      } else {
        tr.innerHTML = `
          <td></td>
          <td>
            <input class="ci name" maxlength="2" value="${esc(club.name)}"
              onchange="YBApp.setGarageClub(${club.id},'name',this.value.toUpperCase().slice(0,2));
                        this.value=this.value.toUpperCase().slice(0,2);">
          </td>
          <td>
            <input class="ci num" type="number" min="0" max="999" value="${dYds}"
              onchange="YBApp.setGarageClub(${club.id},'yardage',this.value)">
          </td>
          <td>
            <input class="ci num" type="number" min="0" max="999"
              value="${dSpd}" placeholder="—"
              onchange="YBApp.setGarageClub(${club.id},'speed',this.value)">
          </td>
          <td>
            <button class="act-btn" title="Move to Bag"
              onclick="YBApp.toBag(${club.id})"
              ${bagFull() ? 'disabled' : ''}>↑</button>
          </td>
          <td>
            <button class="del-btn" title="Delete permanently"
              onclick="YBApp.deleteGarageClub(${club.id})">✕</button>
          </td>`;
      }
      tbody.appendChild(tr);
    });
  }

  // ── Render — Matrix ───────────────────────────────────────────────────────
  function renderMatrix() {
    const maxY  = getMaxYards();     // internal yards
    // Exclude putter — it has no yardage and doesn't belong in the matrix
    const clubs = bag.filter(c => !c.isPutter);
    const thead = $id('matrixHead');
    const tbody = $id('matrixBody');

    // Speed zones — base snapped to the native grid unit (metres in metric, yards otherwise).
    // Swing deltas (stored in yards) are also converted to grid units so they land
    // on the same 5-unit rows the grid displays.
    const elevFactor = getElevFactor();
    const zones = clubs.map(club => {
      if (!club || !club.yardage) return null;
      const base = isMetric
        ? Math.round((club.yardage * elevFactor * YARD_TO_M) / 5) * 5
        : Math.round((club.yardage * elevFactor) / YARD_STEP) * YARD_STEP;
      return {
        hi:     base + 5,
        center: base,
        lo1:    base - 5,
        lo2:    base - 10,
        speed:  club.speed,
        swings: club.yardage <= SWING_MAX_YARDS
          ? SWING_DATA.filter(s => s.delta !== 0).map(s => ({
              y: base + (isMetric
                   ? Math.round(s.delta * YARD_TO_M / 5) * 5  // -15yd→-15m, -30yd→-25m, etc.
                   : s.delta),
              cls:   s.cls,
              label: swingSystem === 'body' ? s.bodyInit : s.clockShort,
            }))
          : [],
      };
    });

    // Header row
    const htr = document.createElement('tr');
    const thY = document.createElement('th');
    thY.className   = 'th-yds';
    thY.textContent = isMetric ? 'M' : 'YDS';
    htr.appendChild(thY);

    for (let i = 0; i < clubs.length; i++) {
      const th   = document.createElement('th');
      th.className = 'th-club';
      const club = clubs[i];
      const span = document.createElement('span');
      span.className   = 'club-vert' + (club ? '' : ' empty');
      span.textContent = club ? (club.name || '—') : '—';
      th.appendChild(span);
      htr.appendChild(th);
    }

    thead.innerHTML = '';
    thead.appendChild(htr);

    // Body rows — descending in native grid units (metres in metric, yards otherwise).
    // y is already the display value so no toDisplay() conversion on row labels.
    tbody.innerHTML = '';

    for (let y = maxY; y >= MIN_YARDS; y -= YARD_STEP) {
      const is50 = y % 50 === 0;
      const is25 = !is50 && y % 25 === 0;
      const tr   = document.createElement('tr');
      if (is50)      tr.classList.add('band-50');
      else if (is25) tr.classList.add('band-25');

      const tdY = document.createElement('td');
      tdY.className   = 'td-yds' + (is50 ? ' m50' : is25 ? ' m25' : '');
      tdY.textContent = y;   // y is native grid unit — no conversion needed
      tr.appendChild(tdY);

      for (let i = 0; i < clubs.length; i++) {
        const td = document.createElement('td');
        const z  = zones[i];

        if (z) {
          if (y === z.center) {
            td.className   = 'td-cell cell-center';
            td.textContent = z.speed != null ? toDisplay(z.speed, 'speed') : '';
          } else if (y === z.hi) {
            td.className   = 'td-cell cell-hi';
            td.textContent = z.speed != null ? toDisplay(z.speed + 2, 'speed') : '';
          } else if (y === z.lo1) {
            td.className   = 'td-cell cell-lo1';
            td.textContent = z.speed != null ? toDisplay(z.speed - 2, 'speed') : '';
          } else if (y === z.lo2) {
            td.className   = 'td-cell cell-lo2';
            td.textContent = z.speed != null ? toDisplay(z.speed - 4, 'speed') : '';
          } else {
            // Check partial-swing level match
            const sw = z.swings.find(s => s.y === y);
            if (sw) {
              td.className   = `td-cell ${sw.cls}`;
              td.textContent = sw.label;
            } else {
              td.className = 'td-cell';
            }
          }
        } else {
          td.className = 'td-cell';
        }

        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
  }

  // ── Drag-to-reorder (bag) ─────────────────────────────────────────────────
  function attachDragHandlers(tr) {
    tr.addEventListener('dragstart', e => {
      e.dataTransfer.setData('clubId', tr.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      tr.classList.add('dragging');
    });
    tr.addEventListener('dragend',  () => tr.classList.remove('dragging'));
    tr.addEventListener('dragover', e => { e.preventDefault(); tr.classList.add('drag-over'); });
    tr.addEventListener('dragleave',  () => tr.classList.remove('drag-over'));
    tr.addEventListener('drop', e => {
      e.preventDefault();
      tr.classList.remove('drag-over');
      const fromId = +e.dataTransfer.getData('clubId');
      const toId   = +tr.dataset.id;
      if (!fromId || fromId === toId) return;
      const fi = bag.findIndex(c => c.id === fromId);
      const ti = bag.findIndex(c => c.id === toId);
      if (fi < 0 || ti < 0) return;
      const [moved] = bag.splice(fi, 1);
      bag.splice(ti, 0, moved);
      renderBag();
      renderMatrix();
      schedSave();
    });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  function addClub() {
    if (bagAtLimit()) return;
    const newClub  = { id: uid++, name: '', yardage: null, speed: null };
    const putterIdx = bag.findIndex(c => c.isPutter);
    if (putterIdx >= 0) bag.splice(putterIdx, 0, newClub);  // insert above putter
    else                bag.push(newClub);                   // no putter — append
    renderBag();
    schedSave();
  }

  // Internal setters — always receive values in imperial
  function setClub(id, field, val) {
    const c = bag.find(c => c.id === id);
    if (!c) return;
    c[field] = val;
    if (field === 'name') renderBag();
    renderMatrix();   // speed, yardage, name all affect matrix cells
    schedSave();
  }

  function setGarageClub(id, field, val) {
    const c = garage.find(c => c.id === id);
    if (c) { c[field] = val; schedSave(); }
  }

  function toGarage(id) {
    if (garageFull()) return;
    const i = bag.findIndex(c => c.id === id);
    if (i < 0) return;
    garage.push(bag.splice(i, 1)[0]);
    renderBag(); renderGarage(); renderMatrix(); schedSave();
  }

  function toBag(id) {
    if (bagFull()) return;
    const i = garage.findIndex(c => c.id === id);
    if (i < 0) return;
    bag.push(garage.splice(i, 1)[0]);
    renderBag(); renderGarage(); renderMatrix(); schedSave();
  }

  function deleteClub(id) {
    const i = bag.findIndex(c => c.id === id);
    if (i < 0) return;
    bag.splice(i, 1);
    renderBag(); renderMatrix(); schedSave();
  }

  function deleteGarageClub(id) {
    const i = garage.findIndex(c => c.id === id);
    if (i < 0) return;
    garage.splice(i, 1);
    renderGarage(); schedSave();
  }

  // ── Elevation ─────────────────────────────────────────────────────────────
  function recalcPct() {
    if (pctManual) return;
    const home = parseFloat($id('homeElev').value) || 0;
    const away = parseFloat($id('awayElev').value) || 0;
    // Formula uses feet; convert if currently in meters
    const divisor = isMetric ? 304.8 : 1000;   // 1000 ft ≡ 304.8 m
    const pct  = ((away - home) / divisor) * 2;
    $id('pctChange').value = pct.toFixed(1);
    updatePctColor();
  }

  function updatePctColor() {
    const v  = parseFloat($id('pctChange').value) || 0;
    $id('pctChange').className = 'pct-inp ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');
  }

  function showOverrideFlag(show) {
    const f = $id('pctFlag');
    if (f) f.style.display = show ? 'inline' : 'none';
  }

  // ── Theme — dark / light only, iOS-style icon toggle ──────────────────────
  // Moon = dark mode active, Sun = light mode active.
  // Theme shared across YardBook + PuttBook via graybeards_theme key.
  const MOON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  const SUN_SVG  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>`;

  function currentTheme() { return document.documentElement.dataset.theme || 'dark'; }

  function applyTheme(id) {
    const safe = id === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = safe;
    const btn = $id('themeBtn');
    if (btn) btn.innerHTML = safe === 'dark' ? MOON_SVG : SUN_SVG;
  }

  function cycleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    schedSave();
  }

  // ── Swing Adjustment ─────────────────────────────────────────────────────
  // Full swing = 11:00 (100%). 12:00 would be an overswing (~110%) — not shown.
  // Each clock hour shorter = -10% distance, -15 yards (15 yds/hr rule).
  // clockShort = label shown in matrix Clock mode; bodyInit = label in Body mode
  const SWING_DATA = [
    { color: '#1a7c36', body: 'Full',     clock: '11:00', clockShort: '11', bodyInit: 'F', pct: 100, delta:   0, cls: null            },
    { color: '#ffd60a', body: 'Shoulder', clock: '10:00', clockShort: '10', bodyInit: 'S', pct:  90, delta: -15, cls: 'swing-shoulder' },
    { color: '#ff9f0a', body: 'Chest',    clock: '9:00',  clockShort: '9',  bodyInit: 'C', pct:  80, delta: -30, cls: 'swing-chest'    },
    { color: '#ff6600', body: 'Ribs',     clock: '8:00',  clockShort: '8',  bodyInit: 'R', pct:  70, delta: -45, cls: 'swing-ribs'     },
    { color: '#ff453a', body: 'Hip',      clock: '7:00',  clockShort: '7',  bodyInit: 'H', pct:  60, delta: -60, cls: 'swing-hip'      },
  ];

  function renderSwing() {
    const el = $id('swingCategories');
    if (!el) return;

    el.innerHTML = `
      <div class="swing-toggle-row">
        <div class="swing-opt${swingSystem === 'clock' ? ' active' : ''}" data-swing="clock">Clock</div>
        <div class="swing-opt${swingSystem === 'body'  ? ' active' : ''}" data-swing="body">Body</div>
      </div>
      <table class="swing-tbl">
        <thead>
          <tr>
            <th class="swing-th-dot"></th>
            <th class="swing-th">Body</th>
            <th class="swing-th">Clock</th>
            <th class="swing-th swing-th-r">%</th>
          </tr>
        </thead>
        <tbody>
          ${SWING_DATA.map(c => `
            <tr class="swing-row">
              <td><span class="swing-dot" style="background:${c.color}"></span></td>
              <td class="swing-body">${c.body}</td>
              <td class="swing-clock">${c.clock}</td>
              <td class="swing-pct" style="color:${c.color}">${c.pct}%</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    // Wire toggle (elements are freshly created, listeners won't duplicate)
    el.querySelectorAll('.swing-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        swingSystem = btn.dataset.swing;
        renderSwing();
        renderMatrix();
        schedSave();
      })
    );
  }

  // ── Units ─────────────────────────────────────────────────────────────────
  function setUnits(metric) {
    if (metric === isMetric) return;

    // Convert elevation inputs before flipping the flag
    const homeEl = $id('homeElev');
    const awayEl = $id('awayElev');
    const hv = parseFloat(homeEl.value) || 0;
    const av = parseFloat(awayEl.value) || 0;
    if (metric) {
      homeEl.value = Math.round(hv * FT_TO_M);
      awayEl.value = Math.round(av * FT_TO_M);
    } else {
      homeEl.value = Math.round(hv / FT_TO_M);
      awayEl.value = Math.round(av / FT_TO_M);
    }

    isMetric = metric;
    updateUnitLabels();
    renderBag();
    renderGarage();
    renderMatrix();
    schedSave();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  function wireEvents() {
    $id('addBtn').addEventListener('click', addClub);
    $id('themeBtn').addEventListener('click', cycleTheme);

    $id('homeElev').addEventListener('input', () => {
      pctManual = false; showOverrideFlag(false); recalcPct(); renderMatrix(); schedSave();
    });
    $id('awayElev').addEventListener('input', () => {
      pctManual = false; showOverrideFlag(false); recalcPct(); renderMatrix(); schedSave();
    });
    $id('pctChange').addEventListener('input', () => {
      pctManual = true; updatePctColor(); showOverrideFlag(true); renderMatrix(); schedSave();
    });
    $id('pctChange').addEventListener('dblclick', () => {
      pctManual = false; showOverrideFlag(false); recalcPct(); renderMatrix(); schedSave();
    });

    document.querySelectorAll('.units-opt').forEach(el =>
      el.addEventListener('click', () => setUnits(el.dataset.units === 'metric'))
    );

  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    restoreOrDefault();
    // Apply shared theme (persists across YardBook + PuttBook)
    applyTheme(localStorage.getItem('graybeards_theme') || 'dark');
    renderBag();
    renderGarage();
    renderMatrix();
    recalcPct();
    updateUnitLabels();
    renderSwing();
    wireEvents();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // Inline onchange handlers pass display-unit values; convert to imperial before storing.
  function apiSetClub(id, field, rawVal) {
    let val;
    if (field === 'yardage') {
      val = fromDisplay(rawVal, 'dist');
      if (!validateYardage(val)) { renderBag(); return; }  // reject + reset input
    } else if (field === 'speed') {
      val = (rawVal === '' || rawVal == null) ? null : fromDisplay(rawVal, 'speed');
    } else {
      val = rawVal;
    }
    setClub(id, field, val);
  }

  function apiSetGarageClub(id, field, rawVal) {
    let val;
    if (field === 'yardage') {
      val = fromDisplay(rawVal, 'dist');
      if (!validateYardage(val)) { renderGarage(); return; }  // reject + reset input
    } else if (field === 'speed') {
      val = (rawVal === '' || rawVal == null) ? null : fromDisplay(rawVal, 'speed');
    } else {
      val = rawVal;
    }
    setGarageClub(id, field, val);
  }

  // ── Matrix export ─────────────────────────────────────────────────────────
  function downloadMatrix() {
    const btn = $id('exportBtn');
    const tbl = $id('matrixTable');
    if (!tbl || typeof html2canvas === 'undefined') {
      alert('Export library not loaded — check your internet connection.');
      return;
    }

    if (btn) { btn.textContent = '⏳ Capturing…'; btn.disabled = true; }

    // Grab the surface background from the current theme for the canvas bg
    const bg = getComputedStyle(document.documentElement)
                 .getPropertyValue('--surface').trim() || '#1c1c1e';

    html2canvas(tbl, {
      backgroundColor: bg,
      scale: 2,          // 2× for crisp rendering on phone displays
      useCORS: true,
      logging: false,
      // Include the full scrollable table, not just the visible portion
      windowWidth:  tbl.scrollWidth,
      windowHeight: tbl.scrollHeight,
    }).then(canvas => {
      const link = document.createElement('a');
      link.download = 'graybeards-yardbook.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      if (btn) { btn.textContent = '📸 Export'; btn.disabled = false; }
    }).catch(() => {
      alert('Export failed — try again.');
      if (btn) { btn.textContent = '📸 Export'; btn.disabled = false; }
    });
  }

  window.YBApp = {
    addClub,
    setClub:         apiSetClub,
    setGarageClub:   apiSetGarageClub,
    toGarage,
    toBag,
    deleteClub,
    deleteGarageClub,
    downloadMatrix,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
