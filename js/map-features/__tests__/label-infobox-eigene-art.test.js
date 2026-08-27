// Die Infobox einer Beschriftung nennt ihre ART -- und wenn das Wiki keine kennt, ihre EIGENE.
//
// 💣 DER BEFUND (Owner 28.08.2026, „Ceälan ist ein freies Label (vulkan), wird aber in der infobox
// als region gezeigt"): buildRegionLabelViewPopupHtml las die Art AUSSCHLIESSLICH aus
// label.wikiRegion.art und fiel sonst auf die feste Zeichenkette "Region" zurueck -- der eigene
// feature_subtype wurde nie gefragt. Live gezaehlt: 341 der 983 Beschriftungen sagten "Region",
// obwohl sie Wald, See, Berggipfel, Vulkan … sind.
//
// 🔴 Die Wiki-Art bleibt VORNE, und das ist keine Bequemlichkeit: sie ist feiner als unser
// Vokabular ("Bucht" statt "Meer", "Halbinsel" statt "Region", "Wasserfall" statt "Fluss") -- bei
// 264 der 627 zugewiesenen Beschriftungen weicht sie ab, und jede Umkehrung waere dort ein
// Informationsverlust. Der eigene Typ FUELLT die Luecke, er verdraengt nichts.
//
// 💣 Und das KOPFBILD wird ueber die deutsche Art nachgeschlagen (INFO_HEADER_IMAGE_BY_ART), nie
// ueber die uebersetzte: unter ?lang=en faende "Volcano" nichts und jede Beschriftung bekaeme
// wieder das generische region.webp.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(REPO, ...teile), "utf8");

function escapeHtmlReal(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Der Kontext traegt ECHT: das geteilte Art-Vokabular, die echte Kopfbild-Tabelle aus popups.js
// (samt normalizeInfoHeaderKey/regionHeaderImageBasename) und den echten Label-Bauer. Gestubbt ist
// nur, was DOM oder Netz braucht -- und infoHeaderImageMarkup, damit der Test seine Argumente
// mitlesen kann; genau sie sind die Aussage (Bildname und Untertitel).
function makeContext(uebersetzung) {
	const gerufen = { header: null };
	const context = {
		console,
		window: { location: { search: "" }, localStorage: { getItem: () => null, setItem() {} },
			setTimeout: (fn) => fn(), clearTimeout() {} },
		document: undefined,
		fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, sections: {}, counts: {}, total: 0 }) }),
		tr: typeof uebersetzung === "function" ? uebersetzung : ((key, deutsch) => deutsch),
		escapeHtml: escapeHtmlReal,
		locationPopupActionsMarkup: (buttons) => (buttons || []).join(""),
		sharePlaceActionButtonMarkup: () => "[teilen]",
		buildSuggestChangeButtonSpec: () => null,
		popupActionButtonMarkup: () => "",
		renderFeatureSourceLine: () => "",
		buildRegionCityMapsMarkup: () => "",
		buildRegionGameLiteratureMarkup: () => "",
		readFeatureOtherSource: () => null,
		infoHeaderImageMarkup: (basename, titel, untertitel) => {
			gerufen.header = { basename, titel, untertitel };
			return "<header>";
		},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(lies("js", "ui", "label-arten.js"), context);

	// Die echten Kopfbild-Tabellen + ihre reinen Nachschlager aus popups.js -- ausgeschnitten, weil
	// die ganze Datei ein DOM braucht. Eine Abschrift der Tabelle hier waere genau die zweite
	// Wahrheit, gegen die dieser ganze Umbau laeuft.
	const popups = lies("js", "ui", "popups.js");
	const von = popups.indexOf("const INFO_HEADER_IMAGE_BY_ART");
	const bis = popups.indexOf("function infoHeaderImageMarkup");
	assert.ok(von >= 0 && bis > von, "die Kopfbild-Tabelle muss in popups.js auffindbar sein");
	vm.runInContext(popups.slice(von, bis), context);

	// locationPopupMarkup ebenso -- es entscheidet, WO der Typ landet.
	const lpVon = popups.indexOf("function locationPopupMarkup");
	const lpBis = popups.indexOf("function labelPopupMarkup");
	assert.ok(lpVon >= 0 && lpBis > lpVon, "locationPopupMarkup muss in popups.js auffindbar sein");
	vm.runInContext(popups.slice(lpVon, lpBis), context);

	vm.runInContext(lies("js", "map-features", "map-features-lore.js"), context);
	vm.runInContext(lies("js", "map-features", "map-features-labels.js"), context);
	context.__gerufen = gerufen;
	return context;
}

