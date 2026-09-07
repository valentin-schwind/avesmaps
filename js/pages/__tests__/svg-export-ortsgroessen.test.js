// Die Zirkel der Orte im SVG-Abzug sind eine geschaetzte ORTSAUSDEHNUNG, keine Darstellungsgroesse.
//
// 🔴 SEIT 08.09.2026, UND DAS IST DIE UMKEHRUNG DER REGEL DAVOR. Vom 22.08. bis dahin war der
// Zirkel so gross, wie die KARTE den Ort auf ihrer hoechsten Zoomstufe zeichnet -- gerechnet aus
// der Zoombaender-Tafel bei z7. Diese Kopplung ist gefallen: eine Metropole misst jetzt 5,5 Meilen
// im Durchmesser, und ein Marker dieser Groesse waere bei z7 rund 235 px breit, ein Kreis so gross
// wie ein halbes Herzogtum. Was die Karte zeichnet und was ein Ort MISST, sind zwei Zahlen.
//
// Die Reihe ist nicht gegriffen: sie folgt den Einwohnerzahlen des Livebestands (Dump 04.09.2026,
// Mediane je Ortsklasse) mit ⌀ ∝ √Einwohner -- konstante Bevoelkerungsdichte. Owner 08.09.2026
// gab die zwei Anker ("wenn gareth 5,5 meilen durchmesser hat und eine dorf 0,5 meilen"), und
// gegen die Mediane gerechnet ergeben genau sie den Exponenten 0,490 statt 0,5.
//
// Lauf aus der Wurzel des Repos:  node js/pages/__tests__/svg-export-ortsgroessen.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const B = require("../svg-export-build.js");

