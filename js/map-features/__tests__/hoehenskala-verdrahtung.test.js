// js/map-features/__tests__/hoehenskala-verdrahtung.test.js
//
//   node js/map-features/__tests__/hoehenskala-verdrahtung.test.js
//
// Der Rechner nebenan (hoehenskala.test.js) kann vollständig grün sein, während auf der Seite
// nichts passiert: ein Skript, das index.html nicht lädt, ein Markup ohne Gegenstück im Code, ein
// Melder, den niemand abonniert. Genau das ist hier schon einmal passiert (Memory
// „gruener-test-beweist-nichts-ohne-verdrahtung"), deshalb prüft diese Datei die NÄHTE.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8");

const indexHtml = lies("index.html");
const render = lies("js/map-features/map-features-ecosystem-height-render.js");
const dialog = lies("js/map-features/map-features-ecosystem-properties.js");
const stil = lies("css/features/ecosystem-layer.css");
const rechner = lies("js/map-features/ecosystem-hoehenskala.js");

let bestanden = 0;
function pruefe(was, fn) {
	fn();
	bestanden++;
	console.log("  ok  " + was);
}

// ---- Wird der Rechner überhaupt geladen? --------------------------------------------------------
pruefe("index.html lädt ecosystem-hoehenskala.js", () => {
	assert.ok(indexHtml.indexOf('src="js/map-features/ecosystem-hoehenskala.js"') >= 0,
		"ohne <script> ist der ganze Rechner toter Code");
});

pruefe("der Rechner steht VOR dem Dialog, der ihn ruft", () => {
	const rechnerPos = indexHtml.indexOf('src="js/map-features/ecosystem-hoehenskala.js"');
	const dialogPos = indexHtml.indexOf('src="js/map-features/map-features-ecosystem-properties.js"');
	assert.ok(rechnerPos > 0 && dialogPos > 0);
	assert.ok(rechnerPos < dialogPos, "Ladereihenfolge ist in diesem Projekt ein Vertrag (AGENTS.md §3)");
});

// ---- Gibt es das Markup, und passt es zum Code? --------------------------------------------------
["heightscale", "scale-bar", "scale-ticks", "scale-note"].forEach((teil) => {
	pruefe('index.html trägt #ecosystem-properties-' + teil, () => {
		assert.ok(indexHtml.indexOf('id="ecosystem-properties-' + teil + '"') >= 0);
		assert.ok(dialog.indexOf('propertiesElement("' + teil + '")') >= 0,
			"und der Dialog greift genau danach");
	});
});

pruefe("der Abschnitt steht ZWISCHEN Gelände und Gipfeln (Owner-Entscheid 18.08.2026)", () => {
	const gelaende = indexHtml.indexOf('id="ecosystem-properties-terrain"');
	const skala = indexHtml.indexOf('id="ecosystem-properties-heightscale"');
	const gipfel = indexHtml.indexOf('id="ecosystem-properties-peaks"');
	assert.ok(gelaende > 0 && skala > 0 && gipfel > 0);
	assert.ok(gelaende < skala && skala < gipfel, "sonst sitzt die Ablesehilfe nicht dort, wo abgelesen wird");
});

// ---- Kommt der Weisspunkt wirklich aus dem Zeichner? ---------------------------------------------
pruefe("der Zeichner gibt whitePoint() und onPaint() heraus", () => {
	assert.ok(/whitePoint:\s*\(\)\s*=>/.test(render));
	assert.ok(/onPaint:\s*\(listener\)/.test(render));
});

pruefe("der Weisspunkt wird an der Stelle gemeldet, an der er ENTSTEHT", () => {
	// 🔴 Der Bezugswert entsteht seit dem 04.09.2026 aus dem gerechneten Raster (`hoechster`), nicht
	// mehr aus der Buckelsumme (`solidMode ? … : HEIGHT_WHITE_SCHRITT`). Gesucht wird deshalb die
	// ZUWEISUNG, nicht ihre damalige rechte Seite -- die Zusicherung ist „gemeldet wird der benutzte
	// Wert", und die gilt unveraendert.
	const bezug = render.indexOf("const reference = ");
	const meldung = render.indexOf("meldeAnstrich(reference)");
	assert.ok(bezug > 0 && meldung > bezug, "gemeldet wird der benutzte Wert, kein nachgerechneter");
});

pruefe("jeder frühe Ausstieg aus redraw() meldet 0 — sonst erklärt die Skala ein Bild, das fehlt", () => {
	// Alle vier Rückkehrpunkte vor der Malschleife: keine Ausdehnung, kein Dialog, leerer Stapel.
	const vorDerSchleife = render.slice(0, render.indexOf("meldeAnstrich(reference)"));
	const meldungen = (vorDerSchleife.match(/meldeAnstrich\(0\)/g) || []).length;
	assert.strictEqual(meldungen, 3, "drei frühe Ausstiege, drei Meldungen");
});

