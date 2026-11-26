// The prompt on the Kit list explaining how to add scanit to the home screen, and why.
// Shown until dismissed (remembered on this phone), and never once scanit runs from the home screen.
import { el } from "./dom.js";

const DISMISSED_KEY = "scanit.homeScreenPromptDismissed";

// Chrome and Edge announce that they can install the app; keep the event for the Install button.
let installOffer = null;
addEventListener("beforeinstallprompt", event => { event.preventDefault(); installOffer = event; });

// iPhone, iPad or iPod (newer iPads say "Mac" but have a touch screen).
const isAppleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function wasDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === "yes"; } catch { return false; }
}
function rememberDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, "yes"); } catch { /* shows again next time; harmless */ }
}

/**
 * The prompt to show, or "" when scanit is already on the home screen or the prompt was dismissed.
 * kitCount: how many Kits this browser holds, for the iPhone warning that they don't move across.
 */
export function homeScreenPrompt({ kitCount }) {
  if (isInstalled() || wasDismissed()) return "";
  const dismiss = el("button", { type: "button", class: "secondary small-button" }, "Dismiss");
  const box = el("aside", { class: "home-prompt", "aria-label": "Add scanit to your home screen" });
  dismiss.addEventListener("click", () => { rememberDismissed(); box.remove(); });

  if (isAppleMobile()) {
    // A Home Screen app on iPhone keeps its own data, separate from the browser's.
    const carryOver = kitCount > 0
      ? `The Home Screen app starts empty: the ${kitCount === 1 ? "Kit" : `${kitCount} Kits`} here won't move across, so Export first.`
      : "Do it before recording Kits: the Home Screen app keeps its own data, separate from this browser.";
    box.append(
      el("p", {}, el("strong", {}, "Add scanit to your Home Screen. "),
        "Tap Share (the square with an arrow pointing up), then Add to Home Screen. "
        + "From then on, open scanit from its icon."),
      el("p", { class: "small" }, "Why: Safari can delete a website's saved data after about seven days without a visit, "
        + "which would lose any Kit not yet exported. Apps on the Home Screen keep their data, and open with no signal."),
      el("p", { class: "small" }, el("strong", {}, carryOver)),
      el("div", { class: "row" }, dismiss));
    return box;
  }

  const buttons = el("div", { class: "row" });
  if (installOffer) {
    const install = el("button", { type: "button", class: "small-button" }, "Install");
    install.addEventListener("click", async () => {
      const offer = installOffer;
      installOffer = null; // the browser allows one go per offer
      install.remove();
      await offer.prompt();
      if ((await offer.userChoice).outcome === "accepted") { rememberDismissed(); box.remove(); }
    });
    buttons.append(install);
  }
  buttons.append(dismiss);
  box.append(
    el("p", {}, el("strong", {}, "Install scanit as an app. "),
      installOffer ? "Tap Install, or in your browser's menu choose Install app or Add to Home screen."
        : "In your browser's menu, choose Install app or Add to Home screen."),
    el("p", { class: "small" }, "It then opens from its own icon, works with no signal, and its saved data is kept."),
    buttons);
  return box;
}
