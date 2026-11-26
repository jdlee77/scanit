// Kit record: every rule about Kits and Items lives here.
// Pure: no page, camera or storage access. The caller passes in the time ("now"),
// and the whole record turns into one plain JSON document for the Store.

const newId = () => globalThis.crypto.randomUUID();
const copy = value => structuredClone(value);

export class KitRecord {
  #kits;

  constructor(doc = { kits: [] }) {
    this.#kits = copy(doc.kits ?? []);
  }

  static fromJSON(doc) {
    return new KitRecord(doc);
  }

  toJSON() {
    return { kits: copy(this.#kits) };
  }

  /** All Kits, in the order they were created. */
  kits() {
    return copy(this.#kits);
  }

  /** One Kit, or undefined. */
  kit(id) {
    const kit = this.#find(id);
    return kit && copy(kit);
  }

  createKit(name, now) {
    const clean = String(name ?? "").trim();
    if (!clean) throw new Error("A Kit needs a name");
    const kit = { id: newId(), name: clean, createdAt: now, items: [] };
    this.#kits.push(kit);
    return copy(kit);
  }

  /**
   * Add an Item to a Kit. Returns an outcome rather than throwing:
   *   { outcome: "added", item }
   *   { outcome: "refused", reason }
   */
  addItem(kitId, serial, now) {
    const kit = this.#find(kitId);
    if (!kit) throw new Error(`No Kit with id ${kitId}`);
    const clean = String(serial ?? "").trim();
    if (!clean) return { outcome: "refused", reason: "A Serial is required" };
    const item = { id: newId(), serial: clean, scannedAt: now };
    kit.items.push(item);
    return { outcome: "added", item: copy(item) };
  }

  #find(id) {
    return this.#kits.find(k => k.id === id);
  }
}
