// Kit record: every rule about Kits, Items, Fields and Pick lists lives here.
// Pure: no page, camera or storage access. The caller passes in the time ("now"),
// and the whole record turns into one plain JSON document for the Store.

const newId = () => globalThis.crypto.randomUUID();
const copy = value => structuredClone(value);
const cleanText = value => String(value ?? "").trim();
const sameText = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const alphabetical = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Outcomes: operations return one of these rather than throwing.
export const ADDED = "added";
export const DONE = "done";
export const REFUSED = "refused";
const refused = reason => ({ outcome: REFUSED, reason });
const done = extra => ({ outcome: DONE, ...extra });

export class KitRecord {
  #kits;
  #fields; // [{ id, name, picks: [value] }], in Settings order

  constructor(doc) {
    this.#kits = copy(doc?.kits ?? []);
    this.#fields = copy(doc?.fields ?? []);
  }

  static fromJSON(doc) {
    return new KitRecord(doc);
  }

  toJSON() {
    return { kits: copy(this.#kits), fields: copy(this.#fields) };
  }

  // ---- Kits and Items --------------------------------------------------------

  /** All Kits, in the order they were created. */
  kits() {
    return copy(this.#kits);
  }

  /** One Kit, or undefined. */
  kit(id) {
    const kit = this.#findKit(id);
    return kit && copy(kit);
  }

  /**
   * Create a Kit: { outcome: "added", kit } or { outcome: "refused", reason }.
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
   * Add an Item to a Kit: { outcome: "added", item } or { outcome: "refused", reason }.
   * format: the code format the Serial was read from (kept for reference, not exported);
   * leave it out for a typed Serial. values: { [fieldId]: text }; only the Serial is required.
   * Each new value joins its Field's Pick list.
   */
  addItem(kitId, serial, now, { format, values = {} } = {}) {
    const kit = this.#findKit(kitId);
    if (!kit) throw new Error(`No Kit with id ${kitId}`);
    const clean = cleanText(serial);
    if (!clean) return refused("A Serial is required: type one in, then Save.");
    const item = { id: newId(), serial: clean, scannedAt: now, values: this.#cleanValues(values), ...(format && { format }) };
    this.#growPickLists(item.values);
    kit.items.push(item);
    return { outcome: ADDED, item: copy(item) };
  }

  /** Field values a new Item in this Kit starts with: the previous Item's, for Fields that still exist. */
  startingValues(kitId) {
    const last = this.#findKit(kitId)?.items.at(-1);
    return this.#cleanValues(last?.values ?? {});
  }

  // ---- Fields and Pick lists -----------------------------------------------

  /** The Fields in Settings order, each with its Pick list in alphabetical order. */
  fields() {
    return this.#fields.map(f => ({ ...copy(f), picks: [...f.picks].sort(alphabetical) }));
  }

  addField(name) {
    const clean = cleanText(name);
    const problem = this.#fieldNameProblem(clean);
    if (problem) return refused(problem);
    const field = { id: newId(), name: clean, picks: [] };
    this.#fields.push(field);
    return { outcome: ADDED, field: copy(field) };
  }

  renameField(fieldId, name) {
    const field = this.#findField(fieldId);
    const clean = cleanText(name);
    const problem = this.#fieldNameProblem(clean, field);
    if (problem) return refused(problem);
    field.name = clean;
    return done();
  }

  /** Move a Field to a new position in Settings order (0 is first). */
  moveField(fieldId, toIndex) {
    const field = this.#findField(fieldId);
    this.#fields.splice(this.#fields.indexOf(field), 1);
    this.#fields.splice(Math.max(0, Math.min(toIndex, this.#fields.length)), 0, field);
    return done();
  }

  /** Remove a Field. Its values go from every Item too, so they no longer appear in Exports. */
  removeField(fieldId) {
    this.#fields = this.#fields.filter(f => f.id !== fieldId);
    for (const kit of this.#kits) for (const item of kit.items) delete item.values?.[fieldId];
    return done();
  }

  /** Rename a Pick list value. Items already saved keep the old value. */
  renamePick(fieldId, value, newValue) {
    const field = this.#findField(fieldId);
    const clean = cleanText(newValue);
    if (!clean) return refused("A Pick list value can't be blank.");
    const others = field.picks.filter(p => p !== value);
    field.picks = others.some(p => sameText(p, clean)) ? others : [...others, clean];
    return done();
  }

  /** Remove a Pick list value. Items already saved keep it. */
  removePick(fieldId, value) {
    const field = this.#findField(fieldId);
    field.picks = field.picks.filter(p => p !== value);
    return done();
  }

  // ---- Settings ----------------------------------------------------------------

  /** The Settings: Fields and their Pick lists, by name. Never any Kits. */
  settings() {
    return { fields: this.fields().map(({ name, picks }) => ({ name, picks })) };
  }

  /**
   * Merge loaded Settings into these: Fields are matched by name; missing Fields and Pick list
   * values are added; nothing is removed, and Kits are never touched.
   * { outcome: "done", added: { fields, values } } or { outcome: "refused", reason }.
   */
  mergeSettings(settings) {
    const incoming = settings?.fields;
    const valid = Array.isArray(incoming) && incoming.every(f =>
      typeof f?.name === "string" && (f.picks === undefined || (Array.isArray(f.picks) && f.picks.every(p => typeof p === "string"))));
    if (!valid) return refused("That isn't a scanit Settings file.");
    const added = { fields: 0, values: 0 };
    for (const { name, picks = [] } of incoming) {
      const clean = cleanText(name);
      if (!clean) continue;
      let field = this.#fields.find(f => sameText(f.name, clean));
      if (!field) {
        field = { id: newId(), name: clean, picks: [] };
        this.#fields.push(field);
        added.fields++;
      }
      for (const value of picks) if (this.#addPick(field, value)) added.values++;
    }
    return done({ added });
  }

  // ---- Inside ------------------------------------------------------------------

  #findKit(id) {
    return this.#kits.find(k => k.id === id);
  }

  #findField(id) {
    const field = this.#fields.find(f => f.id === id);
    if (!field) throw new Error(`No Field with id ${id}`);
    return field;
  }

  #fieldNameProblem(name, except) {
    if (!name) return "Give the Field a name first.";
    if (this.#fields.some(f => f !== except && sameText(f.name, name))) return `There's already a Field called ${name}.`;
    return null;
  }

  /** Keep only non-blank values for Fields that exist, trimmed. */
  #cleanValues(values) {
    const clean = {};
    for (const field of this.#fields) {
      const value = cleanText(values[field.id]);
      if (value) clean[field.id] = value;
    }
    return clean;
  }

  #growPickLists(values) {
    for (const field of this.#fields) if (values[field.id]) this.#addPick(field, values[field.id]);
  }

  /** Add a value to a Field's Pick list unless it's already there (ignoring case). True if added. */
  #addPick(field, value) {
    const clean = cleanText(value);
    if (!clean || field.picks.some(p => sameText(p, clean))) return false;
    field.picks.push(clean);
    return true;
  }
}
