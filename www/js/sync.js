/* ---------------------------------------------------------------------
 * Cloud Sync Engine — Supabase backend
 *
 * How it works:
 *   1. User fills in Supabase Project URL, Anon Key, and a Room Key in
 *      Settings.  All three are required.
 *   2. The Room Key becomes the sync_key primary-key value in the
 *      sync_data table.  Every device sharing the same three credentials
 *      + room key reads and writes the same row.
 *   3. Sync strategy: pull remote JSONB payload -> merge into local IDB
 *      (additive, never deletes) -> push the merged dataset back.
 *   4. Auto-sync fires whenever the device comes back online and on every
 *      data-save if "Auto-sync when connected" is enabled.
 *
 * Required Supabase table (run once in SQL Editor):
 *
 *   CREATE TABLE sync_data (
 *     sync_key   TEXT PRIMARY KEY,
 *     payload    JSONB NOT NULL,
 *     updated_at TIMESTAMPTZ DEFAULT NOW()
 *   );
 *   ALTER TABLE sync_data ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "allow all" ON sync_data
 *     FOR ALL USING (true) WITH CHECK (true);
 * ------------------------------------------------------------------- */
const SyncEngine = (() => {

  let syncConfig = {
    enabled: true,
    syncKey: 'ED-1A-2026',
    supabaseUrl: 'https://dnslnjlpkshmaiwkbjuu.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuc2xuamxwa3NobWFpd2tianV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTAxNTUsImV4cCI6MjEwNTYyNjE1NX0.pv1x2Rqe0eFuODCeqcG2Sgbn17ZYZq2WNioGRd6MidM',
    autoSync: true,
    lastSync: null,
  };

  let status = 'unconfigured'; // 'unconfigured' | 'synced' | 'syncing' | 'offline' | 'error'
  let listeners = [];

  function onStatusChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(fn => fn(getStatus())); }

  function getStatus() {
    return {
      status: !navigator.onLine ? 'offline' : status,
      isOnline: navigator.onLine,
      lastSync: syncConfig.lastSync,
      syncKey: syncConfig.syncKey,
      enabled: syncConfig.enabled,
    };
  }

  // Hardcoded defaults — always used as fallback so sync works out of the box
  const DEFAULTS = {
    enabled:         true,
    syncKey:         syncConfig.syncKey,
    supabaseUrl:     syncConfig.supabaseUrl,
    supabaseAnonKey: syncConfig.supabaseAnonKey,
    autoSync:        true,
  };

  // Config persistence
  async function loadConfig() {
    const saved = await DB.getMeta('syncConfig', null);
    if (saved) {
      syncConfig = {
        ...syncConfig,
        ...saved,
        // Credentials are always locked to hardcoded defaults — never from DB
        supabaseUrl:     DEFAULTS.supabaseUrl,
        supabaseAnonKey: DEFAULTS.supabaseAnonKey,
        // enabled is always true since credentials are hardcoded
        enabled:  DEFAULTS.enabled,
        // User-configurable fields
        syncKey:  saved.syncKey || saved.key || DEFAULTS.syncKey,
        autoSync: saved.autoSync !== undefined ? saved.autoSync
                : saved.auto    !== undefined ? saved.auto : DEFAULTS.autoSync,
      };
    } else {
      syncConfig = { ...syncConfig, ...DEFAULTS };
    }
    status = _isFullyConfigured()
      ? (navigator.onLine ? 'synced' : 'offline')
      : 'unconfigured';
    notify();
  }

  async function saveConfig(cfg) {
    syncConfig = {
      ...syncConfig,
      ...cfg,
      // Always lock credentials to hardcoded values even when user clicks Save
      supabaseUrl:     DEFAULTS.supabaseUrl,
      supabaseAnonKey: DEFAULTS.supabaseAnonKey,
    };
    await DB.setMeta('syncConfig', syncConfig);
    status = _isFullyConfigured() ? 'synced' : 'unconfigured';
    notify();
  }

  function _isFullyConfigured() {
    return !!(
      syncConfig.enabled &&
      syncConfig.syncKey &&
      syncConfig.supabaseUrl &&
      syncConfig.supabaseAnonKey
    );
  }

  // Supabase REST helpers
  function _sbHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': syncConfig.supabaseAnonKey,
      'Authorization': 'Bearer ' + syncConfig.supabaseAnonKey,
      'Prefer': 'return=minimal',
    };
  }

  // GET the payload for this room key (returns null if not found)
  async function _sbPull() {
    const base = syncConfig.supabaseUrl.replace(/\/$/, '');
    const url = base + '/rest/v1/sync_data?sync_key=eq.' +
      encodeURIComponent(syncConfig.syncKey) + '&select=payload';
    const res = await fetch(url, { method: 'GET', headers: _sbHeaders() });
    if (!res.ok) throw new Error('Supabase pull failed: ' + res.status + ' ' + res.statusText);
    const rows = await res.json();
    return (rows && rows.length > 0) ? rows[0].payload : null;
  }

  // UPSERT the payload for this room key
  async function _sbPush(data) {
    const base = syncConfig.supabaseUrl.replace(/\/$/, '');
    const url = base + '/rest/v1/sync_data';
    const headers = {
      ..._sbHeaders(),
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    };
    const body = JSON.stringify({
      sync_key: syncConfig.syncKey,
      payload: data,
      updated_at: new Date().toISOString(),
    });
    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('Supabase push failed: ' + res.status + ' ' + errText);
    }
  }

  // Gather full local dataset
  async function gatherLocalData() {
    return {
      version: 2,
      syncKey: syncConfig.syncKey,
      timestamp: new Date().toISOString(),
      students: await DB.getAll('students'),
      subjects: await DB.getAll('subjects'),
      timetable: await DB.getAll('timetable'),
      attendance: await DB.getAll('attendance'),
      meta: {
        classInfo: await DB.getMeta('classInfo', {}),
        threshold: await DB.getMeta('threshold', 75),
        allocatedPeriods: await DB.getMeta('allocatedPeriods', {}),
      },
    };
  }

  // Additive merge — never removes local records
  async function mergeRemoteData(remote) {
    if (!remote) return 0;
    let newCount = 0;

    // Students
    if (Array.isArray(remote.students)) {
      const local = await DB.getAll('students');
      const localIds = new Set(local.map(s => s.id));
      for (const s of remote.students) {
        if (!localIds.has(s.id)) { await DB.put('students', s); newCount++; }
      }
    }

    // Subjects
    if (Array.isArray(remote.subjects)) {
      const local = await DB.getAll('subjects');
      const localCodes = new Set(local.map(s => s.code));
      for (const su of remote.subjects) {
        if (!localCodes.has(su.code)) { await DB.put('subjects', su); newCount++; }
      }
    }

    // Attendance — merge by key; prefer newer importedAt
    if (Array.isArray(remote.attendance)) {
      const local = await DB.getAll('attendance');
      const localMap = new Map(local.map(a => [a.key, a]));
      for (const a of remote.attendance) {
        const existing = localMap.get(a.key);
        if (!existing) {
          await DB.put('attendance', a); newCount++;
        } else if (a.importedAt && (!existing.importedAt || a.importedAt > existing.importedAt)) {
          await DB.put('attendance', a); newCount++;
        }
      }
    }

    // Meta — remote only fills in keys that are empty locally
    if (remote.meta && remote.meta.allocatedPeriods) {
      const localAlloc = await DB.getMeta('allocatedPeriods', {});
      await DB.setMeta('allocatedPeriods', Object.assign({}, remote.meta.allocatedPeriods, localAlloc));
    }

    return newCount;
  }

  // Main sync routine
  async function syncNow() {
    if (!_isFullyConfigured()) {
      const msg = (!syncConfig.supabaseUrl || !syncConfig.supabaseAnonKey)
        ? 'Please enter your Supabase URL and Anon Key in Settings first.'
        : 'Please set a Room Key in Settings first.';
      return { success: false, message: msg };
    }
    if (!navigator.onLine) {
      status = 'offline';
      notify();
      return { success: false, message: 'Device is offline. Changes are saved locally.' };
    }

    status = 'syncing';
    notify();

    try {
      // PULL
      let mergedCount = 0;
      try {
        const remoteData = await _sbPull();
        if (remoteData && remoteData.version) {
          mergedCount = await mergeRemoteData(remoteData);
        }
      } catch (pullErr) {
        console.warn('Sync pull error (will still push):', pullErr);
        const s = String(pullErr);
        if (s.includes('401') || s.includes('403')) {
          status = 'error'; notify();
          return { success: false, message: 'Auth error — check your Supabase URL and Anon Key.' };
        }
      }

      // PUSH
      const unified = await gatherLocalData();
      await _sbPush(unified);

      syncConfig.lastSync = new Date().toISOString();
      await DB.setMeta('syncConfig', syncConfig);
      status = 'synced';
      notify();
      return {
        success: true,
        message: mergedCount > 0
          ? 'Synced! ' + mergedCount + ' new record(s) pulled from other devices.'
          : 'Synced — already up to date.',
      };
    } catch (err) {
      console.error('Sync failed:', err);
      status = 'error';
      notify();
      const msg = String(err.message || err);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        return { success: false, message: 'Network error — check your internet connection and Supabase URL.' };
      }
      return { success: false, message: 'Sync error: ' + msg };
    }
  }

  // Auto-sync triggered on data changes
  function autoSync() {
    if (syncConfig.enabled && syncConfig.autoSync && navigator.onLine) {
      syncNow().catch(err => console.warn('AutoSync background error:', err));
    }
  }

  // Network event listeners
  function init() {
    window.addEventListener('online', () => {
      notify();
      if (syncConfig.enabled && syncConfig.autoSync) syncNow();
    });
    window.addEventListener('offline', () => {
      status = 'offline';
      notify();
    });
    loadConfig();
  }

  return { init, getStatus, loadConfig, saveConfig, syncNow, autoSync, onStatusChange };
})();

// Expose to window so app.js window.SyncEngine checks work.
// Top-level `const` does not become a window property in browsers — only `var` does.
window.SyncEngine = SyncEngine;
