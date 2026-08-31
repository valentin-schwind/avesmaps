// Eine kleine, aber VOLLSTAENDIGE Karte: je ein Vertreter jeder Ebene, die der Abzug fuehrt.
// Geteilt von abzug-bauen.test.js (baut daraus einen Abzug) und endpunkt-ablauf.js (laesst den
// Endpunkt ihn wirklich ueber HTTP ausliefern).
//
// ⚠️ Die Fixture muss die vier Dinge enthalten, die die Abnahme verlangt -- Landschaften,
// Wege, Gewaesser, Orte --, sonst gehen die Abnahmepunkte durch, ohne je etwas gesehen zu
// haben. „Gewaesser" heisst dabei: ein Flussweg (Weg mit feature_subtype) UND eine Wasserflaeche
// (see/meer), denn genau so liegen sie in den Daten.
"use strict";

const OEKOSYSTEME = [
	{ properties: { kind: "klima", region_type: "tropisch" },
		geometry: { type: "Polygon", coordinates: [[[0, 0], [1024, 0], [1024, 300], [0, 300], [0, 0]]] } },
	{ properties: { kind: "vegetation", region_type: "wald", name: "Salamandersteine" },
		geometry: { type: "Polygon", coordinates: [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]] } },
	{ properties: { kind: "topographie", region_type: "meer", name: "Perlenmeer" },
		geometry: { type: "Polygon", coordinates: [[[600, 600], [900, 600], [900, 900], [600, 900], [600, 600]]] } },
	{ properties: { kind: "topographie", region_type: "see", name: "Angbarer See" },
		geometry: { type: "Polygon", coordinates: [[[300, 300], [340, 300], [340, 340], [300, 340], [300, 300]]] } },
	{ properties: { kind: "topographie", region_type: "gebirge", name: "Amdeggynmassiv" },
		geometry: { type: "Polygon", coordinates: [[[120, 120], [180, 120], [180, 180], [120, 180], [120, 120]]] } },
];

const MAP_FEATURES = {
	revision: 76178,
	features: [
		{ properties: { public_id: "p1", feature_type: "path", feature_subtype: "Reichsstrasse", name: "Reichsstrasse 2" },
			geometry: { type: "LineString", coordinates: [[100, 100], [300, 250], [500, 260]] } },
		{ properties: { public_id: "p2", feature_type: "path", feature_subtype: "Flussweg", name: "Grosser Fluss" },
			geometry: { type: "LineString", coordinates: [[310, 320], [420, 380], [600, 640]] } },
		{ properties: { public_id: "p3", feature_type: "path", feature_subtype: "Seeweg", name: "Suedmeerroute" },
			geometry: { type: "LineString", coordinates: [[620, 620], [880, 880]] } },
		{ properties: { public_id: "l1", feature_type: "location", settlement_class: "metropole", name: "Gareth" },
			geometry: { type: "Point", coordinates: [400, 500] } },
		{ properties: { public_id: "l2", feature_type: "location", settlement_class: "dorf", name: "Angbar" },
			geometry: { type: "Point", coordinates: [150, 150] } },
		{ properties: { public_id: "pw1", feature_type: "powerline", name: "Kraftlinie Nord" },
			geometry: { type: "LineString", coordinates: [[10, 10], [200, 400]] } },
		{ properties: { public_id: "lb1", feature_type: "label", name: "Das Mittelreich" },
			geometry: { type: "Point", coordinates: [420, 520] } },
	],
};

const TERRITORIES = { territories: [
	{ properties: { public_id: "t1", name: "Koenigreich Kosch" },
		geometry: { type: "Polygon", coordinates: [[[120, 120], [260, 120], [260, 260], [120, 260], [120, 120]]] } },
] };

const ECO_REVISION = "21358";
const EXPORTIERT = "2026-08-23T03:17:00.000Z";

// Den Abzug aus der Fixture bauen -- mit den Einstellungen des naechtlichen Laeufers.
// `{ glatt: true }` nimmt dessen ZWEITE Fassung (Bezierkurven, `?smooth=1`).
// ⚠️ Die Einstellungen kommen aus dem Laeufer, nicht aus einer Kopie hier: sonst prueft der
// Ablauf eine Zusammenstellung, die es nirgends gibt.
function baueFixtureAbzug(optionen) {
	const B = require("../../../js/pages/svg-export-build.js");
	const L = require("../abzug-bauen.js");
	const T = require("../tokens-tafel.js");
	const path = require("path");
	const wurzel = path.resolve(__dirname, "..", "..", "..");
	const token = T.svgxTokenLeser(path.join(wurzel, "css", "base", "tokens.css"));
	const einstellungen = (optionen && optionen.glatt)
		? B.SVGX_ABZUG_EINSTELLUNGEN_GLATT
		: L.ABZUG_EINSTELLUNGEN;

	return B.svgxBuildDocument(Object.assign({}, einstellungen, {
		mapFeatures: MAP_FEATURES,
		territories: TERRITORIES,
		ecosystems: OEKOSYSTEME,
		ecoRevision: ECO_REVISION,
		exportedAt: EXPORTIERT,
	}, L.vorgabeFarben(OEKOSYSTEME, token)));
}

module.exports = {
	OEKOSYSTEME: OEKOSYSTEME,
	MAP_FEATURES: MAP_FEATURES,
	TERRITORIES: TERRITORIES,
	ECO_REVISION: ECO_REVISION,
	EXPORTIERT: EXPORTIERT,
	baueFixtureAbzug: baueFixtureAbzug,
};