// ---- 1. Ohne Wiki-Zuweisung zaehlt die eigene Art (der gemeldete Fall) ------------------------
const ceaelan = makeContext();
ceaelan.buildRegionLabelViewPopupHtml({
	publicId: "53022cbf-74ba-4e05-9110-18ff0e3067a0",
	text: "Ceälan",
	labelType: "vulkan",
	wikiRegion: null,
	coordinates: [682.719, 585],
});
assert.strictEqual(ceaelan.__gerufen.header.untertitel, "Vulkan",
	"ein freies Label vom Typ vulkan muss \"Vulkan\" sagen, nicht \"Region\"");
assert.strictEqual(ceaelan.__gerufen.header.basename, "gebirge",
	"und sein Kopfbild folgt der eigenen Art (vulkan -> gebirge), nicht dem generischen region.webp");

// ---- 2. Die Wiki-Art bleibt vorne, weil sie feiner ist ---------------------------------------
const bucht = makeContext();
bucht.buildRegionLabelViewPopupHtml({
	publicId: "b1", text: "Perlenmeer", labelType: "meer",
	wikiRegion: { art: "Bucht", name: "Perlenmeer" }, coordinates: [1, 2],
});
assert.strictEqual(bucht.__gerufen.header.untertitel, "Bucht",
	"eine vorhandene Wiki-Art schlaegt die eigene -- sie ist feiner als unser Vokabular");
assert.strictEqual(bucht.__gerufen.header.basename, "meer",
	"und das Kopfbild folgt ihr ebenfalls (bucht -> meer)");

// ---- 3. "region" ist eine echte Art, kein Platzhalter ----------------------------------------
const neutral = makeContext();
neutral.buildRegionLabelViewPopupHtml({
	publicId: "b2", text: "Mittelaventurien", labelType: "region", wikiRegion: null, coordinates: [1, 2],
});
assert.strictEqual(neutral.__gerufen.header.untertitel, "Region");
assert.strictEqual(neutral.__gerufen.header.basename, "region");

// ---- 4. Eine unbekannte Art faellt auf "Region" zurueck, nie auf leer -------------------------
const unbekannt = makeContext();
unbekannt.buildRegionLabelViewPopupHtml({
	publicId: "b3", text: "Etwas", labelType: "gibtsnicht", wikiRegion: null, coordinates: [1, 2],
});
assert.strictEqual(unbekannt.__gerufen.header.untertitel, "Region",
	"ohne Wiki-Art und ohne bekannte eigene Art bleibt es bei \"Region\" -- ein leerer Untertitel"
	+ " liest sich wie ein Fehler");

// ---- 5. Uebersetzt wird der TEXT, nachgeschlagen wird die deutsche Art ------------------------
// tr() liefert hier wie unter ?lang=en die englische Fassung.
const englisch = makeContext((key, deutsch) => (key === "spotlight.labelType.vulkan" ? "Volcano" : deutsch));
englisch.buildRegionLabelViewPopupHtml({
	publicId: "b4", text: "Ceälan", labelType: "vulkan", wikiRegion: null, coordinates: [1, 2],
});
assert.strictEqual(englisch.__gerufen.header.untertitel, "Volcano",
	"der angezeigte Typ geht durch tr()");
assert.strictEqual(englisch.__gerufen.header.basename, "gebirge",
	"💣 das Kopfbild NICHT -- INFO_HEADER_IMAGE_BY_ART kennt nur die deutschen Arten");

// ---- 6. Der Spion: die geteilte Tabelle wird wirklich gelesen ---------------------------------
const spion = makeContext();
vm.runInContext('AVESMAPS_LABEL_ART_NAMEN.vulkan = "AUSGETAUSCHT";', spion);
spion.buildRegionLabelViewPopupHtml({
	publicId: "b5", text: "Ceälan", labelType: "vulkan", wikiRegion: null, coordinates: [1, 2],
});
assert.strictEqual(spion.__gerufen.header.untertitel, "AUSGETAUSCHT",
	"die Art kommt aus js/ui/label-arten.js, nicht aus einer Abschrift in map-features-labels.js");

console.log("label-infobox-eigene-art.test.js: alle Zusicherungen erfuellt");
