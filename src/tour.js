// The tour: a short, step-by-step introduction to scanit, offered on the Kit list to people who
// haven't taken it, and always available from Help. Also the author credit shown around the app.
import { el } from "./dom.js";

export const AUTHOR = { name: "Jon Lee", url: "https://jon-lee.carrd.co/" };

const SEEN_KEY = "scanit.tourOffered";

/**
 * Each step: a title, a sentence or two, a few short points, and optionally a button that opens
 * the screen being described ({ label, href }).
 */
export const TOUR_STEPS = [
  {
    title: "Welcome to scanit",
    intro: "scanit records the equipment in a Kit, such as a radio cache, a laptop cart or a go-bag, "
      + "by scanning each Item's barcode or QR code. When you're done, Export sends it all as one Excel workbook.",
    points: [
      "A Kit is a named group of equipment you record together.",
      "An Item is one piece of equipment, identified by its Serial.",
      "Everything stays on this phone until you Export it.",
    ],
  },
  {
    title: "Set up your Fields",
    intro: "Fields are the details you record for every Item besides its Serial, such as Make, Model or Condition. "
      + "Set them up once in Settings and every Kit uses them.",
    points: [
      "On the Kit list, tap Settings (top right). Type a name under New Field, then tap Add Field.",
      "Use ↑ and ↓ to set the order. The Item form and the Export show Fields in this order.",
      "Rename or remove a Field any time. Removing one also removes its values from saved Items.",
    ],
    action: { label: "Open Settings", href: "#settings" },
  },
  {
    title: "Pick lists and the Settings file",
    intro: "Each Field remembers the values you enter as its Pick list. Next time, tap a value instead of typing it.",
    points: [
      "Pick lists grow by themselves as you record Items.",
      "Fix a typo in Settings: open the Field's Pick list and tap Rename.",
      "Save Settings file to share your Fields and Pick lists with a teammate, who taps Load Settings file "
        + "on their phone. Kits are never part of it.",
    ],
    action: { label: "Open Settings", href: "#settings" },
  },
  {
    title: "Create a Kit",
    intro: "On the Kit list, type a name such as Radio Cache 3 and tap Create Kit.",
    points: [
      "Tap a Kit on the list to open it.",
      "Inside a Kit, Edit Kit lets you rename it and add Notes: where it's kept, who checked it, what's missing.",
      "Notes appear at the top of that Kit's sheet in the Export.",
    ],
    action: { label: "Go to the Kit list", href: "#" },
  },
  {
    title: "Scan Items",
    intro: "Open a Kit, tap Scan, and point the camera at a label so the code sits inside the white box.",
    points: [
      "When it reads a code it beeps, flashes and buzzes, then shows the Item form.",
      "Check the Serial, fill in the Fields, then tap Save & scan next to keep going.",
      "Struggling to read one? Tap the picture to take a still shot, zoom in, turn on the flashlight, or use Take a photo.",
      "No code at all? Tap Type a Serial.",
      "A UPC or EAN (the shop barcode) identifies the product, not this unit. Scan the serial number label instead if there is one.",
    ],
  },
  {
    title: "Values carry over",
    intro: "Each new Item starts with the previous Item's Field values, so a box of identical radios only needs each Serial scanned.",
    points: [
      "Change only what's different, then save.",
      "Only the Serial is required; leave any Field blank.",
    ],
  },
  {
    title: "Fix mistakes",
    intro: "Nothing is final: you can correct a Kit at any time.",
    points: [
      "Tap any Item in a Kit to change its Serial or Fields, or to delete it.",
      "To move an Item to another Kit, delete it, then scan it into the other Kit.",
      "scanit won't save the same Serial twice in one Kit. If it's already in another Kit, it tells you which, "
        + "and you can tap Save anyway.",
      "Delete Kit is under Edit Kit. It asks first, and warns you if the Kit hasn't been exported.",
    ],
  },
  {
    title: "Export and share",
    intro: "The Export is the only copy of your Kits that leaves this phone, so send it often.",
    points: [
      "On the Kit list, tap Export. Untick any Kits to leave out, then tap Export again.",
      "Your phone's Share menu opens: send the workbook by email, Teams, Drive and so on.",
      "The workbook has a Summary sheet, then one sheet per Kit.",
      "Each Kit shows Not exported yet, Exported or Changed since export, and a reminder counts the Kits still to send.",
    ],
  },
  {
    title: "Use it anywhere",
    intro: "After your first visit, scanit works with no signal, in cages, basements and trailers.",
    points: [
      "Add scanit to your home screen so it opens like an app. On iPhone: tap Share, then Add to Home Screen.",
      "On iPhone, do that before recording Kits: the Home Screen app keeps its own data, separate from Safari.",
      "Safari can delete a website's saved data after about seven days without a visit. The Home Screen app keeps it.",
      "Tap Help on the Kit list to see this tour again.",
    ],
  },
];

/** "scanit by Jon Lee", linking to Jon's contact page. */
export function madeBy() {
  return el("p", { class: "made-by" }, "scanit by ",
    el("a", { href: AUTHOR.url, target: "_blank", rel: "noopener" }, AUTHOR.name));
}

const tourLink = n => `#help/${n}`;

/** Step n (1 to the number of steps) of the tour. */
export function tourScreen(n) {
  rememberOffered(); // opening the tour answers the offer on the Kit list
  const total = TOUR_STEPS.length;
  const step = TOUR_STEPS[Math.min(Math.max(n, 1), total) - 1];
  const number = TOUR_STEPS.indexOf(step) + 1;
  const isLast = number === total;

  const nav = el("div", { class: "tour-nav" },
    number > 1 ? el("a", { href: tourLink(number - 1), class: "button secondary" }, "Back") : el("span"),
    isLast ? el("a", { href: "#", class: "button" }, "Start using scanit")
      : el("a", { href: tourLink(number + 1), class: "button" }, "Next"));

  return [
    el("nav", { class: "top split" },
      el("a", { href: "#", class: "back" }, "All Kits"),
      isLast ? el("span") : el("a", { href: "#" }, "Skip tour")),
    el("p", { class: "meta tour-progress" }, `Step ${number} of ${total}`),
    el("div", { class: "tour-dots", "aria-hidden": "true" },
      ...TOUR_STEPS.map((_, i) => el("span", { class: i + 1 === number ? "on" : "" }))),
    el("h1", {}, step.title),
    el("p", { class: "tour-intro" }, step.intro),
    el("ul", { class: "tour-points" }, ...step.points.map(point => el("li", {}, point))),
    step.action ? el("a", { href: step.action.href, class: "button secondary tour-action" }, step.action.label) : "",
    nav,
    isLast ? madeBy() : "",
  ];
}

function wasOffered() {
  try { return localStorage.getItem(SEEN_KEY) === "yes"; } catch { return false; }
}
function rememberOffered() {
  try { localStorage.setItem(SEEN_KEY, "yes"); } catch { /* offered again next time; harmless */ }
}

/** The "New to scanit?" offer for the Kit list, or "" once the tour was taken or the offer turned down. */
export function tourOffer() {
  if (wasOffered()) return "";
  const notNow = el("button", { type: "button", class: "secondary small-button" }, "Not now");
  const box = el("aside", { class: "tour-offer", "aria-label": "Take the tour" },
    el("p", {}, el("strong", {}, "New to scanit? "),
      "A two-minute tour shows how to set up Fields, scan Items, fix mistakes and Export."),
    el("div", { class: "row" }, el("a", { href: tourLink(1), class: "button small-button" }, "Take the tour"), notNow));
  notNow.addEventListener("click", () => { rememberOffered(); box.remove(); });
  return box;
}
