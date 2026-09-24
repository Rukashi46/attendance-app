/* ---------------------------------------------------------------------
 * Cloud Sync Engine — Supabase backend
 *
 * How it works:
 *   1. User fills in a Room Key in Settings.
 *   2. The Room Key becomes the sync_key primary-key value in the
 *      sync_data table. Every device sharing the same room key reads
 *      and writes the same row.
 *   3. Sync strategy: pull remote JSONB payload -> merge into local IDB
 *      (additive, never deletes) -> push the merged dataset back.
 *   4. Auto-sync fires on app launch, whenever the device comes online,
 *      on app resume/focus, periodically every 25s, and on every data save.
 * ------------------------------------------------------------------- */
const SyncEngine = (() => {

  let syncConfig = {
    enabled: false,
    syncKey: '',
    supabaseUrl: 'https://dnslnjlpkshmaiwkbjuu.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuc2xuamxwa3NobWFpd2tianV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTAxNTUsImV4cCI6MjEwNTYyNjE1NX0.pv1x2Rqe0eFuODCeqcG2Sgbn17ZYZq2WNioGRd6MidM',
    autoSync: true,
    lastSync: null,
  };

  let status = 'unconfigured'; // 'unconfigured' | 'synced' | 'syncing' | 'offline' | 'error'
  let listeners = [];
  let pollInterval = null;

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

  // Hardcoded Supabase credentials — syncKey defaults to empty so fresh installs
  // have NO pre-filled key until the user enters their own.
  const DEFAULTS = {
    enabled:         false,
    syncKey:         '',
    supabaseUrl:     'https://dnslnjlpkshmaiwkbjuu.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuc2xuamxwa3NobWFpd2tianV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTAxNTUsImV4cCI6MjEwNTYyNjE1NX0.pv1x2Rqe0eFuODCeqcG2Sgbn17ZYZq2WNioGRd6MidM',
    autoSync:        true,
  };

  // Config persistence — once a key is entered, it stays permanently in IndexedDB
  async function loadConfig() {
    const saved = await DB.getMeta('syncConfig', null);
    if (saved) {
      const savedKey = (saved.syncKey || saved.key || '').trim();
      syncConfig = {
        ...syncConfig,
        ...saved,
        supabaseUrl:     DEFAULTS.supabaseUrl,
        supabaseAnonKey: DEFAULTS.supabaseAnonKey,
        syncKey:         savedKey,
        enabled:         !!savedKey && (saved.enabled !== false),
        autoSync:        saved.autoSync !== undefined ? saved.autoSync
                       : saved.auto    !== undefined ? saved.auto : DEFAULTS.autoSync,
      };
    } else {
      syncConfig = { ...syncConfig, ...DEFAULTS };
    }
    status = _isFullyConfigured()
      ? (navigator.onLine ? 'synced' : 'offline')
      : 'unconfigured';
    notify();

    // Auto-sync immediately on load if configured and online
    if (_isFullyConfigured() && syncConfig.autoSync && navigator.onLine) {
      syncNow().catch(err => console.warn('Auto-sync on load error:', err));
    }
  }

  async function saveConfig(cfg) {
    const rawKey = (cfg.syncKey || cfg.key || '').trim();
    syncConfig = {
      ...syncConfig,
      ...cfg,
      syncKey: rawKey,
      enabled: !!rawKey && (cfg.enabled !== false),
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

  // Additive merge — synchronizes students, subjects, timetable, attendance, and metadata
  async function mergeRemoteData(remote) {
    if (!remote) return 0;
    let newCount = 0;

    // Students
    if (Array.isArray(remote.students)) {
      const local = await DB.getAll('students');
      const localMap = new Map(local.map(s => [s.id, s]));
      for (const s of remote.students) {
        const existing = localMap.get(s.id);
        if (!existing) {
          await DB.put('students', s);
          newCount++;
        } else {
          let changed = false;
          const merged = { ...existing };
          if (s.name && s.name !== existing.name) { merged.name = s.name; changed = true; }
          if (s.rollNo && s.rollNo !== existing.rollNo) { merged.rollNo = s.rollNo; changed = true; }
          if (s.regNo && s.regNo !== existing.regNo) { merged.regNo = s.regNo; changed = true; }
          if (s.active !== undefined && s.active !== existing.active) { merged.active = s.active; changed = true; }
          if (changed) {
            await DB.put('students', merged);
            newCount++;
          }
        }
      }
    }

    // Subjects
    if (Array.isArray(remote.subjects)) {
      const local = await DB.getAll('subjects');
      const localMap = new Map(local.map(su => [su.code, su]));
      for (const su of remote.subjects) {
        const existing = localMap.get(su.code);
        if (!existing) {
          await DB.put('subjects', su);
          newCount++;
        } else if (su.name && (!existing.name || existing.name === existing.code)) {
          await DB.put('subjects', { ...existing, name: su.name });
          newCount++;
        }
      }
    }

    // Timetable
    if (Array.isArray(remote.timetable) && remote.timetable.length > 0) {
      const localTt = await DB.getAll('timetable');
      if (localTt.length === 0) {
        await DB.putMany('timetable', remote.timetable.map(t => {
          const { id, ...rest } = t;
          return rest;
        }));
        newCount += remote.timetable.length;
      }
    }

    // Attendance — merge by key; prefer newer updates
    if (Array.isArray(remote.attendance)) {
      const local = await DB.getAll('attendance');
      const localMap = new Map(local.map(a => [a.key, a]));
      for (const a of remote.attendance) {
        const existing = localMap.get(a.key);
        if (!existing) {
          await DB.put('attendance', a);
          newCount++;
        } else {
          const remoteTime = a.importedAt || '0';
          const localTime = existing.importedAt || '0';
          if (a.status !== existing.status && remoteTime >= localTime) {
            await DB.put('attendance', { ...existing, ...a });
            newCount++;
          }
        }
      }
    }

    // Meta — classInfo, threshold, allocatedPeriods
    if (remote.meta) {
      if (remote.meta.allocatedPeriods) {
        const localAlloc = await DB.getMeta('allocatedPeriods', {});
        await DB.setMeta('allocatedPeriods', Object.assign({}, remote.meta.allocatedPeriods, localAlloc));
      }
      if (remote.meta.classInfo && Object.keys(remote.meta.classInfo).length > 0) {
        const localClassInfo = await DB.getMeta('classInfo', {});
        if (!localClassInfo || Object.keys(localClassInfo).length === 0 || !localClassInfo.className) {
          await DB.setMeta('classInfo', remote.meta.classInfo);
          newCount++;
        }
      }
      if (remote.meta.threshold !== undefined) {
        const localThreshold = await DB.getMeta('threshold', null);
        if (localThreshold === null) {
          await DB.setMeta('threshold', remote.meta.threshold);
        }
      }
    }

    return newCount;
  }

  // Main sync routine
  async function syncNow() {
    if (!_isFullyConfigured()) {
      const msg = (!syncConfig.supabaseUrl || !syncConfig.supabaseAnonKey)
        ? 'Please enter your Supabase URL and Anon Key in Settings first.'
        : 'Please enter a Room Key in Settings first to sync with other devices.';
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

      if (mergedCount > 0) {
        window.dispatchEvent(new CustomEvent('app:data-synced', { detail: { count: mergedCount } }));
      }

      return {
        success: true,
        message: mergedCount > 0
          ? 'Synced! ' + mergedCount + ' update(s) pulled from cloud.'
          : 'Synced — already up to date.',
      };
    } catch (err) {
      console.error('Sync failed:', err);
      status = 'error';
      notify();
      const msg = String(err.message || err);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        return { success: false, message: 'Network error — check your internet connection.' };
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

  // Background polling to keep multiple devices in sync automatically
  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && _isFullyConfigured() && syncConfig.autoSync && navigator.onLine && status !== 'syncing') {
        syncNow().catch(err => console.warn('Background sync poll error:', err));
      }
    }, 25000);
  }

  // Event listeners
  function init() {
    window.addEventListener('online', () => {
      notify();
      if (_isFullyConfigured() && syncConfig.autoSync) syncNow();
    });
    window.addEventListener('offline', () => {
      status = 'offline';
      notify();
    });

    // Auto-sync when returning to the app
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && _isFullyConfigured() && syncConfig.autoSync && navigator.onLine) {
        syncNow().catch(err => console.warn('Visibility sync error:', err));
      }
    });
    window.addEventListener('focus', () => {
      if (_isFullyConfigured() && syncConfig.autoSync && navigator.onLine) {
        syncNow().catch(err => console.warn('Focus sync error:', err));
      }
    });

    // Capacitor native resume listener
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      try {
        window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
          if (state && state.isActive && _isFullyConfigured() && syncConfig.autoSync && navigator.onLine) {
            syncNow().catch(err => console.warn('Capacitor resume sync error:', err));
          }
        });
      } catch (e) { /* ignore */ }
    }

    startPolling();
    loadConfig();
  }

  return { init, getStatus, loadConfig, saveConfig, syncNow, autoSync, onStatusChange };
})();

// Expose to window so app.js window.SyncEngine checks work.
window.SyncEngine = SyncEngine;
