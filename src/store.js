// Store: keeps the Kit record's JSON document in the browser's IndexedDB.
// A thin adapter with no rules of its own; the whole document is saved after every change.

const DB_NAME = "scanit";
const TABLE = "documents";
const KEY = "record";

export async function openStore() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const run = (mode, act) => new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, mode);
    const request = act(tx.objectStore(TABLE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

  return {
    /** The saved document, or undefined on first use. */
    load: async () => {
      const text = await run("readonly", table => table.get(KEY));
      return text === undefined ? undefined : JSON.parse(text);
    },
    save: doc => run("readwrite", table => table.put(JSON.stringify(doc), KEY)),
  };
}
