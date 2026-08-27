const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 SEIT DEM 24.08.2026 GILT FÜR GRÖSSE UND BAND DIESELBE REGEL: die Tafel RÄT, sie gilt nicht.
//
// Einen Tag lang stand hier das Gegenteil („GROESSE: die Tafel GILT, der eigene Wert des Labels
// wird nicht mehr gelesen"), und das war eine Fehllesung des Auftrags. Der Owner wollte den
// Editoren den Regler NICHT wegnehmen: „ich wollte den editoren diese nicht von den labels
// wegnehmen, sondern den slider beibehalten und denen den default wert vorschlagen".
//
// ⭐ Damit ist das Modell einfacher als vorher gedacht -- eine Regel statt zweier. Der Wert des
// Labels gewinnt; die Tafel füllt nur die Lücke und steht als Marke unter dem Regler.
//
// ⚠️ Live tragen 938 von 938 Beschriftungen eine eigene Größe (12-50 pt, gemessen 24.08.2026).
// Die Tafel wirkt heute also auf KEINE einzige -- sie ist der Vorschlag für neue. Genau wie beim
// Zoomband, und aus demselben Grund harmlos beim Ausliefern.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-groesse.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);

const quelle = fs.readFileSync(path.join(__dirname, "../map-features-labels.js"), "utf8");
// 💣 Die Prosa erklaert hier genau das Gesuchte -- ein Treffer im Kommentar ist kein Beweis.
const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

// ---- A. GRÖSSE: der eigene Wert gewinnt -- AUSGEFÜHRT, nicht gelesen ---------------------------
const vonG = quelle.indexOf("function getScaledLabelSize(");
assert.ok(vonG >= 0, "getScaledLabelSize steht in der Datei");
const bisG = quelle.indexOf("\n}", vonG);
const getScaledLabelSize = new Function(
	"map", "getVisualZoomLevel", "VISUAL_MAX_ZOOM_LEVEL", "LABEL_SIZE_DEEP_ZOOM_STEP",
	"avesmapsEcosystemDisplayGroesse",
	quelle.slice(vonG, bisG + 2) + "; return getScaledLabelSize;"
)(
	{ getZoom: () => 5 },
	(z) => z,
	5,
	0.08,
	avesmapsEcosystemDisplayGroesse
);

// Bei Zoom 5 ist der Faktor genau 1,0 -- die Grundgröße kommt unverändert heraus.
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(getScaledLabelSize({ labelType: "wald", size: 30 }), 30,
	"der eigene Wert des Labels gewinnt");
assert.strictEqual(getScaledLabelSize({ labelType: "wald", size: 12 }), 12,
	"auch ein kleiner");

// 🔴 Und er gewinnt AUCH, wenn die Tafel etwas anderes sagt -- das ist der ganze Punkt.
// ⚠️ 26, nicht 40: die Tafel nimmt nur 4-30 pt an, darueber faellt ihr Leser auf die Vorgabe
// zurueck -- der Test maesse dann die Schranke statt der Regel.
avesmapsEcosystemDisplayInstall({ groesse: { wald: [26, 26, 26, 26, 26, 26, 26, 26, 26] } });
assert.strictEqual(getScaledLabelSize({ labelType: "wald", size: 30 }), 30,
	"die Tafel überschreibt den eigenen Wert NICHT");

// ---- B. Ohne eigenen Wert füllt die Tafel die Lücke --------------------------------------------
assert.strictEqual(getScaledLabelSize({ labelType: "wald", size: null }), 26,
	"ohne eigene Größe gilt die Tafel");
assert.strictEqual(getScaledLabelSize({ labelType: "wald" }), 26,
	"ein fehlendes Feld ebenso");
// 💣 `Number(null)` ist 0, nicht NaN. Ohne die ausdrückliche Prüfung fiele ein Label ohne Größe auf
// die Untergrenze statt auf die Tafel -- dieselbe Falle wie beim Zoomband.
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(getScaledLabelSize({ labelType: "wald", size: null }), 18,
	"und ohne Übersteuerung auf die Vorgabe, nicht auf 10");