pruefe("der Melder feuert nur bei ÄNDERUNG — redraw() läuft bei jeder Kartenbewegung", () => {
	assert.ok(/if \(weisspunkt === lastWhitePoint\) \{\s*\n\s*return;/.test(render));
});

pruefe("ein werfender Zuhörer reisst das Zeichnen nicht mit", () => {
	// 🪤 NICHT bis "function ready" schneiden: die steht in dieser Datei WEITER OBEN, der Ausschnitt
	// wäre leer und der Test grün aus dem falschen Grund. Vom Prüflauf gefangen.
	const start = render.indexOf("function meldeAnstrich");
	const melder = render.slice(start, start + 900);
	assert.ok(melder.indexOf("try {") >= 0 && melder.indexOf("catch") >= 0,
		"die Karte ist wichtiger als ihre Legende");
});

// ---- Ruft der Dialog die Skala auch? -------------------------------------------------------------
pruefe("der Dialog baut die Skala beim Öffnen — NACH dem Sichtbarmachen", () => {
	const sichtbar = dialog.indexOf("overlayElement.hidden = false;");
	const aufbau = dialog.indexOf("renderEcosystemHeightScale(area);");
	assert.ok(sichtbar > 0 && aufbau > sichtbar,
		"im verborgenen Dialog ist der Balken 0 px breit, und ohne Breite gibt es keine Gruppierung");
});

pruefe("der Dialog abonniert den Melder", () => {
	assert.ok(dialog.indexOf("abonniereHoehenskala()") >= 0);
	assert.ok(dialog.indexOf("onPaint(") >= 0);
});

pruefe("nach dem Speichern einer Gipfelhöhe zieht die Skala ausdrücklich nach", () => {
	// 💣 Der Melder feuert nur bei geändertem WEISSPUNKT. 5.000 -> 4.000 lässt ihn unberührt, solange
	// ein höherer Gipfel im Bild steht -- ohne diesen Aufruf bliebe die Marke bei 5.000 stehen.
	const speichern = dialog.slice(dialog.indexOf("async function saveEcosystemPeakHeight"));
	const bisCatch = speichern.slice(0, speichern.indexOf("} catch (error) {"));
	assert.ok(bisCatch.indexOf("renderEcosystemHeightScale(currentPropertiesArea())") >= 0);
});

pruefe("die Skala erscheint nur bei Gebirgs-Topographie — sonst gibt es kein Höhenfeld", () => {
	assert.ok(/kind.*topographie/.test(dialog.slice(dialog.indexOf("function hatHoehenfeld"))));
	assert.ok(/region_type.*gebirge/.test(dialog.slice(dialog.indexOf("function hatHoehenfeld"))));
});

pruefe("ein Weisspunkt von 0 verbirgt die Skala, statt eine Null-Achse zu zeigen", () => {
	const bauer = dialog.slice(dialog.indexOf("function renderEcosystemHeightScale"));
	assert.ok(/!\(weisspunkt > 0\)/.test(bauer.slice(0, 3000)));
});

// ---- Trägt jede erzeugte Klasse auch eine Regel? -------------------------------------------------
[
	"ecosystem-properties-dialog__scale",
	"ecosystem-properties-dialog__scalebar",
	"ecosystem-properties-dialog__scalemark",
	"ecosystem-properties-dialog__scalemark--gruppe",
	"ecosystem-properties-dialog__scalename",
	"ecosystem-properties-dialog__scalename--gekippt",
	"ecosystem-properties-dialog__scaleticks",
	"ecosystem-properties-dialog__scalenote",
].forEach((klasse) => {
	pruefe("CSS kennt ." + klasse, () => {
		assert.ok(stil.indexOf("." + klasse) >= 0, "eine Klasse ohne Regel ist unsichtbarer Code");
	});
});

pruefe("die Ellipse sitzt am NAMEN, nicht an der Zeile — die Höhe bleibt lesbar", () => {
	const nameRegel = stil.slice(stil.indexOf(".ecosystem-properties-dialog__scalename em"));
	const bisEnde = nameRegel.slice(0, nameRegel.indexOf("}"));
	assert.ok(bisEnde.indexOf("text-overflow: ellipsis") >= 0);
	const zahlRegel = stil.slice(stil.indexOf(".ecosystem-properties-dialog__scalename b"));
	assert.ok(zahlRegel.slice(0, zahlRegel.indexOf("}")).indexOf("flex: none") >= 0,
		"die Zahl darf nie schrumpfen");
});

pruefe("der Winkel steht im CSS und im Rechner auf demselben Wert", () => {
	const imCss = /transform:\s*rotate\((\d+)deg\)/.exec(
		stil.slice(stil.indexOf(".ecosystem-properties-dialog__scalename")));
	const imJs = /HOEHENSKALA_WINKEL_GRAD = (\d+)/.exec(rechner);
	assert.ok(imCss && imJs);
	assert.strictEqual(imCss[1], imJs[1],
		"aus dem Winkel folgt der Mindestabstand — laufen sie auseinander, überlappen die Zeilen");
});

pruefe("keine hartkodierte Gestaltungsfarbe (AGENTS.md §12) ausser dem Datenverlauf", () => {
	const block = stil.slice(stil.indexOf("DIE HÖHENSKALA (Fall #79"), stil.indexOf(".ecosystem-properties-dialog__peaks-list"));
	const farben = block.match(/#[0-9a-fA-F]{3,8}/g) || [];
	// Erlaubt sind genau die zwei Enden des Graubalkens: sie SIND die gemalten Pixelwerte, keine
	// Gestaltungsentscheidung -- ein Token dafür wäre die zweite Wahrheit.
	assert.deepStrictEqual(farben.sort(), ["#000", "#fff"]);
	assert.ok(block.indexOf("var(--color-accent-brown)") >= 0, "alles andere kommt aus Tokens");
});

console.log("\n" + bestanden + " Zusicherungen gehalten.");
