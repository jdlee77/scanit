// Kit record: every rule about Kits and Items lives here.
// Pure: no page, camera or storage access. The caller passes in the time ("now"),
// and the whole record turns into one plain JSON document for the Store.

const newId = () => globalThis.crypto.randomUUID();
const copy = value => structuredClone(value);
const cleanText = value => String(value ?? "").trim();

export const ADDED = "added";
export const REFUSED = "refused";
const refused = reason => ({ outcome: REFUSED, reason });

export class KitRecord {
  #kits;

  constructor(doc) {
    this.#kits = copy(doc?.kits ?? []);
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

  /**
   * Create a Kit. Like addItem, returns an outcome rather than throwing:
   *   { outcome: "added", kit } or { outcome: "refused", reason }
   * A reason is a sentence ready to show the user.
   */
  createKit(name, now) {
    const clean = cleanText(name);
    if (!clean) return refused("Give the Kit a name first.");
    const kit = { id: newId(), name: clean, createdAt: now, items: [] };
    this.#kits.push(kit);
    return { outcome: ADDED, kit: copy(kit) };
  }

  /**
   * Add an Item to a Kit. Returns an outcome rather than throwing:
   *   { outcome: "added", item } or { outcome: "refused", reason }
   * format: the code format the Serial was read from (kept for reference, not exported);
   * leave it out for a typed Serial.
   */
  addItem(kitId, serial, now, { format } = {}) {
    const kit = this.#find(kitId);
    if (!kit) throw new Error(`No Kit with id ${kitId}`);
    const clean = cleanText(serial);
    if (!clean) return refused("A Serial is required: type one in, then Save.");
    const item = { id: newId(), serial: clean, scannedAt: now, ...(format && { format }) };
    kit.items.push(item);
    return { outcome: ADDED, item: copy(item) };
  }

  #find(id) {
    return this.#kits.find(k => k.id === id);
  }
}
