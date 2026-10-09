const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Suche nach der ART eines Ortes, im Browser (Discord #145, Owner-GO 09.10.2026).
//
// Der Server wertet die Art nachrangig (api/app/__tests__/suche-nach-art-test.php); hier steht die
// Browserhaelfte: die lokale Liste, die vor der Serverantwort erscheint, und die Typzeile der Treffer.
//   1. Die Typzeile nennt die Art („Festung“ statt „Besondere Bauwerke/Stätten“).
//   2. Die Art zaehlt nachrangig -- „Fe“ stellt „Ferdok“ vor jede Burg.
//   3. Die Ortsgroesse bleibt voll suchbar wie bisher.
//   4. Ein verborgener Ort ist ueber seine Art nicht auffindbar.
//   5. Die Infobox liest dieselbe Art (locationArt ist EIN Bauer fuer beide).
//
// Die Funktionen werden per Namen aus den AUSGELIEFERTEN Dateien gezogen (wie spotlight-versteckt-zeile.test.js).
//
// Lauf (aus dem Wurzelverzeichnis):  node js/ui/__tests__/spotlight-suche-nach-art.test.js

const spotlight = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8");
const markerEntry = fs.readFileSync(path.join(__dirname, "..", "..", "map-features", "map-features-location-marker-entry.js"), "utf8");

const extract = (source, name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht gefunden -- umbenannt?`);
	return match[0];
};
const konstante = (source, name) => {
	const match = source.match(new RegExp("\\nconst " + name + " = [^;]+;"));
	assert.ok(match, `const ${name} nicht gefunden -- umbenannt?`);
	return match[0];
};

let locationMarkers = [];
const context = {
	String, Boolean, Array, Object, Number, Math, Set, Infinity,
	tr: (key, fallback) => fallback,
	LOCATION_TYPE_CONFIG: {
		stadt: { singularLabel: "Stadt" },
		gebaeude: { singularLabel: "Besondere Bauwerke/Stätten" },
	},
	isCrossingLocation: () => false,
};
Object.defineProperty(context, "locationMarkers", { get: () => locationMarkers });
vm.createContext(context);
vm.runInContext([
	konstante(spotlight, "SPOTLIGHT_SEARCH_ART_SCORE_OFFSET"),
	extract(spotlight, "buildSpotlightLocationEntries"),
	extract(spotlight, "spotlightLocationArt"),
	extract(spotlight, "spotlightLocationStateHint"),
	extract(spotlight, "getSpotlightSearchScore"),
	extract(spotlight, "scoreSpotlightWord"),
	extract(spotlight, "normalizeSpotlightSearchText"),
	extract(markerEntry, "locationArt"),
	extract(markerEntry, "locationDeities"),
	extract(markerEntry, "locationTypeLabelForDisplay"),
].join("\n"), context);
// Eine `const` auf oberster Ebene ist KEINE Eigenschaft des Kontextobjekts -- sie wird im Kontext gelesen.
const OFFSET = vm.runInContext("SPOTLIGHT_SEARCH_ART_SCORE_OFFSET", context);
assert.strictEqual(OFFSET, 4, "Zwilling von AVESMAPS_SEARCH_ART_SCORE_OFFSET (Server): beide 4");

const marker = (publicId, name, locationType, location) => ({
	publicId, name, locationType,
	locationTypeLabel: context.LOCATION_TYPE_CONFIG[locationType].singularLabel,
	location: { publicId, locationTypeLabel: context.LOCATION_TYPE_CONFIG[locationType].singularLabel, ...location },
});
locationMarkers = [
	marker("loc-ferdok", "Ferdok", "stadt", {}),
	marker("loc-burg", "Burg Aar", "gebaeude", { wikiSettlement: { building_type: "Festung" } }),
	marker("loc-tempel", "Haus der Rosen", "gebaeude", { wikiSettlement: { building_type: "Tempel", deity: "Rahja,Tsa" } }),
	marker("loc-oase", "Wasserloch", "gebaeude", { placeKind: "Oase", wikiSettlement: { building_type: "Brunnen" } }),
	marker("loc-versteckt", "Grauer Turm", "gebaeude", { isHidden: true, wikiSettlement: { building_type: "Festung" } }),
];
const entries = context.buildSpotlightLocationEntries();
const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
const score = (name, query) => context.getSpotlightSearchScore(byName[name], context.normalizeSpotlightSearchText(query));

// --- 1. die Typzeile ------------------------------------------------------------------------------
assert.strictEqual(byName["Burg Aar"].typeLabel, "Festung", "die Zeile nennt die Art, nicht die Ortsgroesse");
assert.strictEqual(byName["Haus der Rosen"].typeLabel, "Rahja-Tempel", "mit der ersten Gottheit davor, wie die Infobox");
assert.strictEqual(byName["Wasserloch"].typeLabel, "Oase", "die vom Editor gesetzte Ortsart schlaegt den Wiki-Bauwerkstyp");
assert.strictEqual(byName["Ferdok"].typeLabel, "Stadt", "ohne Art bleibt die Ortsgroesse");

// --- 2. nachrangig --------------------------------------------------------------------------------
assert.strictEqual(score("Ferdok", "fe"), 1, "Vorbedingung: Namenspraefix ist Stufe 1");
assert.strictEqual(score("Burg Aar", "fe"), 1 + OFFSET,
	"💣 ein Artpraefix liegt HINTER jedem Namenstreffer");
assert.strictEqual(score("Burg Aar", "festung"), OFFSET, "die volle Art trifft");
assert.strictEqual(score("Haus der Rosen", "tsa"), OFFSET, "jede Gottheit ist suchbar, auch die zweite");
assert.strictEqual(score("Wasserloch", "oase"), OFFSET, "die Ortsart ist suchbar");
assert.strictEqual(score("Wasserloch", "brunnen"), Infinity,
	"🔴 ein von der Ortsart ueberschriebener Wiki-Typ ist NICHT suchbar -- die Zeile sagt „Oase“ (wie avesmapsLocationSearchArtTexts)");

// --- 3. die Ortsgroesse bleibt voll suchbar -------------------------------------------------------
assert.strictEqual(score("Burg Aar", "besondere"), 1, "„Besondere Bauwerke“ trifft wie vor dem 09.10.2026 -- jetzt ueber searchTypeLabel");
assert.strictEqual(score("Ferdok", "stadt"), 0, "„Stadt“ trifft die Stadt voll");

// --- 4. verborgen ---------------------------------------------------------------------------------
assert.strictEqual(score("Grauer Turm", "festung"), Infinity, "🔴 ueber seine Art findet den verborgenen Ort niemand");
assert.ok(score("Grauer Turm", "grauer turm") < OFFSET, "ueber seinen Namen schon -- als Namenstreffer");
assert.strictEqual(byName["Grauer Turm"].typeLabel, "Festung", "wer ihn gefunden hat, sieht trotzdem, was er ist");

// --- 5. ein Bauer fuer Suche und Infobox ----------------------------------------------------------
assert.strictEqual(context.locationTypeLabelForDisplay(locationMarkers[1].location), "Festung", "die Infobox nennt dieselbe Art");
assert.strictEqual(context.locationTypeLabelForDisplay(locationMarkers[2].location), "Rahja-Tempel");
assert.strictEqual(context.locationTypeLabelForDisplay(locationMarkers[0].location), "Stadt", "ohne Art die Ortsgroesse, unveraendert");
assert.strictEqual(context.locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", wikiSettlement: { deity: "Peraine" } }), "Peraine-Dorf",
	"eine Gottheit ohne Art steht weiter vor der Ortsgroesse (Verhalten vor dem Umbau)");
assert.strictEqual(context.locationTypeLabelForDisplay({ locationTypeLabel: "X", isRuined: true, wikiSettlement: { building_type: "Turm" } }), "Turm (Ruine)",
	"die Ruinen-Regel haengt weiter an der Art");

// Ohne den Bauer der Infobox (Datei nicht geladen) faellt die Suche auf die Ortsgroesse zurueck, statt zu werfen.
const ohne = { String, Boolean, Array };
vm.runInNewContext(extract(spotlight, "spotlightLocationArt"), ohne);
// ⚠️ Feldweise: ein Array aus einem vm-Kontext traegt einen FREMDEN Prototyp, deepStrictEqual faellt sonst.
const ohneArt = ohne.spotlightLocationArt({ wikiSettlement: { building_type: "Festung" } });
assert.strictEqual(ohneArt.label, "");
assert.strictEqual(ohneArt.texts.length, 0);

console.log("spotlight-suche-nach-art: all asserts passed");
