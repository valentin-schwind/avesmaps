"use strict";
// Infobox: „Auch Teil von" / „Verläuft auch über" (Entwurf 2026-09-14 §2.4, §3.4).
// Aus der Wurzel: node js/map-features/__tests__/weg-weitere-anzeige.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	escapeHtml: (w) => String(w).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	pathItemStationLinkMarkup: (text, treffer) => `<button data-station-kind="${treffer.kind}" data-station-ref="${treffer.ref}">${text}</button>`,
	wikiUrlToDeeplinkKey: (url) => String(url || "").split("/wiki/")[1] || "",
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: () => false,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: false,
});
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
const A = require(path.join(WURZEL, "js/map-features/weg-weitere-anzeige.js"));

// 1. Rein
const zeilen = A.avesmapsWegWeitereZeilen({
	auchTeil: [{ name: "Bärenpfad", ref: "Baerenpfad", zusatz: "" }],
	verlaeuftUeber: [{ name: "Reichsstraße 2", ref: "", zusatz: "Abschnitt 2: Silkwiesen – Wieha" }],
}, global.pathItemStationLinkMarkup);
assert.ok(zeilen.includes("<dt>Auch Teil von</dt>") && zeilen.includes('data-station-ref="Baerenpfad"'));
assert.ok(zeilen.includes("<dt>Verläuft auch über</dt><dd>Reichsstraße 2 (Abschnitt 2: Silkwiesen – Wieha)</dd>"), "ohne Adresse reiner Text: " + zeilen);
assert.strictEqual(A.avesmapsWegWeitereZeilen({ auchTeil: [], verlaeuftUeber: [] }, global.pathItemStationLinkMarkup), "");

// 2. Gegen eine kleine Karte
global.locationData = [{ name: "Perz", coordinates: [0, 0] }, { name: "Silkwiesen", coordinates: [0, 1] }, { name: "Wieha", coordinates: [0, 2] }];
const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
const weg = (id, von, bis, haupt, weitere = []) => ({ properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "X-" + id,
	display_name: haupt.name, wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: url(haupt.seite) }, wiki_path_weitere: weitere },
	geometry: { coordinates: [von, bis] } });
const rs = { key: "reichsstrasse-2", name: "Reichsstraße 2", seite: "Reichsstrasse_2" };
const bp = { key: "b-renpfad", name: "Bärenpfad", seite: "Baerenpfad" };
global.pathData = [
	weg("rs-6", [0, 0], [1, 0], rs),
	weg("rs-7", [1, 0], [2, 0], rs, [{ wiki_key: bp.key, name: bp.name, wiki_url: url(bp.seite) }]),
	weg("bp-1", [5, 5], [6, 6], bp),
];
const [rs6, rs7, bp1] = global.pathData;

