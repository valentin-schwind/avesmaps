// „Grenzen berechnen" muss das Gebiet treffen, in dem der Klick WIRKLICH liegt.
//
// 💣 Der Befund (25.08.2026): ein Rechtsklick mitten in „Königsland Nostria" (358,4 / 543,2)
// landete beim „Fürstentum Albernia" -- einem Reich, dessen Fläche dort nicht einmal in der Nähe
// liegt. Grund: findSmallestEnclosingDerivedRegion pruefte UMHUELLENDE RECHTECKE. Albernias
// Rechteck (x 330-428, y 476-561) ist kleiner als Nostrias (x 313-443, y 528-623) und ueberdeckt
// den Punkt mit, also gewann Albernia. Live gemessen hat der Lauf daraufhin
// `Grafschaft Großer Fluss -> Fürstentum Albernia -> Kaiserreich` gerechnet, waehrend Nostrias
// Huelle seit dem 12.06.2026 unveraendert stehenblieb. Fuer den Editor sah es dreimal so aus, als
// taete der Knopf nichts.
//
// 🪤 Und die Kante, die es so schwer sichtbar machte: fuenf Einheiten weiter noerdlich
// (Seegrafschaft Siebenwind, y 566,6) liegt derselbe Klick knapp AUSSERHALB von Albernias Rechteck
// -- dort traf er richtig. Eine Regel, die an der Kante eines FREMDEN Rechtecks umschlaegt, ist
// keine Regel, sondern Glueckssache.
//
// 🔴 Geprueft wird mit dem ECHTEN Punkt-im-Polygon aus map-features-point-in-polygon.js, nicht mit
// einem Stub -- ein Stub wuerde nur sich selbst zertifizieren.
//
// Lauf (aus dem Repo-Wurzelverzeichnis):
//   node js/map-features/__tests__/derived-boundary-ziel-punkt.test.js

"use strict";

const assert = require("assert");
const path = require("path");

// Das Bauteil sucht seinen Punkttest ueber window.AvesmapsPip -- genau wie im Browser.
const pip = require(path.join(__dirname, "..", "map-features-point-in-polygon.js"));
global.window = { AvesmapsPip: pip };

const {
	avesmapsFindEnclosingDerivedTargetFeature,
	avesmapsDerivedTargetGeometryArea,
} = require(path.join(__dirname, "..", "map-features-derived-boundary-context-action.js"));

let checks = 0;
const pruefe = (bedingung, warum) => { assert.ok(bedingung, warum); checks++; };

const KLICK = [358.4, 543.2]; // Mitte von Koenigsland Nostria, live gemessen (GeoJSON [x, y])
const NOSTRIA = "5a9c98a9-8d50-4e7c-80a1-1ad180f54dc9";
const ALBERNIA = "albernia-uuid";
const KAISERREICH = "kaiserreich-uuid";
const KOENIGSLAND = "758ba101-910f-4a21-95d4-4422ebc72766";

const huelle = (territoryPublicId, name, ring) => ({
	type: "Feature",
	properties: { is_derived_geometry: true, territory_public_id: territoryPublicId, name },
	geometry: { type: "Polygon", coordinates: [ring] },
});
const rechteck = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

// Albernia: dieselbe Huellbox wie live (x 330-428, y 476-561), aber die Flaeche haengt im Norden
// und im Osten -- der Klickpunkt liegt in der AUSSPARUNG.
const albernia = huelle(ALBERNIA, "Fürstentum Albernia", [
	[330, 476], [428, 476], [428, 561], [390, 561], [390, 490], [330, 490], [330, 476],
]);
const nostria = huelle(NOSTRIA, "Königreich Nostria", rechteck(313, 528, 443, 623));
const kaiserreich = huelle(KAISERREICH, "Heiliges Neues Kaiserreich", rechteck(330, 80, 756, 706));
// Quellflaeche, keine Huelle -- darf nie Ziel werden.
const quellflaeche = {
	type: "Feature",
	properties: { is_derived_geometry: false, territory_public_id: KOENIGSLAND, name: "Königsland Nostria" },
	geometry: { type: "Polygon", coordinates: [rechteck(337, 527, 379, 558)] },
};

const regionData = [albernia, nostria, kaiserreich, quellflaeche];

