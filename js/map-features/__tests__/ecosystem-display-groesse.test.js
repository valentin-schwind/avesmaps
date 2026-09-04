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
// ⚠️ Die Gipfel-Liste wird ABSICHTLICH mit hereingereicht, obwohl die Funktion sie nicht mehr
// braucht: baut jemand die Ausnahme wieder ein, faellt sie NICHT in ihren `typeof`-Rueckfall,
// sondern zeigt ihr echtes Verhalten -- und Abschnitt H schlaegt an, statt ungeprueft gruen zu sein.
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

// ---- H. GIPFEL: KEINE AUSNAHME -- auch sie folgen ihrem eigenen Band ---------------------------
// 🔴 DIE TAFEL RAET AUCH BEI GIPFELN (Owner 02.09.2026: „die einstellung bei darstellung zu den
// freien labels sind nur die default werte - die kleinen dreieckchen").
//
// 🪤 HIER STAND VOM 27.08. BIS ZUM 02.09.2026 DAS GEGENTEIL: fuer `berggipfel` und `vulkan` schlug
// die Tafel das eigene Band des Labels. Das war eine Fehllesung der Anweisung „berggipfel und
// vulkane sollen ab Z4 erscheinen" -- gemeint war die VORGABE (die Marke unter dem Regler), nicht
// ein Riegel. Der Preis war der gemeldete Fehler: „Der Dreizack" trug live `min_zoom 6` und stand
// trotzdem ab z4 auf der Karte; im Dialog liess sich an „Sichtbar ab Zoom" drehen, ohne dass
// irgendetwas geschah -- bei JEDEM der 76 Gipfel, und zwar STILL (der Wert wurde weiterhin
// gespeichert und nur beim Zeichnen ignoriert).
//
// 💣 Es gibt damit KEINE Art mehr, die von der Regel abweicht. Wer eine Ausnahme wieder einbaut,
// baut genau diesen Fehler wieder ein.
avesmapsEcosystemDisplayInstall(null);
["berggipfel", "vulkan"].forEach((art) => {
	const frueh = { labelType: art, minZoom: 2, maxZoom: 7 };
	assert.strictEqual(avesmapsLabelImBand(frueh, 3), true,
		`${art}: eigenes z2 zieht ihn auf z3 vor -- die Tafel (ab 4) raet nur`);
	const spaet = { labelType: art, minZoom: 6, maxZoom: 7 };
	assert.strictEqual(avesmapsLabelImBand(spaet, 5), false,
		`🔴 ${art}: eigenes z6 haelt ihn zurueck -- der gemeldete Fall „Der Dreizack"`);
	assert.strictEqual(avesmapsLabelImBand(spaet, 6), true, `${art}: ab z6 steht er da`);
	assert.strictEqual(avesmapsLabelImBand(spaet, 7), true, `${art}: bis z7 bleibt er`);
	// Ohne eigenes Band greift die Vorgabe der Art -- ab z4, wie bei jeder anderen Art auch.
	const ohne = { labelType: art, minZoom: null, maxZoom: null };
	assert.strictEqual(avesmapsLabelImBand(ohne, 3), false,
		`${art}: ohne eigenes Band gilt die Vorgabe`);
	assert.strictEqual(avesmapsLabelImBand(ohne, 4), true, `${art}: und die faengt bei z4 an`);
});

// ⚠️ Eine Uebersteuerung im Darstellungs-Fenster bleibt ebenfalls eine VORGABE -- sie schiebt einen
// Gipfel MIT eigenem Band nicht mit, sonst waere sie doch wieder ein Riegel.
avesmapsEcosystemDisplayInstall({ vorgabe: { berggipfel: { ab: 6, bis: 7 } } });
assert.strictEqual(avesmapsLabelImBand({ labelType: "berggipfel", minZoom: 0, maxZoom: 7 }, 4), true,
	"eine gesetzte Uebersteuerung schlaegt das eigene Band des Gipfels NICHT");
assert.strictEqual(avesmapsLabelImBand({ labelType: "berggipfel", minZoom: null, maxZoom: null }, 4), false,
	"aber sie fuellt die Luecke, wo kein eigenes Band steht");
avesmapsEcosystemDisplayInstall(null);

// 🪤 Und die Gegenprobe an einer Art, die nie eine Ausnahme war: unveraendert.
assert.strictEqual(avesmapsLabelImBand({ labelType: "see", minZoom: 0, maxZoom: 7 }, 0), true,
	"💣 der See folgt weiterhin seinem eigenen Band");

// 🔴 UND ES GIBT KEINE ZWEITE INSTANZ DAZWISCHEN (Owner 04.09.2026, nachdem es am 03.09. eine gab):
// shouldShowLabelMarker fragt die reine Regel SELBST. Eine Weiche davor, die „in dieser Ansicht gilt
// dein Wert nicht" sagt, ist genau der Riegel vom 27.08. in neuer Verkleidung -- Owner: „gelten muss
// immer die einstellung der editoren also der objekte".
const vonS = ohneKommentare.indexOf("function shouldShowLabelMarker(");
const bisS = ohneKommentare.indexOf("\n}", vonS);
assert.ok(/avesmapsLabelImBand\(entry\.label/.test(ohneKommentare.slice(vonS, bisS)),
	"shouldShowLabelMarker fragt sie");
assert.ok(!/ImBandDerAnsicht|GipfelAnsichtAktiv/.test(ohneKommentare),
	"💣 keine Ansichts-Weiche vor dem Band -- sie hat die Editor-Einstellung zweimal ausgehebelt");

console.log("ecosystem-display-groesse: alle Zusicherungen gruen");
