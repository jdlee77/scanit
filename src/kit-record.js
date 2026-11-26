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
export const NEEDS_CONFIRMING = "needs confirming";
const refused = reason => ({ outcome: REFUSED, reason });
const done = extra => ({ outcome: DONE, ...extra });
const listOf = names => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

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

  /** One Item in a Kit, or undefined. */
  item(kitId, itemId) {
    const item = this.#findKit(kitId)?.items.find(i => i.id === itemId);
    return item && copy(item);
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

  /** Rename a Kit: { outcome: "done" } or { outcome: "refused", reason }. */
  renameKit(kitId, name) {
    const kit = this.#kitOrThrow(kitId);
    const clean = cleanText(name);
    if (!clean) return refused("A Kit needs a name.");
    kit.name = clean;
    return done();
  }

  /** Set a Kit's Notes (any number of lines). Blank Notes are removed. */
  setKitNotes(kitId, notes) {
    const kit = this.#kitOrThrow(kitId);
    const clean = cleanText(notes);
    if (clean) kit.notes = clean;
    else delete kit.notes;
    return done();
  }

  /** Delete a Kit and every Item in it. */
  deleteKit(kitId) {
    this.#kitOrThrow(kitId);
    this.#kits = this.#kits.filter(k => k.id !== kitId);
    return done();
  }

  /**
   * Add an Item to a Kit. Outcomes:
   * - { outcome: "added", item }
   * - { outcome: "refused", reason }: no Serial, or the Serial is already in this Kit
   * - { outcome: "needs confirming", reason, kitNames }: the Serial is already in another Kit;
   *   call again with confirmed: true to add it anyway.
   * format: the code format the Serial was read from (kept for reference, not exported);
   * leave it out for a typed Serial. values: { [fieldId]: text }; only the Serial is required.
   * Each new value joins its Field's Pick list.
   */
  addItem(kitId, serial, now, { format, values = {}, confirmed = false } = {}) {
    const kit = this.#kitOrThrow(kitId);
    const clean = cleanText(serial);
    const problem = this.#serialProblem(kit, clean, null, confirmed);
    if (problem) return problem;
    const item = { id: newId(), serial: clean, scannedAt: now, values: this.#cleanValues(values), ...(format && { format }) };
    this.#growPickLists(item.values);
    kit.items.push(item);
    return { outcome: ADDED, item: copy(item) };
  }

  /**
   * Change a saved Item's Serial and Field values. It keeps its place in scan order and its
   * scanned-at time. Same outcomes and duplicate rules as addItem, with "done" for success.
   * A changed Serial no longer counts as read from a code, so its format is dropped.
   */
  editItem(kitId, itemId, serial, { values = {}, confirmed = false } = {}) {
    const kit = this.#kitOrThrow(kitId);
    const item = this.#itemOrThrow(kit, itemId);
    const clean = cleanText(serial);
    const problem = this.#serialProblem(kit, clean, item, confirmed);
    if (problem) return problem;
    if (clean !== item.serial) delete item.format;
    item.serial = clean;
    item.values = this.#cleanValues(values);
    this.#growPickLists(item.values);
    return done({ item: copy(item) });
  }

  /** Delete an Item from its Kit. */
  deleteItem(kitId, itemId) {
    const kit = this.#kitOrThrow(kitId);
    this.#itemOrThrow(kit, itemId);
    kit.items = kit.items.filter(i => i.id !== itemId);
    return done();
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

  /** A Field's Pick list values to offer: those containing what's typed (any case), not one already chosen. */
  matchingPicks(fieldId, typed) {
    const text = cleanText(typed).toLocaleLowerCase();
    return this.fields().find(f => f.id === fieldId).picks
      .filter(p => p.toLocaleLowerCase().includes(text) && !sameText(p, text));
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

  #kitOrThrow(id) {
    const kit = this.#findKit(id);
    if (!kit) throw new Error(`No Kit with id ${id}`);
    return kit;
  }

  #itemOrThrow(kit, id) {
    const item = kit.items.find(i => i.id === id);
    if (!item) throw new Error(`No Item with id ${id} in Kit ${kit.id}`);
    return item;
  }

  /**
   * Why this Serial can't be saved to this Kit as it stands, or null if it can.
   * A Serial matches only exactly (after trimming): serial numbers can differ by case alone.
   * except: the Item being edited, which doesn't count as a duplicate of itself, and whose
   * unchanged Serial isn't asked about again.
   */
  #serialProblem(kit, serial, except, confirmed) {
    if (!serial) return refused("A Serial is required: type one in, then Save.");
    if (kit.items.some(i => i !== except && i.serial === serial)) {
      return refused(`${serial} is already in this Kit, so it wasn't saved again.`);
    }
    // An Item whose Serial isn't changing was already confirmed (or wasn't a duplicate) when saved.
    if (confirmed || except?.serial === serial) return null;
    const kitNames = this.#kits.filter(k => k !== kit && k.items.some(i => i.serial === serial)).map(k => k.name);
    if (kitNames.length) {
      return { outcome: NEEDS_CONFIRMING, kitNames,
        reason: `${serial} is already in ${listOf(kitNames)}. Save it in ${kit.name} as well?` };
    }
    return null;
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
