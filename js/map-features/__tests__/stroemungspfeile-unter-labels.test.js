// Die Stroemungsdreiecke der Fluesse liegen UNTER jeder Beschriftung.
//
// Owner 02.09.2026: „Dreieck zur Anzeige von Stroemungen auf Fluessen sind ueber den Labels, sollten
// aber darunter einsortiert sein." Und das war live genau so: die Pfeil-Pane stand auf 639, also
// knapp unter labelsPane (650, die Landschafts- und Ortsnamen), aber UEBER dem Wegenamen-Canvas
// (470) -- und der traegt ausgerechnet die Flussnamen, also die Beschriftung, die auf demselben
// Fluss steht wie das Dreieck. Ein Dreieck mitten im Wort „Inoscha".
//
// 🔴 DIE REGEL IST EINE ORDNUNG, KEINE ZAHL. Der Test liest beide Werte aus dem Code, statt eine
// erwartete Zahl festzuschreiben: wer eine Beschriftungsflaeche verschiebt, soll hier scheitern und
// die Pfeile mitnehmen -- nicht an einer Konstanten vorbeilaufen, die niemand mehr pflegt.
//
// 💣 GEMESSEN WIRD GEGEN ALLE VIER BESCHRIFTUNGSFLAECHEN, nicht nur gegen labelsPane. Genau daran
// ist der Zustand entstanden, den der Owner gemeldet hat: 639 liegt unter labelsPane, und wer nur
// diese eine Flaeche prueft, haelt die Einordnung fuer richtig. Die niedrigste entscheidet.
//
// 🔴 Statisch geprueft, nicht im Browser: die drei Dateien bauen beim Laden eine echte Karte auf
// bzw. warten auf `map` und sind nicht require-bar.
const fs = require("fs");
const path = require("path");

// 💣 Zeilenendenneutral lesen: die Arbeitskopie traegt hier CRLF, `actions/checkout` legt im Tor LF
// hin -- ein Muster mit `\r\n` waere lokal gruen und in der CI rot (AGENTS.md §9).
function lies(...teile) {
	return fs.readFileSync(path.join(__dirname, ...teile), "utf8").replace(/\r\n/g, "\n");
}

const bootstrap = lies("..", "..", "app", "bootstrap.js");
const pfeile = lies("..", "map-features-river-flow-arrows.js");
const wegenamen = lies("..", "map-features-path-label-canvas-overlay.js");

let failures = 0;

function melde(text) {
	console.error(`FAIL: ${text}`);
	failures += 1;
}

// `map.getPane("x").style.zIndex = N;` in bootstrap.js
function bootstrapZIndex(pane) {
	const treffer = bootstrap.match(
		new RegExp(`getPane\\(\\s*"${pane}"\\s*\\)\\.style\\.zIndex\\s*=\\s*(\\d+)`),
	);
	return treffer ? Number(treffer[1]) : null;
}

// `pane.style.zIndex = N;` in einem Overlay-Modul, das seine Pane selbst anlegt
function modulZIndex(quelle) {
	const treffer = quelle.match(/\.style\.zIndex\s*=\s*(\d+)/);
	return treffer ? Number(treffer[1]) : null;
}

const pfeilZ = modulZIndex(pfeile);
if (pfeilZ === null) {
	melde("map-features-river-flow-arrows.js setzt keinen lesbaren zIndex mehr -- prueft der Test noch das Richtige?");
}

// Die vier Flaechen, auf denen ein NAME steht. Jede einzeln benannt, damit der Fehlschlag sagt,
// welche Beschriftung das Dreieck verdeckt haette.
const beschriftungen = [
	["Wegenamen (Canvas, Fluss- und Strassennamen)", modulZIndex(wegenamen)],
	["Wappen/Territoriumslabels (regionLabelsPane)", bootstrapZIndex("regionLabelsPane")],
	["Ortsmarkierungen (locationsPane)", bootstrapZIndex("locationsPane")],
	["Landschafts- und Ortsnamen (labelsPane)", bootstrapZIndex("labelsPane")],
];

beschriftungen.forEach(([name, z]) => {
	if (typeof z !== "number") {
		melde(`Der zIndex fuer ${name} ist nicht mehr lesbar -- prueft der Test noch das Richtige?`);
		return;
	}
	if (typeof pfeilZ === "number" && pfeilZ >= z) {
		melde(`Die Stroemungspfeile (${pfeilZ}) liegen NICHT unter ${name} (${z}). `
			+ "Ein Dreieck faellt dann in den Namen, der auf demselben Fluss steht.");
	}
});

// Gegenprobe, damit der Test nicht still leerlaeuft: die vier Zahlen muessen wirklich gefunden
// worden sein, und die Pfeile muessen ueber der Wegzeichnung selbst liegen -- sonst verschwaende
// eine „Loesung", die sie einfach ganz nach unten schiebt, das Dreieck unter der Flusslinie.
const wege = bootstrapZIndex("roadsPane");
if (typeof wege !== "number") {
	melde('Der zIndex fuer "roadsPane" ist nicht mehr lesbar -- prueft der Test noch das Richtige?');
} else if (typeof pfeilZ === "number" && pfeilZ <= wege) {
	melde(`Die Stroemungspfeile (${pfeilZ}) liegen nicht ueber der Wegzeichnung (roadsPane ${wege}) -- `
		+ "das Dreieck saesse unter seinem eigenen Fluss.");
}

if (failures > 0) {
	console.error(`stroemungspfeile-unter-labels.test: ${failures} Fehlschlag/Fehlschlaege`);
	process.exit(1);
}
console.log(`stroemungspfeile-unter-labels.test: OK (Pfeile ${pfeilZ}, `
	+ `niedrigste Beschriftung ${Math.min(...beschriftungen.map((b) => b[1]))}, Wege ${wege})`);
