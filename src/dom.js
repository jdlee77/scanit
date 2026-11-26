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

/**
 * A question asked on the page (never a browser pop-up), with a yes and a no button.
 * { text, yes, no, onYes, onNo, label }: label names the question for screen readers.
 * The no button is returned too, so the caller can move focus to it.
 */
export function question({ text, yes, no, onYes, onNo, label }) {
  const yesButton = el("button", { type: "button" }, yes);
  const noButton = el("button", { type: "button", class: "secondary" }, no);
  yesButton.addEventListener("click", onYes);
  noButton.addEventListener("click", onNo);
  const element = el("div", { class: "problem", role: label ? "alertdialog" : "alert", ...(label && { "aria-label": label }) },
    el("p", {}, ...[text].flat(Infinity)), el("div", { class: "row" }, yesButton, noButton));
  return { element, yesButton, noButton };
}
