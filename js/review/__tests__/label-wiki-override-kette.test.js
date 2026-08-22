// Der Wiki-Override am LANDSCHAFTSLABEL -- und zwar die ganze KETTE, nicht ein Glied davon.
//
// Die Herkunft eines Label-Felds muss vier Stationen ueberstehen, und faellt sie an EINER aus, ist
// das Ergebnis ununterscheidbar von „es gibt keine Abweichung":
//   1. Kartenpayload   -> `properties.field_origins` (der Server gibt `properties` unveraendert
//                         heraus; nur `svg_id` faellt -- gemessen in api/app/map-features.php)
//   2. Projektion      -> `normalizeLabelFeature` legt sie als `fieldOrigins` ans Label
//   3. Dialog          -> `setLabelWikiRegion(nest, keinArtikel, fieldOrigins)` nimmt sie entgegen
//   4. Speicher-Rumpf  -> `buildLabelEditPayload` schickt `wiki_uebernommen` zurueck
//
// 💣 STATION 2 IST DIE, DIE VIER TAGE LANG GEFEHLT HAT -- serverseitig gestempelt seit dem
// 18.08.2026, im Browser nie gelesen. Ein fehlendes Feld in einer Projektion faellt nirgends auf:
// `undefined` liest sich ueberall wie „nicht bekannt", und genau so verhaelt sich die Oberflaeche
// dann auch. Kein Fehler, keine Konsole, kein roter Test.
//
// Geprueft wird die ECHTE Projektion (vm-Sandkasten ueber map-features-labels.js), nicht ein
// Nachbau -- ein Nachbau prueft den Nachbau.
//
// Run: node js/review/__tests__/label-wiki-override-kette.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

let checks = 0;

/** Das Zeilenende einer Quelle -- der Repo-Baum traegt CRLF, ein Testlauf darf das nicht raten. */
const eolLos = (text) => (text.indexOf(String.fromCharCode(13, 10)) >= 0
	? String.fromCharCode(13, 10)
	: String.fromCharCode(10));

// ---- Station 2: die Projektion, echt ausgefuehrt ----------------------------------------------

const kontext = {
	console,
	window: { location: { search: "" }, localStorage: { getItem: () => null, setItem() {} } },
	document: undefined,
	fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
	tr: (schluessel, rueckfall) => rueckfall,
	escapeHtml: (wert) => String(wert == null ? "" : wert),
	// ⚠️ Ein ECHTER Helfer aus einer Nachbardatei, kein Stub, der "" liefert: `normalizeLabelFeature`
	// ruft ihn fuer JEDES Label, und ohne ihn bricht die Projektion ab, bevor die erste Zusicherung
	// laeuft. Was er zurueckgibt, prueft dieser Test nicht -- er darf nur nicht fehlen.
	readFeatureOtherSource: (properties) => (properties && properties.other_source) || null,
};
kontext.globalThis = kontext;
vm.createContext(kontext);
vm.runInContext(lies("js/map-features/map-features-labels.js"), kontext, { filename: "map-features-labels.js" });

const projiziere = (properties) => kontext.normalizeLabelFeature({
	properties: properties,
	geometry: { coordinates: [10, 20] },
});

const gepflegt = projiziere({
	public_id: "lbl-1",
	text: "Farindel",
	feature_subtype: "wald",
	field_origins: { text: "manual", feature_subtype: "wiki" },
});
assert.deepStrictEqual(gepflegt.fieldOrigins, { text: "manual", feature_subtype: "wiki" },
	"normalizeLabelFeature reicht `properties.field_origins` nicht als `fieldOrigins` durch -- der "
	+ "Dialog sieht die Herkunft dann nie, egal wie gepflegt sie in der Ablage steht.");
checks++;

// ⚠️ „nicht bekannt" ist `null`, nicht `undefined` und nicht `{}`: der Normalfall am ersten Tag ist
// ein Label ohne jede Herkunft, und der darf sich nicht wie eine Stoerung lesen.
assert.strictEqual(projiziere({ public_id: "lbl-2", text: "Bornwald" }).fieldOrigins, null,
	"ein Label ohne Herkunft meldet nicht `null`");
checks++;

// 💣 Und eine kaputte Ablage ebenfalls `null`, nie ein durchgereichter Unsinn: eine Zeichenkette
// oder ein Array liefe sonst in `avesmapsWikiAssignLandschaftHerkunft` hinein und muesste DORT noch
// einmal abgefangen werden -- zwei Riegel fuer dieselbe Sache sind einer zu viel.
for (const mist of ["manual", 42, ["text"], true]) {
	assert.strictEqual(projiziere({ public_id: "lbl-3", field_origins: mist }).fieldOrigins, null,
		"eine kaputte Ablage (" + JSON.stringify(mist) + ") reist als Wert weiter");
	checks++;
}

