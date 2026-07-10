const assert = require("assert");
const { buildSourceListMarkup } = require("../feature-source-markup.js");

// Empty (no wiki link, no sources) -> "" so the caller renders nothing at all.
assert.strictEqual(buildSourceListMarkup("", [], {}), "", "empty -> ''");

// Wiki only: singular "Quelle:" line with the wiki link; no publications block.
let out = buildSourceListMarkup("https://wiki/x", [], { wikiLabel: "Wiki Aventurica" });
assert.ok(out.includes("Quelle:") && out.includes("Wiki Aventurica") && out.includes('href="https://wiki/x"'), "wiki-only line 1");
assert.ok(!out.includes("Publikationen"), "wiki-only has no publications block");

// Only a manual source, no wiki: "Quelle:" with that source + its type label; no "Wiki".
out = buildSourceListMarkup("", [
  { url: "https://vali/almanach", label: "Vali's Almanach", official: true, type: "quellenband", pages: "12" },
], {});
assert.ok(out.includes("Quelle:") && out.includes("Vali's Almanach") && out.includes("Quellenband"), "manual-only shows label + type");
assert.ok(out.includes("S. 12"), "manual source shows its page on line 1");
assert.ok(!out.includes("Wiki"), "manual-only has no wiki link");
assert.ok(!out.includes("Publikationen"), "manual (no reference_kind) is not a publication");

// Full: wiki + a manual source (line 1) + wiki publications (line 2, tabbed Titel/Typ/Seiten table).
const html = buildSourceListMarkup("https://wiki/Zhamorrah", [
  { url: "https://f-shop/1", label: "Efferds Wogen", official: true, type: "regionalspielhilfe", pages: "54", reference_kind: "ausfuehrlich" },
  { url: "", label: "Im Bann des Diamanten", official: true, type: "abenteuer", pages: "40, 145", reference_kind: "ausfuehrlich" },
  { url: "https://x/2", label: "Historia Aventurica", official: true, type: "quellenband", pages: "176", reference_kind: "erwaehnung", note: "Zerstörung" },
  { url: "", label: "Vali's Almanach", official: true, type: "quellenband", pages: "12" }, // manual (no reference_kind) -> line 1
], { wikiLabel: "Wiki Aventurica" });

// Line 1: two items (wiki + Vali) -> plural "Quellen:"; Vali carries its type + page; url-less -> no link.
assert.ok(html.includes("Quellen:"), "two line-1 items -> plural label");
assert.ok(html.includes("Wiki Aventurica") && html.includes("Vali's Almanach"), "line 1 has wiki + manual");
assert.ok(html.includes("S. 12"), "manual source page shown on line 1");
assert.ok(!/href="[^"]*Almanach/.test(html), "url-less manual = no link");

// Line 2: publications block with total (3) and two tabs (Offizielle 2, Erwähnungen 1).
assert.ok(html.includes("Publikationen") && html.includes("(3)"), "publications total (3)");
assert.ok(/Offizielle <span class="fs-src-n">2<\/span>/.test(html), "Offizielle count 2");
assert.ok(/Erwähnungen <span class="fs-src-n">1<\/span>/.test(html), "Erwähnungen count 1");

// Table: headers Titel/Typ/Seiten, page numbers WITHOUT an "S." prefix, type slugs -> German labels.
assert.ok(html.includes(">Titel<") && html.includes(">Typ<") && html.includes(">Seiten<"), "table headers");
assert.ok(html.includes(">54<") && html.includes(">40, 145<") && html.includes(">176<"), "pages cells (no 'S.' prefix)");
assert.ok(html.includes("Regionalspielhilfe") && html.includes("Abenteuer") && html.includes("Quellenband"), "type labels resolved");

// A url-less publication renders as plain text (no link to it).
assert.ok(html.includes("Im Bann des Diamanten") && !/href="[^"]*Diamanten/.test(html), "url-less publication = plain");

// The erwaehnung sits in the Erwähnungen panel; the substantive ones in the Offizielle panel.
const erwPanel = html.slice(html.indexOf('data-fs-panel="erw"'));
assert.ok(erwPanel.includes("Historia Aventurica"), "erwaehnung in erw panel");
const offPanel = html.slice(html.indexOf('data-fs-panel="off"'), html.indexOf('data-fs-panel="erw"'));
assert.ok(offPanel.includes("Efferds Wogen") && offPanel.includes("Im Bann des Diamanten"), "substantive in off panel");

console.log("feature-source-markup tests passed");
