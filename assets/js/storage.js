/**
 * storage.js — Graybeard's YardBook persistence layer
 *
 * TODAY:   localStorage  — works offline, zero config, zero deps.
 * FUTURE:  To move to a server backend, replace the three functions
 *          (save / load / clear) with fetch() calls to your API.
 *          The rest of the app never touches storage directly, so
 *          this is the only file that needs to change.
 *
 * Schema version lives inside the payload so future code can run
 * migrations on load without manual intervention.
 */

const YBStorage = (() => {

  const STORAGE_KEY    = 'graybeards_yardbook';
  const SCHEMA_VERSION = 1;

  // ── Serialise ────────────────────────────────────────────────────────────
  function save(data) {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      savedAt:       new Date().toISOString(),
      bag:           data.bag    ?? [],
      garage:        data.garage ?? [],
      prefs:         data.prefs  ?? {},
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[YardBook] save failed:', err);
    }

    /* ── Future API path ─────────────────────────────────────────────────
    return fetch('/api/yardbook/bag', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    ─────────────────────────────────────────────────────────────────────── */
  }

  // ── Deserialise ──────────────────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw);

      // Schema migration hook — add cases here as the schema evolves
      // if (data.schemaVersion < 2) data = migrateV1toV2(data);

      return data;
    } catch (err) {
      console.warn('[YardBook] load failed:', err);
      return null;
    }

    /* ── Future API path ─────────────────────────────────────────────────
    const r = await fetch('/api/yardbook/bag');
    return r.ok ? r.json() : null;
    ─────────────────────────────────────────────────────────────────────── */
  }

  // ── Wipe ─────────────────────────────────────────────────────────────────
  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('[YardBook] clear failed:', err);
    }

    /* ── Future API path ─────────────────────────────────────────────────
    return fetch('/api/yardbook/bag', { method: 'DELETE' });
    ─────────────────────────────────────────────────────────────────────── */
  }

  return { save, load, clear };

})();
