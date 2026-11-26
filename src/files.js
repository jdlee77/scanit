// Files the app hands to the user: the date in their names, and the download itself.

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
