// Herrschaftsgebiet-Infobox (createRegionWikiInfoBoxMarkup, map-features-region-info-markup.js):
// der Aufruf von buildLoreMarkup muss die public_id des GEBIETS als `territory` mitschicken, sonst
// kann der Server nie eine hinterlegte Vorkommen-Regel gegen dieses Objekt pruefen -- ein Gebiet hat
// (anders als Weg/Etappe) keine eigenen Regions-IDs, der Server loest sie erst ueber
// ecosystem_region_territory auf (avesmapsLoreRuleReadSubjectsForTerritory, Task 9 Schritt 2).
//
// Gleiche vm-Bauart wie label-lore-area.test.js: beide Dateien sind blanke <script>-Globals ohne
// module.exports, also wird ein frischer vm-Kontext gebaut und darin ECHT geladen.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const loreSource = fs.readFileSync(path.join(__dirname, "..", "map-features-lore.js"), "utf8");
const regionInfoSource = fs.readFileSync(path.join(__dirname, "..", "map-features-region-info-markup.js"), "utf8");

// escapeHtml/tr sind in der echten App laengst geladene Globals; hier reichen einfache, aber ECHTE
// Implementationen -- ein Stub, der immer "" liefert, wuerde jede Zeile leer melden und den Test
// wertlos machen.
function escapeHtmlReal(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function makeContext() {
	const context = {
		console,
		window: {
			location: { search: "" },
			localStorage: { getItem: () => null, setItem() {} },
			setTimeout: (fn) => fn(),
			clearTimeout() {},
		},
		document: undefined,
		fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, sections: {}, counts: {}, total: 0 }) }),
		tr: (key, fallback) => fallback,
		escapeHtml: escapeHtmlReal,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(loreSource, context);
	vm.runInContext(regionInfoSource, context);
	return context;
}

// hasRegionWikiInfo() muss auf true stehen, sonst waehlt createRegionCompactTooltipMarkup die
// schlanke Tooltip-Box (keine Lore-Zeilen dort) statt der Wiki-Infobox -- wikiName reicht dafuer
// und laesst wikiUrl bewusst leer, damit "Aendern vorschlagen"/"Link teilen" keine weiteren
// Globals (sharePlaceActionButtonMarkup) brauchen.
const gebiet = {
	source: "political_territory",
	publicId: "pub-1",
	territoryPublicId: "terr-1",
	displayName: "Testgrafschaft",
	type: "Grafschaft",
	wikiName: "Testgrafschaft (Wiki)",
};

// ---- mit Gebiet: die public_id des TERRITORIUMS landet als territory im Container --------------
const mitGebiet = makeContext();
const markupMitGebiet = mitGebiet.createRegionCompactTooltipMarkup(gebiet);
assert.ok(markupMitGebiet.indexOf('data-lore-territory="terr-1"') >= 0,
	"territoryPublicId muss im data-lore-territory-Attribut ankommen: " + markupMitGebiet);

// 💣 Ohne eigenen Wiki-Schluessel (avesmapsLorePlaceRefFromRegion liefert null, da wikiName KEIN
// wiki_key ist) waere der Container vor Task 9 gar nicht erst entstanden -- jetzt reicht die
// Identitaet allein. Das ist der ganze Punkt der Aufgabe: ein Gebiet OHNE Wiki-Artikel bekommt
// trotzdem seine Regel-Treffer.
assert.ok(markupMitGebiet.indexOf('data-lore-fetch=""') >= 0,
	"kein wiki_key gesetzt -- der Ortsschluessel-Abruf bleibt leer, nur die Regel kann noch treffen");
assert.ok(markupMitGebiet.indexOf("avesmaps-lore-rows") >= 0,
	"der Container entsteht trotzdem -- getragen allein von territory: " + markupMitGebiet);

// ---- Rueckfall auf publicId, wenn territoryPublicId fehlt ---------------------------------------
const ohneTerritoryPublicId = makeContext();
const gebietOhneTerritoryId = Object.assign({}, gebiet, { territoryPublicId: "" });
const markupOhneTerritoryId = ohneTerritoryPublicId.createRegionCompactTooltipMarkup(gebietOhneTerritoryId);
assert.ok(markupOhneTerritoryId.indexOf('data-lore-territory="pub-1"') >= 0,
	"ohne territoryPublicId faellt es auf publicId zurueck -- derselbe Rueckfall wie die Quellen-Zeile "
	+ "und der Aendern-vorschlagen-Knopf in dieser Datei: " + markupOhneTerritoryId);

// ---- ganz ohne Identitaet: NICHTS aendert sich (Regression) -------------------------------------
// Ohne territoryPublicId UND publicId UND wiki_key bleibt der Container ganz aus -- buildLoreMarkup
// hat dann weder key/titles noch area/location/territory und liefert "" (derselbe Riegel wie vor
// Task 9; dieses Gebiet haette auch vorher keinen Container bekommen).
const ohneIdentitaet = makeContext();
const gebietOhneIdentitaet = Object.assign({}, gebiet, { territoryPublicId: "", publicId: "" });
const markupOhneIdentitaet = ohneIdentitaet.createRegionCompactTooltipMarkup(gebietOhneIdentitaet);
assert.ok(markupOhneIdentitaet.indexOf("avesmaps-lore-rows") < 0,
	"fehlen alle Identitaeten, entsteht gar kein Lore-Container -- wie vor dieser Aenderung: " + markupOhneIdentitaet);

console.log("territory-lore-territory: OK");
