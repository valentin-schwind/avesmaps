const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Run: node js/map-features/__tests__/location-at-path-endpoint.test.js
//
// 💣 WER EINEN WEGENDPUNKT BEKOMMT, ENTSCHIED BIS 2026-08-07 DIE ARRAY-REIHENFOLGE.
// getLocationAtPathEndpoint nahm den ERSTEN Ort, dessen lat UND lng beide naeher als THRESHOLD
// (0,5) lagen -- ein Kasten mit Diagonale 0,707, kein Kreis, und `find()` fragt nicht nach dem
// Abstand. Lag ein Nachbar im selben Kasten und stand er frueher in locationData, schnappte er
// jeden Endpunkt weg, auch einen mit Abstand 0.
//
// Gemessen am Livebestand 07.08.2026: 541 von 11.662 Endpunkten gingen so an den falschen Ort,
// 165 Wege wurden dadurch zu SELBSTKANTEN (beide Enden auf demselben Knoten = eine Schleife, die
// im Graphen nichts verbindet), und 470 Orte galten als unverbunden.
//
// Die drei Faelle unten sind echte Kartendaten, keine erfundenen Zahlen.

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../map-features-line-catmull.js");
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../map-features-path-domain.js");
loadBrowserScript("../map-features-location-editing.js");

// locationData speichert [lat, lng] = [y, x]; die Weggeometrie [x, y]. Immer bewusst tauschen.
const at = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "dorf" });
const crossingAt = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "crossing" });

// --- Fall 1: Tolakstein / Alarasruh -------------------------------------------------------------
// Livewerte. Abstand 0,623 -- aber dlat 0,4701 und dlng 0,4087 liegen BEIDE unter 0,5, also steckt
// Alarasruh in Tolaksteins Kasten. Alarasruh stand an Index 727, Tolakstein an 1780.
// Zwei Wege beginnen exakt auf Tolakstein; beide gingen an Alarasruh.
locationData = [
	at("Alarasruh", 574.5, 499.5),
	at("Tolakstein", 574.09126, 499.97011),
];
assert.strictEqual(
	getLocationAtPathEndpoint([574.091, 499.97]).name,
	"Tolakstein",
	"ein Endpunkt auf Tolakstein gehoert Tolakstein, auch wenn Alarasruh frueher im Array steht"
);
assert.strictEqual(
	getLocationAtPathEndpoint([574.5, 499.5]).name,
	"Alarasruh",
	"und Alarasruhs eigener Endpunkt bleibt bei Alarasruh"
);

// --- Fall 2: Fischbach / Kreuzung-599 -----------------------------------------------------------
// Livewerte, Abstand 0,025. Sechs Wegenden lagen auf Fischbachs Punkt; alle sechs bekam die
// Kreuzung, weil sie an Index 2528 vor Fischbach (3936) stand. Fischbach: null Kanten, roter Ring.
locationData = [
	crossingAt("Kreuzung-599", 713.07, 640.016),
	at("Fischbach", 713.047, 640.008),
];
assert.strictEqual(
	getLocationAtPathEndpoint([713.047, 640.008]).name,
	"Fischbach",
	"eine Kreuzung 0,025 daneben schnappt Fischbachs eigene Wegenden nicht weg"
);

// --- Fall 3: Neu-Süderwacht -- die Selbstkante --------------------------------------------------
// Livewerte, Abstand 0,625. Strasse-5831 laeuft von der Feste zum Dorf. BEIDE Enden loesten auf das
// Dorf auf, der Weg war im Graphen eine Schleife, die Feste hatte null Kanten -- und eine Route
// „nach Reichsgrenzfeste Neu-Süderwacht" endete wortlos 0,625 davor, im Dorf.
locationData = [
	at("Neu-Süderwacht", 431.2, 750.4),
	at("Reichsgrenzfeste Neu-Süderwacht", 431.7, 750.775),
];
const strasse5831Anfang = getLocationAtPathEndpoint([431.7, 750.775]);
const strasse5831Ende = getLocationAtPathEndpoint([431.2, 750.4]);
assert.strictEqual(strasse5831Anfang.name, "Reichsgrenzfeste Neu-Süderwacht", "der Anfang liegt auf der Feste");
assert.strictEqual(strasse5831Ende.name, "Neu-Süderwacht", "das Ende liegt auf dem Dorf");
assert.notStrictEqual(
	strasse5831Anfang.name,
	strasse5831Ende.name,
	"und damit ist Strasse-5831 eine echte Kante statt einer Schleife auf dem Dorf"
);

// --- Die Reihenfolge darf nichts mehr entscheiden -----------------------------------------------
locationData = [
	at("Tolakstein", 574.09126, 499.97011),
	at("Alarasruh", 574.5, 499.5),
];
assert.strictEqual(
	getLocationAtPathEndpoint([574.091, 499.97]).name,
	"Tolakstein",
	"dieselbe Antwort bei umgedrehter Array-Reihenfolge"
);

// --- Der 0,5-Kasten bleibt das Fangnetz fuer LOSE Enden -----------------------------------------
// 💣 Nicht wegoptimieren. Nur 97,5 % der Endpunkte liegen naeher als 0,01 an einem Ort; die
// uebrigen 246 haengen allein an diesem Kasten. Faellt er weg, verlieren ihre Wege BEIDE Knoten
// (addRegularPathToGraph steigt bei einem fehlenden Ende ganz aus) und ganze Gegenden koppeln ab.
locationData = [at("Loses Ende", 100, 100)];
assert.strictEqual(
	getLocationAtPathEndpoint([100.3, 100.2]).name,
	"Loses Ende",
	"ein Ende, das auf keinem Ort liegt, faengt weiterhin der 0,5-Kasten"
);
assert.strictEqual(
	getLocationAtPathEndpoint([100.8, 100]),
	null,
	"jenseits von 0,5 faengt es weiterhin niemand"
);

// --- Zwei lose Enden im selben Kasten: die Reihenfolge bleibt der Schiedsrichter -----------------
// ⚠️ Absicht, kein Rest. Liegt der Endpunkt auf KEINEM der beiden, greift die alte Regel weiter.
// Sie ist willkuerlich, aber sie FASST ZUSAMMEN -- und dieses Zusammenfassen haelt heute Knoten im
// Netz, zwischen denen kein Weg gezeichnet ist. Auf „naechster gewinnt" umzustellen riss gemessen
// 56 Knoten aus dem Hauptnetz, darunter die Kette Rhûvak/Nova Rhûvak/Airûla/Afardia/Belenis.
locationData = [at("Erster", 200.4, 200), at("Zweiter", 200.1, 200)];
assert.strictEqual(
	getLocationAtPathEndpoint([200.2, 200]).name,
	"Erster",
	"ohne exakten Treffer entscheidet weiter die Array-Reihenfolge, nicht der Abstand"
);

console.log("location-at-path-endpoint tests passed");
