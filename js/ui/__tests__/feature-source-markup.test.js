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

// Line 2: publications block, label WITHOUT a total, two tabs (Offiziell (2), Erwähnt (1)) in one row.
assert.ok(html.includes("Publikationen:"), "publications label without total");
assert.ok(!html.includes('fs-src-total'), "no total count element on Publikationen");
assert.ok(/Offiziell <span class="fs-src-n">\(2\)<\/span>/.test(html), "Offiziell count (2)");
assert.ok(/Erwähnt <span class="fs-src-n">\(1\)<\/span>/.test(html), "Erwähnt count (1)");

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

// ---- Der Lizenzhinweis der Wiki-Texte (CC BY-SA 3.0) --------------------------------------------
//
// 💣 Er haengt am WIKI-Eintrag, nicht an der Zeile: die uebrigen Quellen (Publikationen,
// Briefspiele, eigene) stehen NICHT unter dieser Lizenz, eine Fussnote unter der ganzen Zeile
// behauptete es aber fuer alle. Und ohne Beschriftung/Adresse rendert er gar nichts -- der reine
// Renderer behauptet keine Lizenz, die ihm niemand mitgegeben hat.
const LIC = { wikiLabel: "Wiki Aventurica", wikiLicenseLabel: "CC BY-SA 3.0", wikiLicenseUrl: "https://cc/by-sa/3.0/" };

let lic = buildSourceListMarkup("https://wiki/x", [], LIC);
assert.ok(lic.includes("CC BY-SA 3.0") && lic.includes('href="https://cc/by-sa/3.0/"'), "Wiki-Eintrag traegt den Lizenzhinweis");
// 🪟 SEIT 03.09.2026 IN DER TAFEL HINTER DEM ⓘ, nicht mehr sichtbar in der Zeile. Hier stand
// nur „und zwar HINTER dem Wiki-Link" -- das traf danach zufaellig weiter zu (die Tafel steht
// hinter der Zeile) und haette den Umzug NICHT bemerkt. Gemessen wird deshalb der Ort.
assert.ok(/Wiki Aventurica[\s\S]*?CC BY-SA 3.0/.test(lic), "und zwar HINTER dem Wiki-Link");
assert.ok(lic.indexOf("CC BY-SA 3.0") > lic.indexOf('<div class="fs-src-rights"'),
  "naemlich in der Rechtetafel, nicht in der Zeile");

assert.ok(!buildSourceListMarkup("https://wiki/x", [], { wikiLabel: "Wiki Aventurica" }).includes("CC BY-SA"),
	"ohne uebergebene Lizenz kein Hinweis");
assert.ok(!buildSourceListMarkup("", [{ url: "https://vali/a", label: "Vali" }], LIC).includes("CC BY-SA"),
	"ohne Wiki-Link kein Hinweis -- eine eigene Quelle steht nicht unter der Wiki-Lizenz");

// ⚠️ Genau EINMAL, am Wiki-Eintrag -- nicht an jeder Quelle der Zeile.
lic = buildSourceListMarkup("https://wiki/x", [
  { url: "https://vali/a", label: "Vali's Almanach" },
  { url: "https://f-shop/1", label: "Efferds Wogen", reference_kind: "ausfuehrlich" },
], LIC);
assert.strictEqual(lic.split("CC BY-SA 3.0").length - 1, 1, "der Hinweis steht genau einmal in der Zeile");

// ---- Der Trenner zwischen „Quelle(n)" und „Publikationen" ---------------------------------------
//
// 🔴 Owner 03.09.2026, mit Bild: die rote Linie lag genau dort. Zwei Abschnitte im selben
// Kasten, und der Wechsel war nur an der Beschriftung zu erkennen (AGENTS.md §12: „Group by
// divider … not by framed boxes").
// 💣 ER KOMMT NUR, WENN OBEN WIRKLICH ETWAS STEHT. Ein Trenner ueber der ersten Zeile trennt
// nichts und sagt „hier fehlt etwas" -- deshalb werden alle DREI Lagen gemessen, nicht nur die
// eine, die den Trenner traegt.
const PUB = [{ label: "Havena", url: "https://x/1", type: "regionalspielhilfe",
  reference_kind: "ausfuehrlich", pages: "9,10,11,12" }];

const beides = buildSourceListMarkup("https://wiki/Havena", PUB, { wikiLabel: "Wiki Aventurica", wikiOfficial: true });
assert.ok(beides.includes("fs-src-trenner"), "Quellen UND Publikationen: der Trenner steht dazwischen");
assert.ok(beides.indexOf("fs-src-trenner") > beides.indexOf("fs-src-list")
  && beides.indexOf("fs-src-trenner") < beides.indexOf("fs-src-pub"),
  "und zwar HINTER der Liste und VOR den Publikationen");

assert.ok(!buildSourceListMarkup("", PUB, {}).includes("fs-src-trenner"),
  "nur Publikationen: kein Trenner ueber der ersten Zeile");
assert.ok(!buildSourceListMarkup("https://wiki/Havena", [], { wikiLabel: "Wiki Aventurica" }).includes("fs-src-trenner"),
  "nur Quellen: kein Trenner unter der letzten Zeile");
// ⚠️ Und die Karten-Variante blendet die Publikationen ganz aus (`omitPublications`) -- dann
// gibt es auch nichts zu trennen.
assert.ok(!buildSourceListMarkup("https://wiki/Havena", PUB,
  { wikiLabel: "Wiki Aventurica", omitPublications: true }).includes("fs-src-trenner"),
  "ohne Publikationsblock kein Trenner");

// 💣 Die Linie laeuft VOLLBREIT, und die −8px sind das Seitenpolster von `.fs-src--box`
// (Owner 03.09.2026: 6px 8px 6px; vorher 9px 11px 10px und −11px).
// Wer das Polster aendert und die Linie vergisst, bekommt eine Trennung, die vor dem Rand endet --
// im Bild sofort sichtbar, im Quelltext nie.
{
  const css = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "..", "css", "features", "feature-sources.css"), "utf8");
  const regel = css.slice(css.indexOf(".fs-src-trenner"), css.indexOf(".fs-src-trenner") + 200);
  assert.ok(/margin:\s*0 -8px;/.test(regel), "der Trenner laeuft vollbreit (-8px = Seitenpolster)");
  assert.ok(/var\(--color-divider\)/.test(regel), "und nimmt den Trennlinien-Token, keine Hexzahl");
  // ⚠️ MIT der Klammer gesucht, nicht nach dem blossen Namen: der steht seit heute auch im
  // KOMMENTAR ueber dem Trenner (er erklaert ja, woher die 8px kommen), und ein Ausschnitt ab
  // dem Kommentar enthaelt die Regel gar nicht. Genau daran ist dieser Test beim Schreiben
  // einmal umgefallen -- die Hausfalle „Quelltexttest liest seinen eigenen Kommentar mit".
  const kastenAb = css.indexOf(".fs-src--box {");
  const kasten = css.slice(kastenAb, kastenAb + 240);
  assert.ok(/padding:\s*6px 8px 6px;/.test(kasten),
    "das Seitenpolster des Kastens ist wirklich 8px -- sonst luegt die Zahl oben");
  assert.ok(/margin-top:\s*10px;/.test(kasten), "und der Kasten haelt 10px Abstand zur Tabelle darueber (Owner 03.09.2026)");
}

console.log("feature-source-markup tests passed");