const amAbschnitt = A.avesmapsWegWeitereZeilenMarkup(rs7, null);
assert.ok(amAbschnitt.includes('data-station-ref="Baerenpfad">Bärenpfad</button>'), "der Abschnitt nennt seine weitere Zuweisung");
// R27 (Task 11 Fix 2): am Abschnitt traegt IMMER er selbst den Artikel -- keine Klammer, die ihn (den
// gerade geoeffneten Abschnitt) noch einmal nennt.
assert.ok(!amAbschnitt.includes("(Abschnitt"), "am Abschnitt keine Klammer bei \"Auch Teil von\": " + amAbschnitt);
assert.strictEqual(A.avesmapsWegWeitereZeilenMarkup(rs6, null), "", "ohne weitere Zuweisung und ohne Traeger keine Zeile");
const vomBaerenpfad = A.avesmapsWegWeitereZeilenMarkup(bp1, null);
assert.ok(vomBaerenpfad.includes("<dt>Verläuft auch über</dt>"), vomBaerenpfad);
assert.ok(vomBaerenpfad.includes('data-station-ref="Reichsstrasse_2">Reichsstraße 2</button> (Abschnitt 2: Silkwiesen – Wieha)'), vomBaerenpfad);
const ganz = A.avesmapsWegWeitereZeilenMarkup(rs6, { gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.ok(ganz.includes("Bärenpfad</button> (Abschnitt 2: Silkwiesen – Wieha)"), "ganze Strasse: mit dem Abschnitt, der ihn traegt: " + ganz);

// 3. Fuellen ersetzt genau den Platzhalter
const markup = "<dl>" + A.avesmapsWegWeiterePlatzhalter("rs-7") + "</dl>";
const gefuellt = A.avesmapsWegWeitereFuellen(markup, rs7);
assert.ok(gefuellt.includes('<div class="avesmaps-path-weitere" data-path-weitere="rs-7"><div class="region-info-box__row"><dt>Auch Teil von</dt>'), gefuellt);
assert.strictEqual(A.avesmapsWegWeitereFuellen("<dl></dl>", rs7), "<dl></dl>", "ohne Platzhalter unveraendert");

// 4. Verdrahtung
const rendering = lies("js/map-features/map-features-path-rendering.js");
const lage = rendering.indexOf('rows += lageHtml ? rowHtml("Lage", lageHtml) : row("Lage", wiki.lage);');
assert.ok(lage > 0 && rendering.indexOf("avesmapsWegWeiterePlatzhalter(getPathPublicId(path))", lage) > lage
	&& rendering.indexOf("avesmapsWegWeiterePlatzhalter(getPathPublicId(path))", lage) < rendering.indexOf('row("Länge"', lage),
	"der Platzhalter steht direkt nach der Lage-Zeile");
const panel = lies("js/map-features/map-features-infopanel.js");
const zeige = panel.slice(panel.indexOf("window.avesmapsShowPathInInfopanel = function"), panel.indexOf("window.avesmapsShowInfopanel(markup);", panel.indexOf("window.avesmapsShowPathInInfopanel = function")));
assert.ok(zeige.includes("avesmapsWegWeitereFuellen(markup, path)"), "das Infopanel fuellt den Platzhalter vor dem Anzeigen");

// 5. Klick-Paritaet (Ruling R26, Task 11 Fix 1): ein Linien-Klick und ein Klick auf den WEG-NAMEN muessen
// dieselben Zeilen zeigen -- der Platzhalter darf nicht davon abhaengen, welche der beiden Klickflaechen
// (und welcher der beiden Zweige -- Infopanel oder schwebendes Popup) getroffen wird. Ausgefuehrt wird der
// ECHTE, aus dem Quelltext geschnittene Zweig (nicht nur gegrept), mit der ECHTEN avesmapsWegWeitereFuellen.
function schneide(text, start, biszu) {
	const von = text.indexOf(start);
	assert.ok(von > 0, "Anker nicht gefunden: " + start);
	const bisIdx = text.indexOf(biszu, von);
	assert.ok(bisIdx > von, "Ende-Anker nicht gefunden nach dem Start: " + biszu);
	return { von, bis: bisIdx + biszu.length, text: text.slice(von, bisIdx + biszu.length) };
}
function baueHandler(parameterNamen, rumpf) {
	const quelle = "(function(" + parameterNamen.join(", ") + ") {\n" + rumpf + "\n})";
	return new vm.Script(quelle, { filename: "geschnittener-klick-zweig.js" }).runInNewContext({});
}
function lPopupSpion() {
	const aufrufe = [];
	const L = {
		popup(options) {
			const eintrag = { options, latlng: null, content: null, geoeffnet: false };
			aufrufe.push(eintrag);
			const kette = {
				setLatLng(ll) { eintrag.latlng = ll; return kette; },
				setContent(c) { eintrag.content = c; return kette; },
				openOn(m) { eintrag.geoeffnet = true; eintrag.map = m; return kette; },
			};
			return kette;
		},
	};
	return { L, aufrufe };
}

// -- Linien-Klick (js/map-features/map-features-path-rendering.js, line.on("click", ...)) --------------
const renderQuelle = lies("js/map-features/map-features-path-rendering.js");
const linienZweig = schneide(
	renderQuelle,
	'// Infopanel (?infopanel=true): Weg-/Fluss-Info ins rechte Panel statt ins schwebende Popup.',
	".openOn(map);",
);
const linienHandler = baueHandler(["path", "event", "window", "map", "L", "avesmapsWegWeitereFuellen"], linienZweig.text + "\n}");

// -- Namen-Klick (js/map-features/map-features-path-label-canvas-overlay.js, map.on("click", ...)) ------
const overlayQuelle = lies("js/map-features/map-features-path-label-canvas-overlay.js");
const naechsterAbschnitt = overlayQuelle.indexOf("// Cursor-Feedback (billig, throttled)");
assert.ok(naechsterAbschnitt > 0, "Ende-Anker des Namen-Klick-Blocks nicht gefunden");
const namenStart = overlayQuelle.indexOf("const labeledPath = findPathForWayLabelEntry(hit);");
assert.ok(namenStart > 0 && namenStart < naechsterAbschnitt, "Start-Anker des Namen-Klick-Blocks nicht gefunden");
const letztesOpenOn = overlayQuelle.lastIndexOf(".openOn(map);", naechsterAbschnitt);
assert.ok(letztesOpenOn > namenStart, "kein .openOn(map) im Namen-Klick-Block gefunden");
const namenZweig = overlayQuelle.slice(namenStart, letztesOpenOn + ".openOn(map);".length);
const namenHandler = baueHandler(
	["hit", "window", "map", "L", "findPathForWayLabelEntry", "createPathPopupMarkup", "wayLabelPopupMarkup", "avesmapsWegWeitereFuellen", "pathHasWiki"],
	namenZweig,
);

// rs7 traegt eine weitere Zuweisung (Baerenpfad) -- echte, nicht-leere Zeilen beim Fuellen.
rs7._popupMarkup = "<dl>" + A.avesmapsWegWeiterePlatzhalter(rs7.properties.public_id) + "</dl>";
const roherPlatzhalter = rs7._popupMarkup;

// A. Linien-Klick, KEIN Infopanel (schwebendes Popup) -- muss fuellen.
{
	const { L, aufrufe } = lPopupSpion();
	linienHandler(rs7, { latlng: { lat: 0, lng: 0 } }, {}, {}, L, A.avesmapsWegWeitereFuellen);
	assert.strictEqual(aufrufe.length, 1, "Linien-Klick ohne Infopanel muss den Popup oeffnen");
	assert.ok(aufrufe[0].content.includes('data-station-ref="Baerenpfad">Bärenpfad</button>'),
		"Linien-Klick-Popup zeigt die ungefuellten Zeilen nicht: " + aufrufe[0].content);
	assert.notStrictEqual(aufrufe[0].content, roherPlatzhalter, "Linien-Klick-Popup blieb der rohe, ungefuellte Platzhalter");
}
// B. Linien-Klick MIT erfolgreichem Infopanel -- der Popup-Zweig darf gar nicht laufen (wie am echten Klick).
{
	const { L, aufrufe } = lPopupSpion();
	let aufgerufenMit = null;
	const window_ = { avesmapsShowPathInInfopanel: (p) => { aufgerufenMit = p; return true; } };
	linienHandler(rs7, { latlng: { lat: 0, lng: 0 } }, window_, {}, L, A.avesmapsWegWeitereFuellen);
	assert.strictEqual(aufgerufenMit, rs7, "das Infopanel muss mit demselben Pfad gerufen werden");
	assert.strictEqual(aufrufe.length, 0, "bei erfolgreichem Infopanel darf kein Popup geoeffnet werden");
}

// C. Namen-Klick, KEIN Infopanel (schwebendes Popup) -- muss denselben Fuell-Schritt durchlaufen wie A.
{
	const { L, aufrufe } = lPopupSpion();
	namenHandler(
		{ anchorLatLng: { lat: 0, lng: 0 } }, {}, {}, L,
		() => rs7, undefined, () => "<div>Kurzfassung</div>", A.avesmapsWegWeitereFuellen,
		(p) => Boolean(p?.properties?.wiki_path?.wiki_key),
	);
	assert.strictEqual(aufrufe.length, 1, "Namen-Klick ohne Infopanel muss den Popup oeffnen");
	assert.ok(aufrufe[0].content.includes('data-station-ref="Baerenpfad">Bärenpfad</button>'),
		"Namen-Klick-Popup zeigt die ungefuellten Zeilen nicht (die urspruengliche Luecke, Concern 1): " + aufrufe[0].content);
	assert.notStrictEqual(aufrufe[0].content, roherPlatzhalter, "Namen-Klick-Popup blieb der rohe, ungefuellte Platzhalter");
}
// D. Namen-Klick MIT erfolgreichem Infopanel -- dieselbe Route wie der Linien-Klick (B), kein eigenes Popup.
{
	const { L, aufrufe } = lPopupSpion();
	let aufgerufenMit = null;
	const window_ = { avesmapsShowPathInInfopanel: (p) => { aufgerufenMit = p; return true; } };
	namenHandler(
		{ anchorLatLng: { lat: 0, lng: 0 } }, window_, {}, L,
		() => rs7, undefined, () => "<div>Kurzfassung</div>", A.avesmapsWegWeitereFuellen,
		(p) => Boolean(p?.properties?.wiki_path?.wiki_key),
	);
	assert.strictEqual(aufgerufenMit, rs7, "das Infopanel muss mit demselben Pfad gerufen werden wie am Linien-Klick");
	assert.strictEqual(aufrufe.length, 0, "bei erfolgreichem Infopanel darf der Namen-Klick keinen eigenen Popup oeffnen");
}

console.log("weg-weitere-anzeige.test.js: ok");
