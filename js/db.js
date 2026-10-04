// 기기 저장소(IndexedDB). 서버 없이 이 기기 안에서 완결된다.
// 조각(memos)은 시작할 때 전부 메모리에 올려 두고 쓰기만 DB로 보낸다 (수만 개까지 충분).
const DB_NAME = 'jogakbo';
const VERSION = 1;

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('memos')) db.createObjectStore('memos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAll = (store) => tx(store, 'readonly', (s) => reqP(s.getAll()));
export const put = (store, value, key) => tx(store, 'readwrite', (s) => { s.put(value, key); });
export const putMany = (store, values) => tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); });
export const del = (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); });
export const get = (store, key) => tx(store, 'readonly', (s) => reqP(s.get(key)));

// 브라우저가 저장 공간이 부족할 때 임의로 지우지 않도록 요청 (웹 전용, 앱은 해당 없음)
export async function askPersist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
