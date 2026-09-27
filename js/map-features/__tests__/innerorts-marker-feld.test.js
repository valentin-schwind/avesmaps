// Der Weg vom Kartenpayload/der Punkt-Antwort zum Marker-Eintrag: `location.innerorts` MUSS an
// JEDER Stelle stehen, die einen Marker-Eintrag baut oder ersetzt -- sonst startet die Kachel
// „Von der Karte nehmen" (js/ui/popups.js) nach genau dieser Handlung wieder leer, und das nächste
// Speichern nimmt die Stadt-Zugehörigkeit lokal zurück. Dieselbe Falle wie bei den Wiki-Textfeldern
// (js/ui/__tests__/wiki-assign-ort.test.js, TEIL 6) -- deshalb dieselbe Form der Probe.
//
// ⚠️ TEXTPROBE, und sie ist als solche benannt (wie das Vorbild oben): die vier Erzeuger hängen an
// Leaflet, am Kartenzustand und an einem Dutzend Nachbarmodulen; sie im Sandkasten nachzubauen wäre
// ein Nachbau, kein Beleg. Sie beantwortet genau eine Frage -- trägt der Erzeuger das Feld
// überhaupt? -- an Kommentaren vorbei (Blockkommentare zuerst, dann Zeilenkommentare) und an einer
// Wortgrenze (`innerorts\s*:`), damit ein Vorkommen im Kommentar oder ein Teilwort nicht zählt.
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/map-features/__tests__/innerorts-marker-feld.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");

const MARKER_ERZEUGER = [
	["js/routing/routing.js", "prepareLocationData"],
	["js/map-features/map-features-location-editing.js", "applyFeatureResponseToMarker"],
	["js/map-features/map-features-location-editing.js", "addCreatedLocationMarker"],
	["js/map-features/map-features-location-editing.js", "applyLiveLocationFeature"],
];

function rumpfOhneKommentare(quelle, funktion) {
	const start = quelle.indexOf(funktion);
	if (start === -1) {
		return null;
	}
	const rest = quelle.slice(start);
	const ende = rest.search(/\n(?:function |async function |const |let |\/\/ =)/);
	return (ende === -1 ? rest : rest.slice(0, ende))
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.split("\n")
		.filter((zeile) => zeile.trim().indexOf("//") !== 0)
		.join("\n");
}

let checks = 0;
MARKER_ERZEUGER.forEach(([datei, funktion]) => {
	const quelle = fs.readFileSync(path.join(wurzel, datei), "utf8");
	const rumpf = rumpfOhneKommentare(quelle, funktion);
	assert.ok(rumpf !== null, "der Erzeuger „" + funktion + "“ steht nicht in " + datei);
	// Wortgrenze davor, Doppelpunkt dahinter -- "properties.innerorts" oder "feature.innerorts"
	// zaehlt (das ist der LESER-Ausdruck), ein blosses Vorkommen im Kommentar nicht mehr (Kommentare
	// sind schon raus).
	const zuweisung = /(^|[^A-Za-z0-9_$])innerorts\s*:/;
	assert.ok(zuweisung.test(rumpf),
		"„" + funktion + "“ (" + datei + ") trägt „innerorts“ nicht in den Marker-Eintrag");
	checks += 1;
});

console.log("innerorts-marker-feld: " + checks + " Zusicherungen erfüllt");
