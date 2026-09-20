/* ---------------------------------------------------------------------
 * IndexedDB data layer for the CR Attendance app.
 * Everything here is offline: no network calls, ever.
 * ------------------------------------------------------------------- */
const DB = (() => {
  const DB_NAME = 'cr_attendance_db';
  const DB_VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('students')) {
          db.createObjectStore('students', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('subjects')) {
          db.createObjectStore('subjects', { keyPath: 'code' });
        }
        if (!db.objectStoreNames.contains('timetable')) {
          const tt = db.createObjectStore('timetable', { keyPath: 'id', autoIncrement: true });
          tt.createIndex('day', 'day', { unique: false });
        }
        if (!db.objectStoreNames.contains('attendance')) {
          const at = db.createObjectStore('attendance', { keyPath: 'key' });
          at.createIndex('studentId', 'studentId', { unique: false });
          at.createIndex('date', 'date', { unique: false });
          at.createIndex('subjectCode', 'subjectCode', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('imports')) {
          db.createObjectStore('imports', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbp;
  }

  function tx(storeNames, mode = 'readonly') {
    return open().then((db) => db.transaction(storeNames, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(store) {
    const t = await tx([store]);
    return reqToPromise(t.objectStore(store).getAll());
  }

  async function get(store, key) {
    const t = await tx([store]);
    return reqToPromise(t.objectStore(store).get(key));
  }

  async function put(store, value) {
    const t = await tx([store], 'readwrite');
    const r = reqToPromise(t.objectStore(store).put(value));
    return r;
  }

  async function putMany(store, values) {
    const t = await tx([store], 'readwrite');
    const os = t.objectStore(store);
    values.forEach((v) => os.put(v));
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function del(store, key) {
    const t = await tx([store], 'readwrite');
    return reqToPromise(t.objectStore(store).delete(key));
  }

  async function clearStore(store) {
    const t = await tx([store], 'readwrite');
    return reqToPromise(t.objectStore(store).clear());
  }

  async function getMeta(key, fallback = null) {
    const rec = await get('meta', key);
    return rec ? rec.value : fallback;
  }

  async function setMeta(key, value) {
    return put('meta', { key, value });
  }

  return { open, getAll, get, put, putMany, del, clearStore, getMeta, setMeta };
})();
