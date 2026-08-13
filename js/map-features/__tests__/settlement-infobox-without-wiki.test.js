const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Fix-Runde 1 (Task 4b), Befund 1 (CRITICAL): settlementWikiInfoboxMarkup war die EINZIGE Stelle,
// die Vorkommen (Waren/Fauna/Flora) und Klimazone fuer eine Siedlung abruft/rendert -- und sie lief
// nur, wenn die Siedlung einen Wiki-Artikel hatte (hasWikiSettlement in buildLocationMarkerPopupHtml).
// Live gemessen: 2.975 von 4.883 Siedlungen (61 %) haben keinen -- genau die Zielgruppe der
// Lebensraum-Regel. Dieser Test faehrt den ECHTEN Aufrufer (buildLocationMarkerPopupHtml), nicht
// nur den neuen Helfer settlementLoreOnlyInfoboxMarkup, damit die Verdrahtung mitgeprueft wird.
//
// runInThisContext (nicht ein vm-Sandbox): dieselbe Technik wie location-type-label.test.js -- ein
// Sandbox mit handgeschriebenen Stubs wuerde die zu pruefende Regel selbst verschlucken (die Datei
// referenziert ihre Globals dann gegen den Stub, nicht gegen die echte Funktion). map-features-
// location-marker-entry.js haengt an keinem Leaflet-Aufruf auf Modulebene (nur innerhalb einzelner
// Funktionen wie createEditablePointMarkerEntry, die dieser Test nicht aufruft) und laedt hier
// erfolgreich -- die ⚠️ aus dem Befund ("laesst es sich nicht laden…") trifft nicht zu.
const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

// Reihenfolge egal (alles typeof-geschuetzt, erst beim AUFRUF von buildLocationMarkerPopupHtml
// ausgewertet) -- aber alle drei muessen vor dem ersten Aufruf geladen sein.
loadBrowserScript(path.join(__dirname, "../map-features-lore.js"));
loadBrowserScript(path.join(__dirname, "../map-features-climate-row.js"));
loadBrowserScript(path.join(__dirname, "../map-features-location-marker-entry.js"));

// Minimal-Stubs fuer alles, was buildLocationMarkerPopupHtml UNBEDINGT braucht (nicht typeof-
// geschuetzt, siehe Quelltext). Absichtlich schlicht: dieser Test prueft die Lore-/Klimazone-
// Verdrahtung, nicht das uebrige Popup-Markup (Kopf, Aktionen, Bewertungen).
global.CROSSING_LOCATION_TYPE = "__test_crossing__"; // muss vom getesteten locationType abweichen
global.escapeHtml = (value) => String(value == null ? "" : value)
	.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
global.tr = (key, fallback) => fallback;
global.locationActionsMarkup = () => "";
global.locationPopupMarkup = (opts) => `<div class="test-popup">${opts.actionsMarkup || ""}</div>`;

// Vokabular fuer die Klimazone -- ohne das bliebe jede Zeile "" (unbekannter Schluessel), und Befund
// 1, Punkt 2 ("und die Klimazone-Zeile") liesse sich gar nicht zeigen.
avesmapsClimateSetVocabulary([{ key: "gemaessigt", label: "Gemäßigte Zone" }]);

// --- Siedlung OHNE Wiki-Artikel, aber MIT publicId (Shinadra aus dem Befund) --------------------
// bekommt jetzt einen Lore-Container UND die Klimazone-Zeile, in dieser Reihenfolge.
const shinadra = {
	locationType: "dorf",
	name: "Shinadra",
	publicId: "shinadra-1",
	location: {
		publicId: "shinadra-1",
		name: "Shinadra",
		wikiSettlement: null,
		climateZone: "gemaessigt",
	},
};
const shinadraHtml = buildLocationMarkerPopupHtml(shinadra);
assert.ok(shinadraHtml.indexOf("data-lore-place=") >= 0,
	"eine Siedlung ohne Wiki-Artikel, aber mit publicId, muss einen Lore-Container bekommen (Befund 1)");
assert.ok(shinadraHtml.indexOf('data-lore-location="shinadra-1"') >= 0,
	"der Container muss die Identitaet der Siedlung tragen");
assert.ok(shinadraHtml.indexOf("Gemäßigte Zone") >= 0,
	"die Klimazone-Zeile muss ebenfalls erscheinen (Befund 1, Punkt 2)");
assert.ok(
	shinadraHtml.indexOf("data-lore-place=") < shinadraHtml.indexOf("Gemäßigte Zone"),
	"Reihenfolge Vorkommen -> Klimazone, dieselbe wie im Wiki-Zweig"
);
assert.ok(shinadraHtml.indexOf("location-popup__nowiki") < 0,
	"mit vorhandenen Zeilen darf der alte 'Keine Quelle gefunden'-Kasten NICHT mehr erscheinen");

// --- Siedlung GANZ ohne alles (kein Wiki, keine publicId, keine Klimazone) -----------------------
// bleibt beim heutigen Verhalten -- kein leerer Kasten (Befund 1, Punkt 3).
const namenlos = {
	locationType: "dorf",
	name: "Namenlos",
	publicId: "",
	location: {
		publicId: "",
		name: "Namenlos",
		wikiSettlement: null,
		climateZone: "",
	},
};
const namenlosHtml = buildLocationMarkerPopupHtml(namenlos);
assert.ok(namenlosHtml.indexOf("data-lore-place=") < 0,
	"ganz ohne jede Identitaet darf kein Lore-Container entstehen -- kein leerer Kasten");
assert.ok(namenlosHtml.indexOf("location-popup__nowiki") >= 0,
	"ohne jede Zeile bleibt der alte 'Keine Quelle gefunden'-Zustand bestehen");

// --- Siedlung MIT Wiki-Artikel: der Wiki-Zweig bleibt unangetastet (settlementWikiInfoboxMarkup) --
const gareth = {
	locationType: "grossstadt",
	name: "Gareth",
	publicId: "gareth-1",
	location: {
		publicId: "gareth-1",
		name: "Gareth",
		wikiSettlement: { title: "Gareth", name: "Gareth" },
		climateZone: "gemaessigt",
	},
};
const garethHtml = buildLocationMarkerPopupHtml(gareth);
assert.ok(garethHtml.indexOf("data-lore-place=") >= 0,
	"der Wiki-Zweig lief schon vorher und muss weiterhin einen Lore-Container liefern");
assert.ok(garethHtml.indexOf('data-lore-location="gareth-1"') >= 0,
	"auch der Wiki-Zweig traegt die Identitaet (Task 3/4b, unveraendert)");

console.log("settlement-infobox-without-wiki: OK");
