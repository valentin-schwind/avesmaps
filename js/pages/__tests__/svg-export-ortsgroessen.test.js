// Die Zirkel der Orte im SVG-Abzug haben einen MASSSTAB -- sie sind so gross, wie die Karte den
// Ort auf ihrer hoechsten Zoomstufe zeichnet. Vorher waren es sechs frei gegriffene Zahlen: eine
// Metropole mass 13,2 Meilen, ein Dorf 4,2 (bei 1 Karteneinheit = 3 Meilen). Owner 22.08.2026:
// "die zirkel sind aktuell viel zu gross".
//
// Lauf aus der Wurzel des Repos:  node js/pages/__tests__/svg-export-ortsgroessen.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const B = require("../svg-export-build.js");

// Der Bauer selbst kennt die Zoombaender NICHT (er ist rein und wird ohne sie geladen). Dieser
// Test ist die einzige Stelle, an der beide Dateien zusammenkommen -- und genau deshalb der
// Waechter gegen ihr Auseinanderlaufen.
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../../map-features/location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);

const NAHE = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} (war ${a}, erwartet ${b})`);

// ---- 1. Die Umrechnung: px am Bildschirm -> Karteneinheiten -------------------------------
// L.CRS.Simple skaliert mit 2^zoom, die Karte ist 1024 Einheiten breit. Bei z7 ist eine Einheit
// also 128 px -- ein Aussendurchmesser von 256 px ist somit genau 1 Einheit RADIUS.
{
	const kinds = B.svgxPlaceKindsFromBands({
		metropole: [null, null, null, null, null, null, null, 256, 256],
	});
	const m = kinds.find((k) => k.slug === "metropole");
	NAHE(m.r, 1, "256 px Aussendurchmesser bei z7 sind 1 Karteneinheit Radius");

	// Die Probe in die andere Richtung: die Zahl haengt am DURCHMESSER, nicht am Radius --
	// wer die Halbierung vergisst, bekommt hier das Doppelte.
	const halb = B.svgxPlaceKindsFromBands({
		metropole: [null, null, null, null, null, null, null, 128, 128],
	}).find((k) => k.slug === "metropole");
	NAHE(halb.r, 0.5, "der Bandwert ist der Aussendurchmesser, nicht der Radius");
}

// 💣 Gemessen wird z7, nicht die letzte Spalte der Tafel. Die Datenschicht traegt z8 bereits
// (AVESMAPS_ZOOM_BAND_MAX_ZOOM = 8), die Karte kennt es nicht -- in der Vorgabe erbt z8 den Wert
// von z7, eine Uebersteuerung muss das aber nicht tun.
{
	const kinds = B.svgxPlaceKindsFromBands({
		metropole: [null, null, null, null, null, null, null, 256, 999],
	});
	NAHE(kinds.find((k) => k.slug === "metropole").r, 1,
		"z8 darf den Massstab nicht bestimmen -- die Karte zeigt diese Stufe nie");
}

// ---- 2. Der Abnahmefall: was die Vorgabetafel ergibt ---------------------------------------
// Die sechs Zahlen als Zeuge. Sie stammen aus AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker (z7)
// geteilt durch 256 -- wer sie "anpasst", damit ein Test gruen wird, hat den Test entwertet.
{
	const erwartet = {
		metropole: 0.2078,   // 53,2 px  -> 1,25 Meilen Durchmesser (rund 2,0 km)
		grossstadt: 0.1559,  // 39,9 px
		stadt: 0.1247,       // 31,92 px
		kleinstadt: 0.097,   // 24,82 px
		dorf: 0.0693,        // 17,74 px -> 0,42 Meilen (rund 670 m)
		gebaeude: 0.0485,    // 12,42 px
	};
	const kinds = B.svgxPlaceKindsFromBands(AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker);
	Object.entries(erwartet).forEach(([slug, r]) => {
		const kind = kinds.find((k) => k.slug === slug);
		assert.ok(kind, `Ortsklasse ${slug} fehlt in der Liste`);
		NAHE(kind.r, r, `Radius von ${slug}`);
	});

	// Und die Groessenordnung als ganze Aussage: die alte Liste war rund zehnmal zu gross.
	assert.ok(kinds.every((k) => k.r < 0.25),
		"kein Ort darf wieder in die Groessenordnung der alten Liste rutschen");
}

// ---- 3. Der Divergenzwaechter: die Vorgabe des Bauers IST die gerechnete Tafel --------------
// 🔴 SVGX_PLACE_KINDS traegt die Zahlen als Literale, damit der Bauer rein bleibt. Laufen sie
// von der Zoombaender-Vorgabe weg, zeichnet ein Abzug ohne Serverantwort anders als einer mit.
{
	const ausTafel = B.svgxPlaceKindsFromBands(AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker);
	B.SVGX_PLACE_KINDS.forEach((kind) => {
		const gerechnet = ausTafel.find((k) => k.slug === kind.slug);
		assert.ok(gerechnet, `${kind.slug} steht in SVGX_PLACE_KINDS, aber nicht in der Zoombaender-Vorgabe`);
		NAHE(kind.r, gerechnet.r,
			`SVGX_PLACE_KINDS.${kind.slug}.r ist von der Zoombaender-Vorgabe weggelaufen`);
	});
	assert.strictEqual(B.SVGX_PLACE_KINDS.length, ausTafel.length,
		"beide Listen muessen dieselben Ortsklassen fuehren");
}

// ---- 4. Die Raender: null, fehlend, unbekannt ----------------------------------------------
{
	// Eine Klasse, die auf KEINER Stufe erscheint, behaelt ihren Vorgabe-Radius: der Abzug ist
	// eine Datenquelle, kein Kartenbild -- er zeichnet sie, wenn ihr Haken gesetzt ist.
	const nurNull = B.svgxPlaceKindsFromBands({ dorf: [null, null, null, null, null, null, null, null, null] });
	const dorf = nurNull.find((k) => k.slug === "dorf");
	const dorfVorgabe = B.SVGX_PLACE_KINDS.find((k) => k.slug === "dorf");
	NAHE(dorf.r, dorfVorgabe.r, "eine durchweg leere Zeile faellt auf die Vorgabe zurueck");

	// Eine fehlende Zeile ebenso -- und die Klasse verschwindet nicht aus der Liste.
	const leer = B.svgxPlaceKindsFromBands({});
	assert.strictEqual(leer.length, B.SVGX_PLACE_KINDS.length,
		"eine leere Tafel darf keine Ortsklasse verlieren");
	leer.forEach((k) => {
		NAHE(k.r, B.SVGX_PLACE_KINDS.find((v) => v.slug === k.slug).r,
			`${k.slug} ohne Tafelzeile muss die Vorgabe behalten`);
	});

	// ⚠️ Dieselbe Regel wie in avesmapsResolveLocationZoomBands: die Liste der Ortsklassen fuehrt
	// der Browser, nicht der Server. Ein unbekannter Schluessel aus der Datenbank wird ignoriert.
	const fremd = B.svgxPlaceKindsFromBands({ raumstation: [1, 1, 1, 1, 1, 1, 1, 1, 1] });
	assert.ok(!fremd.some((k) => k.slug === "raumstation"),
		"eine unbekannte Klasse aus der Ablage darf keine Ortsklasse erfinden");

	// Ein unbrauchbarer Wert ist ein Nichtwissen, kein Radius von 0 -- sonst waere der Ort
	// gezeichnet und unsichtbar zugleich.
	const kaputt = B.svgxPlaceKindsFromBands({ stadt: [0, 0, 0, 0, 0, 0, 0, "gross", 0] });
	NAHE(kaputt.find((k) => k.slug === "stadt").r,
		B.SVGX_PLACE_KINDS.find((k) => k.slug === "stadt").r,
		"ein unbrauchbarer Bandwert faellt auf die Vorgabe zurueck");
}

// ---- 5. Der Bauer benutzt die Liste wirklich ------------------------------------------------
// 💣 Eine gepruefte Funktion, die niemand aufruft, beweist nichts. Also durch svgxPlaceLayer.
{
	const features = [{
		type: "Feature",
		geometry: { type: "Point", coordinates: [512, 512] },
		properties: { feature_type: "location", feature_subtype: "metropole", name: "Gareth", public_id: "l1" },
	}];
	const kinds = B.svgxPlaceKindsFromBands(AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker);
	const gesehen = new Map();
	const ergebnis = B.svgxPlaceLayer({
		features: features, kinds: kinds, semantics: true, typen: gesehen,
		dialect: B.SVGX_DIALECTS.INKSCAPE, seen: new Set(),
	});
	const text = ergebnis.parts.join("");
	assert.ok(text.includes('r="0.2078"'), `der gerechnete Radius steht nicht im Kreis: ${text}`);
	// Die Semantik nennt DIESELBE Zahl. Stuenden hier zwei verschiedene, glaubte die
	// Bild-Pipeline der einen und der Zeichner der anderen.
	assert.ok(text.includes('avm:radius="0.2078"'), `avm:radius weicht vom Kreis ab: ${text}`);

	// Gegenprobe: ohne uebergebene Liste greift die Vorgabe -- und die ist dieselbe Zahl.
	const ohne = B.svgxPlaceLayer({
		features: features, semantics: false, dialect: B.SVGX_DIALECTS.INKSCAPE, seen: new Set(),
	});
	assert.ok(ohne.parts.join("").includes('r="0.2078"'),
		"ohne Serverantwort muss der Abzug denselben Massstab haben");

	// 💣 Eine Ortsklasse, die die Liste nicht kennt, wird trotzdem gezeichnet -- und muss im
	// SELBEN Massstab liegen. Der alte Rueckfall 0,8 waere hier fast liegengeblieben: eine
	// unbekannte Klasse waere breiter geworden als jede Metropole.
	const fremdesFeature = [{
		type: "Feature",
		geometry: { type: "Point", coordinates: [100, 100] },
		properties: { feature_type: "location", feature_subtype: "hafenfestung", name: "X", public_id: "l2" },
	}];
	const fremd = B.svgxPlaceLayer({
		features: fremdesFeature, kinds: kinds, semantics: false,
		dialect: B.SVGX_DIALECTS.INKSCAPE, seen: new Set(),
	}).parts.join("");
	assert.ok(fremd.includes(`r="${B.SVGX_PLACE_FALLBACK_R}"`),
		`unbekannte Ortsklasse ohne Rueckfall-Radius: ${fremd}`);
	const groesster = Math.max(...B.SVGX_PLACE_KINDS.map((k) => k.r));
	assert.ok(B.SVGX_PLACE_FALLBACK_R < groesster,
		"der Rueckfall-Radius darf nicht groesser sein als die groesste bekannte Ortsklasse");
}

// ---- 6. Die 7 ist eine Kopie und muss eine Kopie bleiben ------------------------------------
// 🔴 Es gibt keinen geteilten Export fuer "die hoechste Zoomstufe der Karte" (js/app/bootstrap.js
// setzt sie als Leaflet-Option). Sie steht deshalb an drei Stellen -- hier wird geprueft, dass
// alle drei dieselbe Zahl nennen. Ohne diesen Test aendert ein maxZoom-Umbau lautlos den Massstab
// jedes kuenftigen Abzugs.
{
	const lies = (datei) => fs.readFileSync(path.join(__dirname, "../../..", datei), "utf8");
	const ausBootstrap = /maxZoom:\s*(\d+)/.exec(lies("js/app/bootstrap.js"));
	assert.ok(ausBootstrap, "maxZoom in js/app/bootstrap.js nicht gefunden");
	const maxZoom = Number(ausBootstrap[1]);

	assert.strictEqual(B.SVGX_PLACE_SIZE_ZOOM, maxZoom,
		"SVGX_PLACE_SIZE_ZOOM muss der hoechsten Zoomstufe der Karte folgen (js/app/bootstrap.js)");

	const ausEditor = /ZOOM_BAND_MAP_MAX_ZOOM\s*=\s*(\d+)/.exec(lies("html/wiki-sync-settlement-editor.html"));
	assert.ok(ausEditor, "ZOOM_BAND_MAP_MAX_ZOOM im Ortseditor nicht gefunden");
	assert.strictEqual(Number(ausEditor[1]), maxZoom,
		"ZOOM_BAND_MAP_MAX_ZOOM (Ortseditor) ist von bootstrap.js weggelaufen");
}

// ---- 7. Die Verdrahtung ---------------------------------------------------------------------
// 💣 Eine gerechnete Liste, die niemand durchreicht, aendert am Abzug nichts. svg-export-page.js
// ist ein IIFE mit DOM, fetch und Blob -- hier laeuft es nicht, also wird es GELESEN. Grob, aber
// es faengt genau die Fehlerklasse, die sonst gruen durchgeht.
{
	const lies = (datei) => fs.readFileSync(path.join(__dirname, "../../..", datei), "utf8");
	const seite = lies("js/pages/svg-export-page.js");
	assert.ok(/placeKindsFromBands/.test(seite),
		"svg-export-page.js ruft placeKindsFromBands nicht -- der Massstab kaeme nie aus der Tafel");
	assert.ok(/placeKinds:\s*\w/.test(seite),
		"svg-export-page.js reicht das Ergebnis nicht als placeKinds an build() durch");
	assert.ok(/avesmapsResolveLocationZoomBands/.test(seite),
		"die Uebersteuerung muss ueber avesmapsResolveLocationZoomBands laufen, nicht roh gelesen werden");

	// 🔴 Und das Skript muss auf der Seite liegen -- und VOR der Seite, die es liest.
	// ⚠️ Gesucht wird das <script>-TAG, nicht der blosse Dateiname: der Kommentar ueber den
	// Zeilen nennt beide Dateien ebenfalls, und indexOf faende ihn zuerst (genau so beim
	// ersten Lauf passiert).
	const php = lies("edit/svg-export.php");
	const stelle = (datei) => php.search(new RegExp(`<script\\s+src="[^"]*${datei.replace(".", "\\.")}`));
	const posBands = stelle("location-zoom-bands.js");
	const posSeite = stelle("svg-export-page.js");
	assert.ok(posBands >= 0, "edit/svg-export.php laedt js/map-features/location-zoom-bands.js nicht");
	assert.ok(posBands < posSeite, "location-zoom-bands.js muss VOR svg-export-page.js stehen");
}

console.log("svg-export-ortsgroessen.test.js: alle Zusicherungen erfuellt");
