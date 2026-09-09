// Ein Wasserton für Flusslinie, Bach und Seefläche (Owner 09.09.2026).
//
// 🔴 DER TOKEN IST DIE WAHRHEIT. Vier Stellen tragen den Wert hartkodiert -- die Wegfarben der
// Karte lesen kein CSS, und der SVG-Bauer hat gar kein DOM. Dieser Test ist der Ersatz für den
// Kommentar, der die Kopplung bisher beschrieben hat; ein Kommentar hat noch nie einen Wert
// nachgezogen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/wasserton.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

// 💣 Die Prosa dieser Dateien nennt genau die Farbwerte, nach denen gesucht wird -- ein Treffer im
// Kommentar ist kein Beleg, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts
// haelt.
function ohneKommentare(quelle) {
	return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const tokens = ohneKommentare(lies("css", "base", "tokens.css"));

const treffer = tokens.match(/--color-water:\s*(#[0-9a-fA-F]{6})\s*;/);
assert.ok(treffer, "--color-water steht in css/base/tokens.css");
const WASSER = treffer[1].toLowerCase();
assert.strictEqual(WASSER, "#4c89c6",
	"der Wasserton ist der des SVG-Abzugs (Owner 09.09.2026). Wer ihn aendert, aendert eine"
	+ " Owner-Entscheidung, keine Geschmacksfrage.");

// ---- 1. Die Seeflaeche liest den Token, statt ihn abzuschreiben ---------------------------------
assert.ok(/--color-ecosystem-topographie-see:\s*var\(--color-water\)/.test(tokens),
	"die Seeflaeche liest --color-water per var(), sie schreibt ihn NICHT ab -- sonst gibt es"
	+ " wieder zwei Werte, die auseinanderlaufen koennen.");

// ---- 2. Das Meer bleibt anders -------------------------------------------------------------------
// 🔴 Owner 09.09.2026, ausdruecklich: „achte darauf dass meere noch anders sind".
const meer = tokens.match(/--color-ecosystem-topographie-meer:\s*([^;]+);/);
assert.ok(meer, "das Meer hat weiterhin einen eigenen Token");
assert.strictEqual(meer[1].trim().toLowerCase(), "#2d5f8a",
	"das Meer behaelt sein dunkles Blau und wird NICHT auf den Wasserton gezogen.");
const kueste = tokens.match(/--color-ecosystem-topographie-kueste:\s*([^;]+);/);
assert.strictEqual(kueste[1].trim().toLowerCase(), "#3f9e9a", "die Kueste behaelt ihr Tuerkis.");

// ---- 3. Die vier hartkodierten Schreibstellen ---------------------------------------------------
const stellen = [
	{
		datei: ["js", "map-features", "map-features.js"],
		muster: (w) => new RegExp("Flussweg:\\s*\"" + w + "\""),
		was: "die Flusslinie der Karte (getPathStyleColors, centerColors.Flussweg)",
	},
	{
		datei: ["js", "map-features", "map-features-river-flow-arrows.js"],
		muster: (w) => new RegExp("fillStyle\\s*=\\s*\"" + w + "\""),
		was: "die Stroemungspfeile -- sie sind Teil des Flusses, nicht etwas darauf",
	},
	{
		datei: ["js", "pages", "svg-export-build.js"],
		muster: (w) => new RegExp("Flussweg:\\s*\"" + w + "\""),
		was: "SVGX_WAY_COLORS im SVG-Bauer, der Rueckfall -- er folgt der Karte",
	},
	{
		datei: ["js", "ui", "map-layer-picker.js"],
		muster: (w) => new RegExp("fill=\\\\?\"" + w + "\\\\?\""),
		was: "das Wasser im Landschafts-Vektor des Kartenfaechers",
	},
];

stellen.forEach((stelle) => {
	const quelle = ohneKommentare(lies(...stelle.datei));
	assert.ok(stelle.muster(WASSER).test(quelle),
		stelle.datei.join("/") + " traegt den Wasserton: " + stelle.was);
	assert.ok(!/#6ec6ff/i.test(quelle),
		stelle.datei.join("/") + " traegt den ALTEN Ton #6ec6ff nirgends mehr -- er war die"
		+ " Haelfte eines Paars, dessen andere Haelfte in tokens.css steht.");
});

// ---- 4. Der Bach faehrt mit ----------------------------------------------------------------------
// Ein Bach ist ein Flussweg mit Haekchen: unterschieden wird er ueber die BREITE, nie ueber die
// Farbe. Auf der Karte faellt das von selbst an (derselbe Subtyp); im SVG-Bauer steht er als
// eigene Zeile und muss mitgezogen werden.
const svgBauer = ohneKommentare(lies("js", "pages", "svg-export-build.js"));
assert.ok(new RegExp("Bach:\\s*\"" + WASSER + "\"").test(svgBauer),
	"der Bach traegt denselben Ton -- zwei Blautoene nebeneinander laesen sich als zwei"
	+ " Gewaesserarten.");
assert.ok(/Seeweg:\s*"#2f7dd3"/.test(svgBauer),
	"der Seeweg NICHT -- er ist eine Schiffsroute, kein Fluss.");

console.log("wasserton.test.js: alle Zusicherungen gruen");