// ---- C. 🔴 DER REGLER IST WIEDER DA -------------------------------------------------------------
const seite = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
assert.ok(/id="label-edit-size-range"/.test(seite),
	"der Größenregler steht wieder im Beschriftungsdialog");
assert.ok(!/id="label-edit-size"[^>]*type="hidden"/.test(seite),
	"und das Feld ist kein hidden mehr");
assert.ok(/id="label-edit-size"[^>]*name="size"/.test(seite),
	"es trägt weiter seinen Namen -- sonst fällt es aus dem Payload");
// ⚠️ Und es trägt wieder seine Spanne, sonst nimmt der Regler jeden Wert an.
assert.ok(/id="label-edit-size"[^>]*min="12"[^>]*max="50"/.test(seite),
	"mit der Spanne 12-50, wie vor dem Umbau");

// ---- D. Die Marke darunter zeigt die GRUNDgröße --------------------------------------------------
// 🔴 Der Regler setzt eine Grundgröße, die Tafel führt eine KURVE über neun Zoomstufen. Übersetzt
// wird das über den z5-Wert: dort ist der Zoomfaktor genau 1,0, die Grundgröße IST also der
// z5-Eintrag. Wer eine andere Stufe nimmt, verschiebt jeden Vorschlag -- und es fällt nicht auf.
assert.strictEqual(typeof avesmapsEcosystemDisplayBasisGroesse, "function",
	"das Modul sagt, welche Grundgröße eine Art vorschlägt");
assert.strictEqual(avesmapsEcosystemDisplayBasisGroesse("wald"), 18,
	"ohne Übersteuerung die historische 18");
avesmapsEcosystemDisplayInstall({ groesse: { wald: [9, 11, 13, 14, 16, 26, 19, 21, 21] } });
assert.strictEqual(avesmapsEcosystemDisplayBasisGroesse("wald"), 26,
	"und sonst der z5-Wert der Tafel");
assert.ok(/id="label-edit-size-marke"/.test(seite), "der Regler trägt eine Vorgabemarke");

// ---- E. Ohne Übersteuerung ist die Kurve die heutige ------------------------------------------
avesmapsEcosystemDisplayInstall(null);
assert.deepStrictEqual(
	[0, 1, 2, 3, 4, 5, 6, 7].map((z) => avesmapsEcosystemDisplayGroesse("wald", z)),
	[9, 11, 13, 14, 16, 18, 19, 21],
	"die Vorgabe ist die heutige Kurve bei Grundgroesse 18"
);

// ---- F. Die Tafel wirkt je ART ------------------------------------------------------------------
avesmapsEcosystemDisplayInstall({ groesse: { gebirge: [20, 20, 20, 20, 20, 20, 20, 20, 20] } });
assert.strictEqual(avesmapsEcosystemDisplayGroesse("gebirge", 3), 20, "die gesetzte Art folgt der Tafel");
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 3), 14, "eine andere Art bleibt bei der Vorgabe");

// ---- G. BAND: dieselbe Regel, und das ist jetzt der Punkt --------------------------------------
// ⭐ Größe und Band lesen sich seither gleich. Vorher waren es zwei Regeln, und die Gefahr war, sie
// zu verwechseln; jetzt gibt es nur noch eine.
const vonB = quelle.indexOf("function avesmapsLabelImBand(");
assert.ok(vonB >= 0, "avesmapsLabelImBand steht als eigene Funktion da");
const bisB = quelle.indexOf("\n}", vonB);
// ⚠️ ZWEI Nachbarn hereinreichen: die Tafel UND die Gipfel-Liste. Ohne die zweite faellt die Funktion
// in ihren `typeof`-Rueckfall, und die Gipfel-Regel unten waere ungeprueft gruen.
const avesmapsLabelImBand = new Function(
	"avesmapsEcosystemDisplaySichtbar", "isEcosystemPeakSubtype",
	quelle.slice(vonB, bisB + 2) + "; return avesmapsLabelImBand;"
)(avesmapsEcosystemDisplaySichtbar, (typ) => typ === "berggipfel" || typ === "vulkan");

