// Store: keeps the Kit record's JSON document in the browser's IndexedDB.
// A thin adapter with no rules of its own; the whole document is saved after every change.

const DB_NAME = "scanit";
const OBJECT_STORE = "documents";
const KEY = "record";

export async function openStore() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(OBJECT_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const run = (mode, act) => new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, mode);
    const request = act(tx.objectStore(OBJECT_STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

  return {
    /** The saved document, or undefined on first use. */
    load: async () => {
      const text = await run("readonly", objects => objects.get(KEY));
      return text === undefined ? undefined : JSON.parse(text);
    },
    save: doc => run("readwrite", objects => objects.put(JSON.stringify(doc), KEY)),
  };
}
