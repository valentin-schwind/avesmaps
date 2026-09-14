"use strict";
// Infobox: „Auch Teil von" / „Verläuft auch über" (Entwurf 2026-09-14 §2.4, §3.4).
// Aus der Wurzel: node js/map-features/__tests__/weg-weitere-anzeige.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

assert.ok(A.avesmapsWegWeitereZeilenMarkup(rs7, null).includes('data-station-ref="Baerenpfad">Bärenpfad</button>'), "der Abschnitt nennt seine weitere Zuweisung");
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

console.log("weg-weitere-anzeige.test.js: ok");
