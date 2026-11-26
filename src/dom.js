// Small helpers the screens use to build the page.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** An error (role alert) or { notice } (role status) at the top of a screen; hidden when there's none. */
export function messageLine(message) {
  if (message?.notice) return el("p", { role: "status", class: "notice" }, message.notice);
  return el("p", { role: "alert", class: message ? "error" : "error hidden" }, message ?? "");
}

/** "1 Item", "3 Items". */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