// ── Die Wache muss Zaehne haben ─────────────────────────────────────────────────────────────────
// Ohne diese drei Zusicherungen koennte der Test gruen sein, obwohl er die alte Regel gar nicht
// von der neuen unterscheidet.
{
	const bboxFlaeche = (ring) => {
		const xs = ring.map((c) => c[0]); const ys = ring.map((c) => c[1]);
		return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
	};
	pruefe(
		bboxFlaeche(albernia.geometry.coordinates[0]) < bboxFlaeche(nostria.geometry.coordinates[0]),
		"Gegenprobe: Albernias RECHTECK ist kleiner als Nostrias -- nach der alten Regel haette es gewonnen."
	);
	pruefe(
		pip.pointInGeometry(KLICK, albernia.geometry) === false,
		"Gegenprobe: der Klickpunkt liegt wirklich AUSSERHALB von Albernias Flaeche."
	);
	pruefe(
		pip.pointInGeometry(KLICK, nostria.geometry) === true,
		"Gegenprobe: und wirklich INNERHALB von Nostrias Flaeche."
	);
}

// ── 1. Der Kern ─────────────────────────────────────────────────────────────────────────────────
{
	const treffer = avesmapsFindEnclosingDerivedTargetFeature(KLICK, regionData, KOENIGSLAND);
	pruefe(!!treffer, "Es wird ueberhaupt ein Ziel gefunden.");
	pruefe(
		treffer.properties.territory_public_id === NOSTRIA,
		"Der Klick in Koenigsland Nostria trifft Koenigreich Nostria -- nicht Albernia, dessen Rechteck kleiner ist."
	);
}

// ── 2. Verschachtelt: die INNERSTE Huelle gewinnt ───────────────────────────────────────────────
{
	const grafschaft = huelle("grafschaft-uuid", "Grafschaft", rechteck(340, 530, 380, 560));
	const treffer = avesmapsFindEnclosingDerivedTargetFeature(KLICK, [kaiserreich, nostria, grafschaft], KOENIGSLAND);
	pruefe(
		treffer && treffer.properties.territory_public_id === "grafschaft-uuid",
		"Liegen mehrere Huellen ueber dem Punkt, gewinnt die mit der kleinsten ECHTEN Flaeche."
	);
}

// ── 3. Das angeklickte Gebiet selbst ist nie sein eigenes Ziel ──────────────────────────────────
{
	const eigeneHuelle = huelle(KOENIGSLAND, "Königsland Nostria", rechteck(337, 527, 379, 558));
	const treffer = avesmapsFindEnclosingDerivedTargetFeature(KLICK, [eigeneHuelle, nostria], KOENIGSLAND);
	pruefe(
		treffer && treffer.properties.territory_public_id === NOSTRIA,
		"Die Huelle des angeklickten Gebiets wird uebersprungen -- sonst zeigte der Klick auf sich selbst."
	);
}

// ── 4. Nichts umschliesst den Punkt -> null, KEIN Rueckfall aufs Rechteck ───────────────────────
{
	pruefe(
		avesmapsFindEnclosingDerivedTargetFeature(KLICK, [albernia], KOENIGSLAND) === null,
		"Deckt keine Flaeche den Punkt, ist 'nichts' die Antwort -- nicht das naechstbeste Rechteck."
	);
	pruefe(
		avesmapsFindEnclosingDerivedTargetFeature(KLICK, [quellflaeche], KOENIGSLAND) === null,
		"Eine Quellflaeche ist keine Huelle und wird nie Ziel."
	);
	pruefe(avesmapsFindEnclosingDerivedTargetFeature(null, regionData, KOENIGSLAND) === null, "Ohne Punkt kein Ziel.");
	pruefe(avesmapsFindEnclosingDerivedTargetFeature(KLICK, null, KOENIGSLAND) === null, "Ohne Daten kein Ziel.");
}

// ── 5. Die Flaechenrechnung: Loecher zaehlen ab, MultiPolygon zaehlt zusammen ───────────────────
{
	const mitLoch = {
		type: "Polygon",
		coordinates: [rechteck(0, 0, 10, 10), rechteck(2, 2, 4, 4)],
	};
	pruefe(
		Math.abs(avesmapsDerivedTargetGeometryArea(mitLoch) - 96) < 1e-6,
		"Ein Loch wird abgezogen (100 - 4 = 96) -- sonst gewaenne eine grosse Huelle mit Loch gegen eine kleine."
	);
	const multi = { type: "MultiPolygon", coordinates: [[rechteck(0, 0, 2, 2)], [rechteck(10, 10, 13, 13)]] };
	pruefe(
		Math.abs(avesmapsDerivedTargetGeometryArea(multi) - 13) < 1e-6,
		"Ein MultiPolygon zaehlt seine Teilflaechen zusammen (4 + 9 = 13)."
	);
	pruefe(
		avesmapsDerivedTargetGeometryArea(null) === Number.POSITIVE_INFINITY,
		"Ohne Geometrie ist die Flaeche unendlich -- so eine Huelle gewinnt nie gegen eine echte."
	);
}

console.log(`derived-boundary-ziel-punkt: ${checks} Zusicherungen gruen`);
