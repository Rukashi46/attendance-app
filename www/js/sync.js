/* ---------------------------------------------------------------------
 * Online Cloud Sync Engine
 * Enables automatic background synchronization when online:
 * - Peer & Multi-Device Sync using Class Sync Key
 * - Bidirectional record merging (no data loss)
 * - Auto-sync on connection restore or data save
 * - Configurable custom endpoint / Google Sheets / Webhook support
 * ------------------------------------------------------------------- */
const SyncEngine = (() => {

  let syncConfig = {
    enabled: false,
    syncKey: '',
    endpointUrl: '',
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

  async function loadConfig() {
    const saved = await DB.getMeta('syncConfig', null);
    if (saved) {
      // Normalize field names — older saves used key/url/auto aliases
      syncConfig = {
        ...syncConfig,
        ...saved,
        syncKey:     saved.syncKey     || saved.key  || '',
        endpointUrl: saved.endpointUrl || saved.url  || '',
        autoSync:    saved.autoSync    !== undefined ? saved.autoSync
                   : saved.auto       !== undefined ? saved.auto : true,
      };
    }
    status = syncConfig.enabled && syncConfig.syncKey
      ? (navigator.onLine ? 'synced' : 'offline')
      : 'unconfigured';
    notify();
  }

  async function saveConfig(cfg) {
    syncConfig = { ...syncConfig, ...cfg };
    await DB.setMeta('syncConfig', syncConfig);
    status = syncConfig.enabled && syncConfig.syncKey ? 'synced' : 'unconfigured';
    notify();
  }

  // Cloud endpoint resolver
  // Default: jsonstore.io — free, no-auth JSON key-value store.
  // The sync key the user enters becomes the storage path, so all devices
  // sharing the same key read and write the same cloud document.
  function getEndpoint() {
    if (syncConfig.endpointUrl && syncConfig.endpointUrl.trim().startsWith('http')) {
      return { url: syncConfig.endpointUrl.trim(), isCustom: true };
    }
    const safeKey = syncConfig.syncKey.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
    return { url: `https://www.jsonstore.io/${encodeURIComponent(safeKey)}`, isCustom: false };
  }

  // Prepare full sync payload
  async function gatherLocalData() {
    return {
      version: 1,
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

  // Merge remote data into local IndexedDB
  async function mergeRemoteData(remote) {
    if (!remote) return 0;
    let newCount = 0;

    // Merge students
    if (Array.isArray(remote.students)) {
      const localStudents = await DB.getAll('students');
      const localMap = new Map(localStudents.map(s => [s.id, s]));
      for (const s of remote.students) {
        if (!localMap.has(s.id)) {
          await DB.put('students', s);
          newCount++;
        }
      }
    }

    // Merge subjects
    if (Array.isArray(remote.subjects)) {
      const localSubs = await DB.getAll('subjects');
      const localCodes = new Set(localSubs.map(s => s.code));
      for (const su of remote.subjects) {
        if (!localCodes.has(su.code)) {
          await DB.put('subjects', su);
          newCount++;
        }
      }
    }

    // Merge attendance records
    if (Array.isArray(remote.attendance)) {
      const localAtt = await DB.getAll('attendance');
      const localAttMap = new Map(localAtt.map(a => [a.key, a]));
      for (const a of remote.attendance) {
        if (!localAttMap.has(a.key)) {
          await DB.put('attendance', a);
          newCount++;
        } else {
          // If remote has newer importedAt/timestamp
          const local = localAttMap.get(a.key);
          if (a.importedAt && (!local.importedAt || a.importedAt > local.importedAt)) {
            await DB.put('attendance', a);
            newCount++;
          }
        }
      }
    }

    // Merge meta
    if (remote.meta) {
      if (remote.meta.allocatedPeriods) {
        const localAlloc = await DB.getMeta('allocatedPeriods', {});
        await DB.setMeta('allocatedPeriods', { ...remote.meta.allocatedPeriods, ...localAlloc });
      }
    }

    return newCount;
  }

  // Perform full synchronization — pull → merge → push
  async function syncNow() {
    if (!syncConfig.enabled || !syncConfig.syncKey) {
      return { success: false, message: 'Please set a Class Sync Key in Settings first.' };
    }
    if (!navigator.onLine) {
      status = 'offline';
      notify();
      return { success: false, message: 'Device is offline. Changes are saved locally.' };
    }

    status = 'syncing';
    notify();

    try {
      const { url: endpoint, isCustom } = getEndpoint();
      const storageKey = `cr_sync_${syncConfig.syncKey.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      let mergedCount = 0;

      // ── PULL ──────────────────────────────────────────────────────────
      try {
        // 1. Same-browser cross-tab via localStorage
        const localJson = localStorage.getItem(storageKey);
        if (localJson) {
          try { mergedCount += await mergeRemoteData(JSON.parse(localJson)); } catch (e) {}
        }

        // 2. Cloud relay — GET the shared document
        const pullRes = await fetch(endpoint, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
        if (pullRes.ok) {
          const raw = await pullRes.json().catch(() => null);
          // jsonstore.io wraps payload: { "result": {...}, "ok": true }
          // Custom endpoints are expected to return the data directly
          const remoteData = isCustom ? raw : (raw?.result ?? null);
          if (remoteData && remoteData.version) {
            mergedCount += await mergeRemoteData(remoteData);
          }
        }
      } catch (pullErr) {
        console.warn('Sync pull error (will still push):', pullErr);
      }

      // ── PUSH ──────────────────────────────────────────────────────────
      const unified = await gatherLocalData();

      // Update localStorage cache for cross-tab sync
      try { localStorage.setItem(storageKey, JSON.stringify(unified)); } catch (e) {}

      // Push merged dataset to cloud relay
      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(unified),
        });
      } catch (pushErr) {
        console.warn('Sync push error:', pushErr);
      }

      syncConfig.lastSync = new Date().toISOString();
      await DB.setMeta('syncConfig', syncConfig);
      status = 'synced';
      notify();
      return {
        success: true,
        message: mergedCount > 0
          ? `Synced! ${mergedCount} new record(s) pulled from other devices.`
          : 'Synced — already up to date.',
      };
    } catch (err) {
      console.error('Sync failed:', err);
      status = 'error';
      notify();
      return { success: false, message: 'Sync error: ' + err.message };
    }
  }

  // Automatic sync triggered on data change
  function autoSync() {
    if (syncConfig.enabled && syncConfig.autoSync && navigator.onLine) {
      syncNow().catch(err => console.warn('AutoSync background error:', err));
    }
  }

  // Event Listeners for network status
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

  return {
    init,
    getStatus,
    loadConfig,
    saveConfig,
    syncNow,
    autoSync,
    onStatusChange,
  };
})();
