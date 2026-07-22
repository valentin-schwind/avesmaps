const assert = require("assert");
const { renderFeatureSourceEditorHtml } = require("../review-feature-sources.js");
const html = renderFeatureSourceEditorHtml(
  { wiki_url: "https://wiki/x", sources: [
    { source_id: 7, url: "https://f-shop.de/a", label: "F-Shop", type: "sonstiges", official: true },
    { source_id: 8, url: "https://bp/x", label: "Briefspiel", type: "briefspiel", official: false } ] },
  { escape: (s) => String(s == null ? "" : s) }
);
assert.ok(html.includes("Wiki Aventurica"), "wiki read-only row");
assert.ok(html.includes("F-Shop") && html.includes("Briefspiel"), "both sources listed");
assert.ok(html.includes('data-remove-source-id="7"') && html.includes('data-remove-source-id="8"'), "delete buttons carry source_id");
assert.ok(/data-fs-add/.test(html), "add row present");

// Task 6 Step 1: the type dropdown must offer the 8-value taxonomy (order mirrors the PHP
// whitelist in avesmapsFeatureSourceUpsert @ api/_internal/app/feature-sources.php).
const emptyHtml = renderFeatureSourceEditorHtml(
  { wiki_url: "", sources: [] },
  { escape: (s) => String(s == null ? "" : s) }
);
[
  "regionalspielhilfe",
  "abenteuer",
  "aventurischer_bote",
  "quellenband",
  "roman",
  "briefspiel",
  "regelbuch",
  "sonstiges",
].forEach((type) => {
  assert.ok(emptyHtml.includes('value="' + type + '"'), "type dropdown offers " + type);
});

// Task 6 Step 2: sources with origin === "wiki_publication" render under their own
// "Aus dem Wiki (automatisch)" heading, ahead of the manual/community ones which render as before.
const wikiGroupHtml = renderFeatureSourceEditorHtml(
  { wiki_url: "https://wiki/x", sources: [
    { source_id: 10, url: "https://f-shop.de/efferds-wogen", label: "Efferds Wogen", type: "regionalspielhilfe", official: true, origin: "wiki_publication" },
    { source_id: 11, url: "https://bp/manual", label: "Manuelle Quelle", type: "sonstiges", official: false, origin: "manual" } ] },
  { escape: (s) => String(s == null ? "" : s) }
);
assert.ok(wikiGroupHtml.includes("Aus dem Wiki (automatisch)"), "wiki-automatic group heading present");
assert.ok(wikiGroupHtml.includes("Efferds Wogen") && wikiGroupHtml.includes("Manuelle Quelle"), "both wiki and manual sources listed");
assert.ok(
  wikiGroupHtml.indexOf("Aus dem Wiki (automatisch)") < wikiGroupHtml.indexOf("Efferds Wogen"),
  "heading precedes the wiki-derived row"
);
assert.ok(wikiGroupHtml.includes('data-remove-source-id="10"'), "wiki-derived row still carries a remove button (suppression happens server-side)");

// No wiki-origin source -> no heading at all (never render an empty group).
const noWikiGroupHtml = renderFeatureSourceEditorHtml(
  { wiki_url: "", sources: [
    { source_id: 12, url: "https://bp/manual", label: "Manuelle Quelle", type: "sonstiges", official: false, origin: "manual" } ] },
  { escape: (s) => String(s == null ? "" : s) }
);
assert.ok(!noWikiGroupHtml.includes("Aus dem Wiki (automatisch)"), "no heading when there is no wiki-origin source");

// Task 6 Step 1 robustness: a legacy stored row with a retired type ("regionalband", from the old
// 4-value enum) must still render a real badge, never the literal string "undefined".
const legacyTypeHtml = renderFeatureSourceEditorHtml(
  { wiki_url: "", sources: [
    { source_id: 13, url: "https://x/legacy", label: "Alte Quelle", type: "regionalband", official: false } ] },
  { escape: (s) => String(s == null ? "" : s) }
);
assert.ok(!/undefined/.test(legacyTypeHtml), "legacy type never renders literal undefined");
assert.ok(legacyTypeHtml.includes('<span class="fs-row__badge">Sonstiges</span>'), "legacy type badge falls back to Sonstiges");

// Manual sources can carry a page citation: the add form offers a "Seite(n)" input, and a stored
// source with a `pages` value renders it (e.g. "S. 12") in its row.
assert.ok(emptyHtml.includes('class="fs-add-pages"'), "add form has a pages input");
const pagesRowHtml = renderFeatureSourceEditorHtml(
  { wiki_url: "", sources: [
    { source_id: 14, url: "https://vali/almanach", label: "Vali's Almanach", type: "quellenband", official: true, origin: "manual", pages: "12" } ] },
  { escape: (s) => String(s == null ? "" : s) }
);
assert.ok(pagesRowHtml.includes("S. 12"), "source row shows its page citation");

// Bug #41, Nachtrag: „Hinzufügen" ohne URL tat gar nichts -- keine Zeile, keine Meldung, der Knopf
// wirkte tot. Die URL bleibt Pflicht (der Katalog erkennt Dubletten über den URL-Hash), aber die
// Zeile muss das sagen können. Der Platz dafür gehört ins Markup, verborgen bis er gebraucht wird.
assert.ok(emptyHtml.includes("data-fs-note"), "die Eingabezeile hat einen Platz für ihre Absage");
assert.ok(/data-fs-note[^>]*\bhidden\b/.test(emptyHtml), "der Hinweis startet verborgen");

console.log("feature-sources-render tests passed");