// ---- Station 3: der Dialog nimmt sie auch entgegen --------------------------------------------
// 🪤 Ein dritter Parameter, den niemand uebergibt, ist so gut wie keiner -- und `setLabelWikiRegion`
// hat ZWEI Aufrufer: `openLabelEditDialog` (das Label, mit Herkunft) und `assignLabelWikiRegionToForm`
// (der WikiSync-Weg von aussen, ohne -- ein frisch angelegtes Label hat noch keine). Der zweite darf
// sie also weglassen; der erste nicht.

const dialog = lies("js/review/review-labels.js");
assert.ok(/setLabelWikiRegion\(\s*label\.wikiRegion[^)]*label\.fieldOrigins/.test(dialog),
	"js/review/review-labels.js ruft setLabelWikiRegion ohne `label.fieldOrigins` -- die Projektion "
	+ "traegt die Herkunft dann bis vor die Tuer des Dialogs und nicht hinein.");
checks++;

const wiki = lies("js/review/review-label-wiki.js");
assert.ok(/function setLabelWikiRegion\(wiki, keinArtikel, fieldOrigins\)/.test(wiki),
	"setLabelWikiRegion nimmt keinen dritten Parameter entgegen");
checks++;
// 🪤 Geprueft wird der LADELAUF, nicht die Datei: `field_origins: labelWikiFieldOrigins` steht an
// ZWEI Stellen (im Ladelauf und im Zuweisen-Zweig), und eine Zusicherung ueber die ganze Datei war
// damit von einer Mutation nicht zu erschuettern -- die zweite Stelle deckte die erste zu. Dieselbe
// Falle wie beim Merklisten-Wachtest, wo beide Landschafts-Oberflaechen ihre Liste gleich nennen.
const ladelauf = wiki.slice(wiki.indexOf("async function labelWikiAssignZustand"));
const ladelaufKoerper = ladelauf.slice(0, ladelauf.indexOf(eolLos(ladelauf) + "}") + 2);
assert.ok(/field_origins:\s*labelWikiFieldOrigins/.test(ladelaufKoerper),
	"labelWikiAssignZustand gibt dem Bauteil kein `field_origins` -- ohne ihn haekelt die"
	+ " Sync-Vorschau wieder alles vor, was schon von Hand gesetzt ist (avesmapsWikiAssignDiff,"
	+ " Fall 4), und die Beschriftung bliebe fuer immer grau.");
checks++;

// ---- Station 4: und der Rueckweg ---------------------------------------------------------------
// 🔴 Der Schluessel heisst `wiki_uebernommen` und wird serverseitig genau so gelesen
// (avesmapsFieldOriginsAusWikiLesen mit AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS, features.php). Ein
// fehlender Schluessel heisst dort „nichts kam aus dem Wiki" und ist KEIN Fehler -- die Luecke
// faellt also nirgends auf.
assert.ok(/wiki_uebernommen:\s*getLabelWikiUebernommenPayload\(\)/.test(dialog),
	"buildLabelEditPayload schickt `wiki_uebernommen` nicht -- jede Sync-Uebernahme wuerde dann als "
	+ "„von uns\" gestempelt, und der naechste Abgleich liesse genau die Felder in Ruhe, die er "
	+ "selbst gefuellt hat.");
checks++;

// ⚠️ Und die zwei Felder muessen die des Registers sein, nicht geraten: der Server filtert auf
// AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS = ['text', 'feature_subtype'], alles andere wirft er weg.
const registry = vm.runInNewContext(
	lies("js/ui/wiki-assign-registry.js") + "\nAVESMAPS_WIKI_ASSIGN_REGISTRY;", {}
);
// 🪤 `Array.from` ist noetig, nicht Zierde: `registry` kommt aus einem vm-Sandkasten, seine Arrays
// tragen dessen Array.prototype -- und `deepStrictEqual` vergleicht den Prototyp mit. Ohne diese
// Zeile scheitert der Vergleich mit zwei Listen, die im Meldetext IDENTISCH aussehen.
const kartenziele = Array.from(registry.landschaftslabel.felder || [])
	.map((zeile) => String(zeile.karte || "")).filter((ziel) => ziel !== "");
assert.deepStrictEqual(kartenziele.sort(), ["feature_subtype", "text"],
	"die Kartenziele des Labels im Register stimmen nicht mehr mit denen ueberein, die der Server "
	+ "annimmt (AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS in api/_internal/map/features.php). Ein Feld, das "
	+ "nur eine Seite kennt, wird lautlos verworfen. Gefunden: " + JSON.stringify(kartenziele));
checks++;

const serverFelder = lies("api/_internal/map/features.php")
	.match(/const AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS\s*=\s*\[([^\]]*)\]/);
assert.ok(serverFelder, "AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS steht nicht mehr in features.php");
const serverListe = serverFelder[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
assert.deepStrictEqual(serverListe.sort(), ["feature_subtype", "text"],
	"der Server nimmt andere Felder an als das Register nennt: " + JSON.stringify(serverListe));
checks++;

console.log("OK — die Herkunft des Landschaftslabels ueberlebt alle vier Stationen (" + checks
	+ " Zusicherungen).");