const NAHE = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} (war ${a}, erwartet ${b})`);
const lies = (datei) => fs.readFileSync(path.join(__dirname, "../../..", datei), "utf8");

// ---- 1. Der Abnahmefall: die sechs Durchmesser des Owners -----------------------------------
// 🔴 DIE MEILENZAHL IST DIE GEPFLEGTE, DER RADIUS WIRD GERECHNET. Zwei Zahlen je Ortsklasse
// koennten auseinanderlaufen; eine kann es nicht. Wer die Reihe aendert, aendert Meilen.
{
	const erwartet = {
		metropole: 5.5,      // Gareth-Massstab; Median der 9 Metropolen 40.000 EW
		grossstadt: 2.2,     // Median 6.200 EW
		stadt: 1.25,         // Median 2.000 EW
		kleinstadt: 0.7,     // Median 650 EW
		dorf: 0.5,           // Median 300 EW
		gebaeude: 0.15,      // ~240 m; die einzige Zahl OHNE Einwohnerbeleg
		stadtviertel: 0.15,  // Zeichen fuer Zeichen das Gebaeude -- siehe Abschnitt 4
	};
	Object.entries(erwartet).forEach(([slug, meilen]) => {
		const kind = B.SVGX_PLACE_KINDS.find((k) => k.slug === slug);
		assert.ok(kind, `Ortsklasse ${slug} fehlt in SVGX_PLACE_KINDS`);
		NAHE(kind.meilen, meilen, `Durchmesser von ${slug} in Meilen`);
	});
	assert.strictEqual(B.SVGX_PLACE_KINDS.length, Object.keys(erwartet).length,
		"SVGX_PLACE_KINDS fuehrt eine Ortsklasse, die dieser Test nicht kennt");
}

// ---- 2. Die Umrechnung: Meilen-DURCHMESSER -> Karteneinheiten-RADIUS -------------------------
// Zwei Halbierungen stecken darin, und wer eine vergisst, bekommt das Doppelte bzw. das Dreifache.
{
	NAHE(B.svgxPlaceRadiusAusMeilen(6), 1, "6 Meilen Durchmesser sind 1 Karteneinheit Radius");
	NAHE(B.svgxPlaceRadiusAusMeilen(3), 0.5, "3 Meilen Durchmesser sind eine halbe Einheit Radius");

	// Und die Tafel traegt genau das Ergebnis dieser Rechnung -- kein abgeschriebener Zweitwert.
	B.SVGX_PLACE_KINDS.forEach((kind) => {
		NAHE(kind.r, B.svgxPlaceRadiusAusMeilen(kind.meilen),
			`${kind.slug}.r ist von seiner Meilenzahl weggelaufen`);
	});

	// Der Abnahmefall in Zahlen, damit eine stille Verschiebung auffaellt.
	const r = (slug) => B.SVGX_PLACE_KINDS.find((k) => k.slug === slug).r;
	NAHE(r("metropole"), 0.9167, "Radius der Metropole");
	NAHE(r("dorf"), 0.0833, "Radius des Dorfes");
	NAHE(r("gebaeude"), 0.025, "Radius des Gebaeudes");
}

// ---- 3. Die 3 ist eine Kopie und muss eine Kopie bleiben -------------------------------------
// 🔴 Es gibt im Browser keinen geteilten Export fuer "1 Karteneinheit = 3 Meilen" -- die Zahl
// steht ueberall als Literal mit Kommentar. Die Quelle im Haus ist die PHP-Konstante; laufen sie
// auseinander, misst ein Abzug in einer anderen Welt als der Router.
{
	const ausPhp = /AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT\s*=\s*([0-9.]+)/
		.exec(lies("api/_internal/routing/terrain-factor.php"));
	assert.ok(ausPhp, "AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT nicht gefunden");
	NAHE(B.SVGX_MEILEN_JE_EINHEIT, Number(ausPhp[1]),
		"SVGX_MEILEN_JE_EINHEIT ist von AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT weggelaufen");
}

// ---- 4. Die Ordnung der Reihe ----------------------------------------------------------------
{
	const reihe = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
	const meilen = reihe.map((slug) => B.SVGX_PLACE_KINDS.find((k) => k.slug === slug).meilen);
	meilen.forEach((wert, i) => {
		if (i === 0) { return; }
		assert.ok(wert < meilen[i - 1],
			`${reihe[i]} ist nicht kleiner als ${reihe[i - 1]} -- die Reihe ist nicht mehr monoton`);
	});

	// 🔴 Ein Stadtviertel ist so gross wie ein Bauwerk (dieselbe Regel wie im Zoomband, Owner
	// 31.08.2026). Eine eigene Zahl waere eine Aussage, die niemand getroffen hat.
	NAHE(B.SVGX_PLACE_KINDS.find((k) => k.slug === "stadtviertel").meilen,
		B.SVGX_PLACE_KINDS.find((k) => k.slug === "gebaeude").meilen,
		"Stadtviertel und Gebaeude muessen dieselbe Zahl tragen");
}

// ---- 5. Der Rueckfall liegt IN der Reihe ------------------------------------------------------
// 💣 Der Radius einer Ortsklasse, die die Liste nicht kennt. Er muss im selben Massstab liegen:
// bis 22.08.2026 stand hier 0,8 und waere fast liegengeblieben -- eine unbekannte Klasse waere
// breiter geworden als jede Metropole. Beim Umbau vom 08.09. dieselbe Falle, andersherum.
{
	const alle = B.SVGX_PLACE_KINDS.map((k) => k.r);
	assert.ok(B.SVGX_PLACE_FALLBACK_R < Math.max(...alle),
		"der Rueckfall-Radius darf nicht groesser sein als die groesste bekannte Ortsklasse");
	assert.ok(B.SVGX_PLACE_FALLBACK_R > Math.min(...alle),
		"der Rueckfall-Radius darf nicht kleiner sein als die kleinste bekannte Ortsklasse");
}

// ---- 6. Der Bauer benutzt die Tafel wirklich --------------------------------------------------
// 💣 Eine gepruefte Liste, die niemand liest, beweist nichts. Also durch svgxPlaceLayer.
{
	const features = [{
		type: "Feature",
		geometry: { type: "Point", coordinates: [512, 512] },
		properties: { feature_type: "location", feature_subtype: "metropole", name: "Gareth", public_id: "l1" },
	}];
	const text = B.svgxPlaceLayer({
		features: features, semantics: true, typen: new Map(),
		dialect: B.SVGX_DIALECTS.INKSCAPE, seen: new Set(),
	}).parts.join("");
	assert.ok(text.includes('r="0.9167"'), `der gerechnete Radius steht nicht im Kreis: ${text}`);
	// Die Semantik nennt DIESELBE Zahl. Stuenden hier zwei verschiedene, glaubte die
	// Bild-Pipeline der einen und der Zeichner der anderen.
	assert.ok(text.includes('avm:radius="0.9167"'), `avm:radius weicht vom Kreis ab: ${text}`);

	// 💣 Eine Ortsklasse, die die Tafel nicht kennt, wird trotzdem gezeichnet -- mit dem Rueckfall.
	const fremd = B.svgxPlaceLayer({
		features: [{
			type: "Feature",
			geometry: { type: "Point", coordinates: [100, 100] },
			properties: { feature_type: "location", feature_subtype: "hafenfestung", name: "X", public_id: "l2" },
		}],
		semantics: false, dialect: B.SVGX_DIALECTS.INKSCAPE, seen: new Set(),
	}).parts.join("");
	assert.ok(fremd.includes(`r="${B.SVGX_PLACE_FALLBACK_R}"`),
		`unbekannte Ortsklasse ohne Rueckfall-Radius: ${fremd}`);
}

// ---- 7. Die Zoombaender-Kopplung ist WEG und darf nicht zurueckkommen -------------------------
// 💣 DIES IST DER EIGENTLICHE WAECHTER DIESES UMBAUS. Die Zahlen oben sind nur der RUECKFALL,
// solange irgendjemand `placeKinds` durchreicht: die Seite tat das bei JEDEM Abzug, und eine
// gerechnete Tafel schlug die Literale still. Wer die Kopplung wiederherstellt, macht die sechs
// Meilenzahlen wirkungslos, ohne dass sich eine einzige davon aendert.
{
	assert.strictEqual(typeof B.placeKindsFromBands, "undefined",
		"placeKindsFromBands ist zurueck -- die Zoombaender wuerden die Meilenzahlen wieder schlagen");
	assert.strictEqual(typeof B.svgxPlaceKindsFromBands, "undefined",
		"svgxPlaceKindsFromBands ist zurueck -- siehe oben");

	const seite = lies("js/pages/svg-export-page.js");
	assert.ok(!/placeKindsFromBands/.test(seite),
		"svg-export-page.js rechnet wieder aus den Zoombaendern");
	assert.ok(!/placeKinds\s*:/.test(seite),
		"svg-export-page.js reicht wieder eine placeKinds-Tafel durch -- sie schlaegt SVGX_PLACE_KINDS");
	assert.ok(!/avesmapsResolveLocationZoomBands/.test(seite),
		"die Exportseite liest wieder die Zoombaender");
}

console.log("svg-export-ortsgroessen.test.js: alle Zusicherungen erfuellt");
