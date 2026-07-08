// Pure, DOM-free source-line renderer. Order: official (with *), then the auto Wiki source, then
// the rest. Injectable escape/labels keep it Node-testable (no browser tr()/DOM). Empty in -> "".
function buildSourceListMarkup(wikiUrl, sources, opts) {
  opts = opts || {};
  const linkClass = opts.linkClass || "popup-source-link";
  const wikiLabel = opts.wikiLabel || "Wiki";
  const officialTooltip = opts.officialTooltip || "offizielle Quelle";
  const esc = opts.escape || ((s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const link = (url, label, official) => {
    const star = official ? `<span class="popup-source-official" title="${esc(officialTooltip)}">*</span>` : "";
    return `<a class="${esc(linkClass)}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}${star} ↗</a>`;
  };
  const list = Array.isArray(sources) ? sources.filter((s) => s && s.url) : [];
  const parts = [];
  for (const s of list.filter((s) => s.official)) parts.push(link(s.url, s.label || s.url, true));
  if (wikiUrl) parts.push(link(wikiUrl, wikiLabel, false));
  for (const s of list.filter((s) => !s.official)) parts.push(link(s.url, s.label || s.url, false));
  return parts.join("  ");
}
if (typeof module !== "undefined" && module.exports) module.exports = { buildSourceListMarkup };
if (typeof window !== "undefined") window.buildSourceListMarkup = buildSourceListMarkup;
