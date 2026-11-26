// Files the app hands to the user: the date in their names, and the Share menu or download.

/** The local date as YYYY-MM-DD, for file names. */
export function dateStamp(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Give the user a file as a download. */
export function downloadFile(contents, name, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// What became of a file offered through shareOrDownload.
export const SHARED = "shared";
export const DOWNLOADED = "downloaded";
export const CANCELLED = "cancelled"; // the user closed the Share menu
export const SHARE_FAILED = "share failed"; // Share refused the file; nothing was sent

/**
 * Offer a file through the phone's Share menu (email, Teams, Drive...), or download it where
 * Share can't take files. Call straight from a tap: phones only open Share in answer to one.
 * When Share fails, this doesn't download instead: by then the tap has passed, and the phone
 * may block the download silently. The caller asks for a fresh tap and calls downloadFile.
 */
export async function shareOrDownload(contents, name, type) {
  const file = new File([contents], name, { type });
  if (!navigator.canShare?.({ files: [file] })) {
    downloadFile(contents, name, type);
    return DOWNLOADED;
  }
  try {
    await navigator.share({ files: [file], title: name });
    return SHARED;
  } catch (error) {
    if (error.name === "AbortError") return CANCELLED;
    console.error(error);
    return SHARE_FAILED;
  }
}
