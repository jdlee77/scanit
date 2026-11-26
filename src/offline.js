// Working offline and keeping data: starts the service worker (sw.js), which keeps every app file
// on the phone, and asks the browser to keep scanit's stored data. Neither is required: if either
// is unavailable or refused, scanit still works, it just needs a connection to open.

// What startOffline found.
export const READY = "ready";
export const UPDATING = "updating"; // a new version is taking over; the page reloads by itself
export const UNAVAILABLE = "unavailable"; // no service worker here: scanit needs a connection to open

const TAKE_OVER = "take over"; // the message sw.js listens for; keep the two the same
const TAKE_OVER_WAIT_MS = 3000;

/**
 * Start the service worker. When a new version is waiting from an earlier visit, ask it to take
 * over and resolve to UPDATING: the page reloads once by itself, before anything is drawn, so
 * nothing typed is lost. If it doesn't take over in time (say another scanit window is open), carry
 * on with this version.
 * isSafeToSwitch: a function saying whether reloading now would lose nothing (no form half filled
 * in, no camera running); checked when the app comes back on screen, since a home-screen app is
 * usually resumed rather than reopened.
 */
export async function startOffline({ isSafeToSwitch }) {
  if (!("serviceWorker" in navigator)) return UNAVAILABLE;
  try {
    // updateViaCache "none": always ask the server whether sw.js or app-files.js changed.
    const registration = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
    if (await takeOver(registration)) return UPDATING;
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) return;
      try {
        await registration.update();
        await settled(registration);
        if (isSafeToSwitch()) await takeOver(registration);
      } catch { /* offline, or the server is unreachable: try again next time */ }
    });
    return READY;
  } catch (error) {
    console.warn("scanit can't work offline in this browser:", error);
    return UNAVAILABLE;
  }
}

/** Wait for a version being installed to finish installing (or fail). */
function settled(registration) {
  const installing = registration.installing;
  if (!installing) return Promise.resolve();
  return new Promise(resolve => installing.addEventListener("statechange", () => {
    if (installing.state !== "installing") resolve();
  }));
}

/** If a new version is waiting, ask it to take over; on success, reload into it. True if it did. */
async function takeOver(registration) {
  if (!registration.waiting || !navigator.serviceWorker.controller) return false;
  const switched = new Promise(resolve => {
    navigator.serviceWorker.addEventListener("controllerchange", () => resolve(true), { once: true });
    setTimeout(() => resolve(false), TAKE_OVER_WAIT_MS);
  });
  registration.waiting.postMessage(TAKE_OVER);
  if (!(await switched)) return false;
  location.reload();
  return true;
}

/** Ask the browser to keep scanit's stored data rather than clear it to save space. True if it will. */
export async function keepStoredData() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false; // refused or unsupported: scanit works the same, the Export reminder still applies
  }
}