avesmapsEcosystemDisplayInstall({ vorgabe: { wald: { ab: 2, bis: 4 } } });
const mitEigenem = { labelType: "wald", minZoom: 0, maxZoom: 7 };
assert.strictEqual(avesmapsLabelImBand(mitEigenem, 0), true, "eigenes Band z0-z7: z0 sichtbar");
assert.strictEqual(avesmapsLabelImBand(mitEigenem, 6), true, "und z6 auch -- die Tafel saehe z6 nicht");
assert.strictEqual(avesmapsLabelImBand(mitEigenem, 8), false, "ausserhalb des eigenen Bandes nicht");

const ohneEigenes = { labelType: "wald", minZoom: null, maxZoom: null };
assert.strictEqual(avesmapsLabelImBand(ohneEigenes, 1), false, "ohne eigenes Band gilt die Vorgabe: z1 nicht");
assert.strictEqual(avesmapsLabelImBand(ohneEigenes, 3), true, "z3 schon");
assert.strictEqual(avesmapsLabelImBand(ohneEigenes, 6), false, "z6 nicht");

// ---- H. GIPFEL: die Tafel GILT, statt zu raten (Owner 27.08.2026) -------------------------------
// 🔴 „berggipfel und vulkane sollen ab Z4 erscheinen“ -- und live traegt JEDER der 73 Gipfel ein
// eigenes min_zoom (z2: 2, z3: 30, z4: 19, z5: 17, z6: 5). Als blosse Vorgabe waere die Anweisung
// deshalb WIRKUNGSLOS gewesen: die Tafel greift sonst nur, wo ein Label KEIN eigenes Band traegt.
// Fuer die zwei Gipfelarten -- und nur fuer sie -- schlaegt sie das eigene Band.
//
// 💣 DAS IST DIE AUSNAHME VON „DIE TAFEL RAET“, und sie muss eine Ausnahme bleiben: gaelte sie fuer
// alle Arten, naehme sie den Editoren ihre 939 einzeln gesetzten Baender weg.
avesmapsEcosystemDisplayInstall(null);
["berggipfel", "vulkan"].forEach((art) => {
	const frueh = { labelType: art, minZoom: 2, maxZoom: 7 };
	assert.strictEqual(avesmapsLabelImBand(frueh, 3), false,
		`${art}: eigenes z2 zieht ihn NICHT mehr auf z3 vor`);
	assert.strictEqual(avesmapsLabelImBand(frueh, 4), true, `${art}: ab z4 steht er da`);
	const spaet = { labelType: art, minZoom: 6, maxZoom: 7 };
	assert.strictEqual(avesmapsLabelImBand(spaet, 4), true,
		`🔴 ${art}: eigenes z6 haelt ihn NICHT mehr zurueck -- „ab z4“ heisst ab z4, nicht „fruehestens“`);
	assert.strictEqual(avesmapsLabelImBand(spaet, 7), true, `${art}: bis z7 bleibt er`);
});

// ⚠️ Die Uebersteuerung wirkt auch auf sie -- sie stehen nicht ausserhalb der Tafel, sondern folgen
// ihr enger als alle anderen. Sonst gaebe es die Zahl zweimal.
avesmapsEcosystemDisplayInstall({ vorgabe: { berggipfel: { ab: 6, bis: 7 } } });
assert.strictEqual(avesmapsLabelImBand({ labelType: "berggipfel", minZoom: 0, maxZoom: 7 }, 4), false,
	"eine gesetzte Uebersteuerung schiebt den Gipfel mit");
avesmapsEcosystemDisplayInstall(null);

// 🪤 Und eine Art, die KEIN Gipfel ist, behaelt ihr eigenes Band -- sonst waere die Ausnahme keine.
assert.strictEqual(avesmapsLabelImBand({ labelType: "see", minZoom: 0, maxZoom: 7 }, 0), true,
	"💣 der See folgt weiterhin seinem eigenen Band");

const vonS = ohneKommentare.indexOf("function shouldShowLabelMarker(");
const bisS = ohneKommentare.indexOf("\n}", vonS);
assert.ok(/avesmapsLabelImBand\(entry\.label/.test(ohneKommentare.slice(vonS, bisS)),
	"shouldShowLabelMarker fragt sie");

console.log("ecosystem-display-groesse: alle Zusicherungen gruen");
