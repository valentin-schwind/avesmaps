// Pure, DOM-free source-line renderer. Order: official (with *), then the auto Wiki source, then
// the rest. Injectable escape/labels keep it Node-testable (no browser tr()/DOM). Empty in -> "".
// A source with a URL renders as a link; a URL-less publication source (a wiki catalog entry with
// no shop link) renders as plain text. Optional per-source `pages` -> " S. …"; `reference_kind`
// === 'erwaehnung' -> a subtle marker (the entity is only mentioned, not covered in detail).
function buildSourceListMarkup(wikiUrl, sources, opts) {
  opts = opts || {};
  const linkClass = opts.linkClass || "popup-source-link";
  const wikiLabel = opts.wikiLabel || "Wiki";
  const officialTooltip = opts.officialTooltip || "offizielle Quelle";
  const mentionTooltip = opts.mentionTooltip || "nur Erwähnung";
  const esc = opts.escape || ((s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const officialStar = (official) => official
    ? `<span class="popup-source-official" title="${esc(officialTooltip)}">*</span>`
    : "";
  // " S. <pages>" appended after the label when a source cites specific pages.
  const pagesSuffix = (pages) => {
    const value = String(pages == null ? "" : pages).trim();
    return value ? ` S. ${esc(value)}` : "";
  };
  // Subtle marker when the source only mentions the entity (reference_kind 'erwaehnung') instead of
  // covering it in detail. The free-form `note` becomes the tooltip when present.
  const mentionMarker = (source) => {
    if (source.reference_kind !== "erwaehnung") {
      return "";
    }
    const title = String(source.note == null ? "" : source.note).trim() || mentionTooltip;
    return `<span class="popup-source-mention" title="${esc(title)}">°</span>`;
  };
  const renderSource = (source, official) => {
    const label = esc(source.label || source.url || "");
    const inner = `${label}${officialStar(official)}${pagesSuffix(source.pages)}${mentionMarker(source)}`;
    // URL-less publication source -> plain text (no link); otherwise a link with the ↗ affordance.
    if (source.url) {
      return `<a class="${esc(linkClass)}" href="${esc(source.url)}" target="_blank" rel="noopener">${inner} ↗</a>`;
    }
    return `<span class="popup-source-text">${inner}</span>`;
  };
  const list = Array.isArray(sources) ? sources.filter((s) => s && (s.label || s.url)) : [];
  const parts = [];
  for (const s of list.filter((s) => s.official)) parts.push(renderSource(s, true));
  if (wikiUrl) {
    parts.push(`<a class="${esc(linkClass)}" href="${esc(wikiUrl)}" target="_blank" rel="noopener">${esc(wikiLabel)} ↗</a>`);
  }
  for (const s of list.filter((s) => !s.official)) parts.push(renderSource(s, false));
  return parts.join("  ");
}
if (typeof module !== "undefined" && module.exports) module.exports = { buildSourceListMarkup };
if (typeof window !== "undefined") window.buildSourceListMarkup = buildSourceListMarkup;
