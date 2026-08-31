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

// ---- 7. EINE VON HAND GESETZTE ART SCHLAEGT DIE WIKI-ART (Owner 31.08.2026) ------------------
//
// 💣 DER BEFUND: der Altenforst ist als `urwald` eingetragen, das Wiki sagt "Wald" -- und die
// Infobox sagte trotzdem "Wald". Die Wiki-Art gewann BEDINGUNGSLOS, womit der Wiki-Override
// (AGENTS.md §11) an dieser einen Stelle wirkungslos war: der Editor sah im Bearbeiten-Popup
// "Urwald" (labelPopupSubtitle liest nur die eigene Art) und der Karten-Schwebezettel ebenfalls,
// nur der Besucher sah "Wald". Dieselbe Frage, drei Erzeuger, einer scherte aus.
//
// 🔴 Die Herkunft liegt seit dem 18.08.2026 am Label (`fieldOrigins`, map-features-labels.js:82) --
// gefehlt hat nur, dass sie hier gefragt wird. `manual` heisst: jemand hat diesen Wert ausdruecklich
// gesetzt, in Kenntnis dessen, was das Wiki sagt.
//
// 💣 UND DAS KOPFBILD HAENGT AM SELBEN AUSDRUCK: `urwald` hat seit dem 30.08.2026 ein eigenes Bild
// (INFO_HEADER_IMAGE_BY_ART). Der Altenforst bekam deshalb nicht nur den falschen Untertitel,
// sondern auch das Waldbild -- ein zweiter, unbemerkter Teil desselben Fehlers.
const altenforst = makeContext();
altenforst.buildRegionLabelViewPopupHtml({
	publicId: "22b77418-c647-41c6-83ab-53dd80fd886a",
	text: "Altenforst",
	labelType: "urwald",
	fieldOrigins: { feature_subtype: "manual" },
	wikiRegion: { art: "Wald", name: "Altenforst" },
	coordinates: [1, 2],
});
assert.strictEqual(altenforst.__gerufen.header.untertitel, "Urwald",
	"eine von Hand gesetzte Art schlaegt die Wiki-Art -- sonst ist der Wiki-Override hier wirkungslos");
assert.strictEqual(altenforst.__gerufen.header.basename, "urwald",
	"💣 und das Kopfbild folgt ihr mit: urwald hat seit dem 30.08.2026 ein eigenes");

// ---- 8. OHNE HERKUNFT BLEIBT DIE WIKI-ART VORNE ----------------------------------------------
//
// 🔴 Das ist der BESTAND und der weitaus groessere Teil: 442 der 615 Beschriftungen mit Wiki-Art
// tragen keine Herkunft an ihrem Subtyp (live gemessen 31.08.2026). Fuer sie aendert sich nichts --
// die Wiki-Art ist dort feiner als unser Vokabular, und die Regel aus Fall 2 gilt unveraendert
// weiter. `null` heisst "nicht bekannt", NIE "von Hand".
const ohneHerkunft = makeContext();
ohneHerkunft.buildRegionLabelViewPopupHtml({
	publicId: "b6", text: "Irgendwald", labelType: "urwald",
	fieldOrigins: null,
	wikiRegion: { art: "Wald" }, coordinates: [1, 2],
});
assert.strictEqual(ohneHerkunft.__gerufen.header.untertitel, "Wald",
	"ohne belegte Herkunft bleibt die feinere Wiki-Art vorne -- der unveraenderte Bestand");

// ---- 9. "region" IST KEINE AUSSAGE, AUCH NICHT VON HAND (Owner-Entscheid 31.08.2026) ----------
//
// 💣 DIE EINE AUSNAHME, und sie ist gemessen, nicht geraten: `region` ist beim Label der NEUTRALE
// Subtyp ("keine Art" -- so steht es woertlich in map-features-ecosystem-label-writeback.js). Er
// wird auch dann als `manual` gestempelt, wenn niemand eine Art WAEHLEN wollte. Ohne diese Ausnahme
// verloeren fuenf Beschriftungen live ihre einzige Auskunft: Weiden und Regengebirge das "Gebirge",
// Galottas Insel die "Insel", Ongalo das "Flusstal", Wilder Sueden die "Mischregion".
const weiden = makeContext();
weiden.buildRegionLabelViewPopupHtml({
	publicId: "b7", text: "Weiden", labelType: "region",
	fieldOrigins: { feature_subtype: "manual" },
	wikiRegion: { art: "Gebirge" }, coordinates: [1, 2],
});
assert.strictEqual(weiden.__gerufen.header.untertitel, "Gebirge",
	"der neutrale Ruecklfall \"region\" verdraengt die Wiki-Art nicht, auch als manual nicht");

// ---- 10. HERKUNFT "wiki" IST KEINE EIGENE WAHL ------------------------------------------------
//
// 🔴 Gefragt wird auf `manual` GENAU, nicht auf "ist ein Eintrag da". Ein Feld, das der Sync selbst
// gesetzt hat, traegt `wiki` -- es als eigene Wahl zu lesen drehte die Regel fuer genau die Faelle
// um, fuer die sie gebaut ist.
const ausWiki = makeContext();
ausWiki.buildRegionLabelViewPopupHtml({
	publicId: "b8", text: "Uebernommen", labelType: "urwald",
	fieldOrigins: { feature_subtype: "wiki" },
	wikiRegion: { art: "Wald" }, coordinates: [1, 2],
});
assert.strictEqual(ausWiki.__gerufen.header.untertitel, "Wald",
	"eine vom Sync gesetzte Art ist keine eigene Wahl");

// ---- 11. DIE HERKUNFT DES NAMENS IST NICHT DIE DER ART ----------------------------------------
//
// 💣 `field_origins` traegt BEIDE Wiki-Felder des Labels (`text` und `feature_subtype`). Wer nur
// fragt, ob die Karte ueberhaupt einen Eintrag hat, laesst ein von Hand umbenanntes Label seine
// Wiki-Art verlieren -- ein Fehler, der genau die Beschriftungen traefe, die am meisten gepflegt
// sind.
const nurName = makeContext();
nurName.buildRegionLabelViewPopupHtml({
	publicId: "b9", text: "Umbenannt", labelType: "urwald",
	fieldOrigins: { text: "manual" },
	wikiRegion: { art: "Wald" }, coordinates: [1, 2],
});
assert.strictEqual(nurName.__gerufen.header.untertitel, "Wald",
	"nur der NAME wurde von Hand gesetzt -- die Art bleibt unbelegt, also gewinnt das Wiki");

console.log("label-infobox-eigene-art.test.js: alle Zusicherungen erfuellt");
