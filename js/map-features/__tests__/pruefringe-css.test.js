const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Der Warnring der Pruefhaken ist ein box-shadow -- und genau deshalb ist er zerbrechlich: eine
// spaetere Regel mit `box-shadow: none !important` loescht ihn lautlos mit. Am 14.08.2026 tat das
// `.location-visual-marker__shape--simple` (haengt an jeder Kreuzung ab Zoomstufe <= 3): die
// Kreuzung stand auf der Karte, ihr Befund nicht -- ausgerechnet auf den Zoomstufen, auf denen man
// nach Anbindungsluecken sucht. Kein JS-Test kann das sehen, die Kaskade entscheidet es.
// ⚠️ Dieser Test liest die Dateien als TEXT. Er beweist nicht, dass es im Browser stimmt (das tut
// die Probe an der echten Kaskade), sondern dass die vier Kopplungen nicht einzeln wegwandern.
const repoRoot = path.join(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const markerCss = read("css/features/location-popups-markers.css");
const tokensCss = read("css/base/tokens.css");
const indexHtml = read("index.html");

const RING_KLASSEN = [
	"location-visual-marker__shape--unconnected",
	"location-visual-marker__shape--sparse-crossing",
];

// --- 1. Die Ringstaerke ist EIN Token, keine zweimal getippte Zahl -------------------------------
assert.ok(/--marker-check-ring-width:\s*\d/.test(tokensCss),
	"tokens.css muss --marker-check-ring-width definieren (AGENTS.md 12: kein hartkodierter Radius)");

// --- 2. Beide Ringregeln nehmen Staerke UND Farbe aus Tokens -------------------------------------
RING_KLASSEN.forEach((klasse) => {
	const block = markerCss.match(new RegExp("\\." + klasse + "\\s*\\{([^}]*)\\}"));
	assert.ok(block, "Regel fuer ." + klasse + " fehlt in location-popups-markers.css");
	assert.ok(block[1].includes("var(--marker-check-ring-width)"),
		"." + klasse + " muss die Staerke aus dem Token nehmen -- sonst driften pink und tuerkis auseinander");
	const farbToken = klasse.endsWith("unconnected")
		? "var(--color-marker-unconnected-ring)"
		: "var(--color-marker-sparse-crossing-ring)";
	assert.ok(block[1].includes(farbToken), "." + klasse + " muss " + farbToken + " nehmen, kein Hex");
});

// --- 3. DER RIEGEL: keine Regel darf den Ring per `box-shadow: none !important` mitloeschen -------
// Jeder Regelblock mit dieser Zeile muss beide Ringklassen ausschliessen.
const regelBloecke = [...markerCss.matchAll(/([^{}]+)\{([^}]*)\}/g)];
const loescher = regelBloecke.filter(([, , decls]) => /box-shadow\s*:\s*none\s*!important/.test(decls));
assert.ok(loescher.length > 0, "Vorbedingung: es gibt mindestens eine solche Regel (sonst prueft dieser Test nichts)");
loescher.forEach(([, selektor]) => {
	RING_KLASSEN.forEach((klasse) => {
		assert.ok(selektor.includes(":not(." + klasse + ")"),
			"Regel `" + selektor.trim().split("\n").pop().trim() + "` loescht box-shadow mit !important und muss ."
			+ klasse + " ausnehmen -- sonst steht der Marker da und sein Befund nicht");
	});
});

// --- 4. Quellreihenfolge: bei gleicher Spezifitaet gewinnt die SPAETERE Regel --------------------
RING_KLASSEN.forEach((klasse) => {
	const ringPos = markerCss.indexOf("." + klasse + " {");
	["location-visual-marker__shape--crossing", "location-visual-marker__shape--capital"].forEach((frueher) => {
		assert.ok(ringPos > markerCss.lastIndexOf("." + frueher + " {"),
			"." + klasse + " muss NACH ." + frueher + " stehen -- gleiche Spezifitaet, es entscheidet die Reihenfolge");
	});
});

// --- 5. Die Legende im Anzeige-Menue traegt den Ton ihres Befunds --------------------------------
// Ohne sie stehen fuenf identische Lupen in der Gruppe PRUEFEN und die Farbe muss geraten werden.
// ⚠️ „Offene Wegenden" (Idee #86) steht mit in der Liste, obwohl sein Befund keinem ORT gehoert,
// sondern einem WEG: sein Zeichen ist eine rote Linie mit Ring statt eines Marker-Rings. Die Regel ist
// dieselbe -- ein Zeichen ohne den Ton seines Befunds ist eine Legende, die nichts erklaert.
[
	{ id: "toggleUnconnectedControl", token: "--color-marker-unconnected-ring" },
	{ id: "toggleSparseCrossingsControl", token: "--color-marker-sparse-crossing-ring" },
	{ id: "toggleOpenPathEndsControl", token: "--color-path-open-end" },
].forEach(({ id, token }) => {
	const zeile = indexHtml.match(new RegExp('id="' + id + '"[\\s\\S]*?</label>'));
	assert.ok(zeile, "Zeile " + id + " fehlt in index.html");
	assert.ok(zeile[0].includes("var(" + token + ")"),
		"das Zeichen der Zeile " + id + " muss " + token + " tragen -- es IST die Legende des Markers");
});

console.log("pruefringe-css: alle Zusicherungen erfuellt");
