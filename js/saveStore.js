// Where saves live: IndexedDB in the browser (localStorage holds only ~5 MB; a town of bricks
// can be bigger). Two stores: small summaries for the menu, and the full games.
// Slots: 'auto' (autosave), '1'–'3' (yours), 'import' (a file you opened, until you load it).
const DB = 'handmade', META = 'meta', DATA = 'data';
let dbp = null;

function open() {
  dbp ??= new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'slot' });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: 'slot' });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dbp = null; rej(rq.error); };
  });
  return dbp;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error || new Error('Saving failed')); });
const result = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

export async function listSaves() {
  const db = await open();
  const all = await result(db.transaction(META).objectStore(META).getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function writeSave(slot, meta, data) {
  const db = await open();
  const tx = db.transaction([META, DATA], 'readwrite');
  tx.objectStore(META).put({ ...meta, slot });
  tx.objectStore(DATA).put({ slot, data });
  await done(tx);
}

export async function readSave(slot) {
  const db = await open();
  const rec = await result(db.transaction(DATA).objectStore(DATA).get(slot));
  return rec?.data ?? null;
}

export async function deleteSave(slot) {
  const db = await open();
  const tx = db.transaction([META, DATA], 'readwrite');
  tx.objectStore(META).delete(slot);
  tx.objectStore(DATA).delete(slot);
  await done(tx);
}
