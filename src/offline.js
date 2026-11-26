// Working offline and keeping data: starts the service worker (sw.js), which keeps every app file
// on the phone, and asks the browser to keep scanit's stored data. Neither is required: if either
// is unavailable or refused, scanit still works, it just needs a connection to open.

/**
 * Start the service worker. Resolves to "updating" when a new version was waiting and is taking
 * over: the page then reloads once by itself, before anything is drawn, so nothing typed is lost.
 * Otherwise resolves to "ready" (or "unavailable" where the browser has no service workers).
 */
export async function startOffline() {
  if (!("serviceWorker" in navigator)) return "unavailable";
  try {
    const hadOldVersion = Boolean(navigator.serviceWorker.controller);
    // updateViaCache "none": always ask the server whether sw.js or app-files.js changed.
    const registration = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
    if (registration.waiting && hadOldVersion) {
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      registration.waiting.postMessage("take over");
      return "updating";
    }
    // Look for a new version whenever the app comes back on screen; it takes over on the next visit.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) registration.update().catch(() => {});
    });
    return "ready";
  } catch (error) {
    console.warn("scanit can't work offline in this browser:", error);
    return "unavailable";
  }
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
