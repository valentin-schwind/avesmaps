// Der Meldeweg der Kurvenform: Editor-iframe -> Hauptfenster -> Karte.
// Lauf: node js/review/__tests__/kraftlinie-kurve-meldeweg.test.js
//
// 🔴 Owner 29.08.2026: „die aenderungen am kurven parameter muessen auf der karte sichtbar werden
// und gespeichert werden". Das sind ZWEI Faelle, und ihre Verwechslung ist die teure:
//   - eine VORSCHAU (waehrend des Ziehens) ist fluechtig und darf die Kartendaten nicht anfassen,
//   - ein GESPEICHERTER Wert gehoert dauerhaft in properties.curve.
// Landete Gespeichertes nur in der Vorschau, waere die Kurve nach dem Schliessen wieder weg -- der
// Owner haette gespeichert und saehe nichts. Landete eine Vorschau in den Kartendaten, stuende ein
// nie gespeicherter Wert auf der Karte, bis jemand neu laedt.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), "utf8").replace(/\r\n/g, "\n");
// ⚠️ Kommentare weg, sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt.
const ohneKommentare = (text) => text
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "");

const host = ohneKommentare(lies("js", "review", "review-powerline-list.js"));
const editor = ohneKommentare(lies("html", "wiki-sync-powerline-editor.html"));

// ---- 1. Der Editor meldet ueberhaupt ---------------------------------------------------------
assert.ok(/function meldeKurvenAnKarte\(/.test(editor), "der Editor hat keinen Melder");
assert.ok(/avesmapsPowerlineCurvePreview:/.test(editor), "der Melder schickt keine Kurven");
assert.ok(/avesmapsPowerlineCurveGespeichert:/.test(editor),
	"der Melder unterscheidet Vorschau und Gespeichertes nicht");

// 💣 EINE Stelle fuer alle Erzeuger, sonst zeigt die Karte je nach Weg etwas anderes als der Editor.
// Der Melder wird beim Ziehen (false) und nach dem Speichern (true) gerufen -- beides muss da sein.
assert.ok(/meldeKurvenAnKarte\(false\)/.test(editor),
	"beim Ziehen wird nicht gemeldet -- man zieht blind");
assert.ok(/meldeKurvenAnKarte\(true\)/.test(editor),
	"nach dem Speichern wird nicht gemeldet -- die Karte bliebe auf dem alten Stand");

// 🪤 Und die Reihenfolge beim Speichern ist tragend: erst melden, DANN den Entwurf leeren. Nach dem
// Leeren waere nichts mehr zu melden, und die Karte behielte den alten Stand -- ein Fehler, den man
// erst beim naechsten Neuladen bemerkt.
const speicherBlock = editor.slice(editor.indexOf("meldeKurvenAnKarte(true)"));
const posMelden = 0;
const posLeeren = speicherBlock.indexOf("curveDraft = {}");
assert.ok(posLeeren > posMelden,
	"der Entwurf wird geleert, BEVOR gemeldet wird -- dann ist nichts mehr zu melden");

// ---- 2. Das Hauptfenster hoert zu und trennt die zwei Faelle ---------------------------------
// 🪤 GEMESSEN WIRD IM EMPFAENGER-BLOCK, nicht irgendwo in der Datei. Dieselben Muster stehen auch
// im Kartenregler daneben (`zeichneNeu`, `aufFertig`) -- eine Zusicherung ueber die ganze Datei ist
// deshalb Vakuum: zwei Mutationen ueberlebten am 29.08.2026 genau daran.
const empfaengerVon = host.indexOf('window.addEventListener("message"');
assert.ok(empfaengerVon > -1, "das Hauptfenster hoert nicht auf die Meldung");
const empfaenger = host.slice(empfaengerVon, host.indexOf("}, false);", empfaengerVon));
assert.ok(/event\.origin !== location\.origin/.test(empfaenger),
	"der Empfaenger prueft die Herkunft nicht -- eine fremde Seite koennte die Karte verbiegen");
assert.ok(/if \(gespeichert\)/.test(empfaenger), "die zwei Faelle werden nicht getrennt");
// Der gespeicherte Wert geht in die KARTENDATEN ...
assert.ok(/pl\.properties\.curve = wert;/.test(empfaenger),
	"ein gespeicherter Wert landet nicht dauerhaft in den Kartendaten");
// ... und die Vorschau faellt dabei, sonst laege ein fluechtiger Wert darueber.
const gespeichertZweig = empfaenger.slice(empfaenger.indexOf("if (gespeichert)"),
	empfaenger.indexOf("} else {", empfaenger.indexOf("if (gespeichert)")));
assert.ok(/Vorschau\.werte = null/.test(gespeichertZweig),
	"nach dem Speichern bleibt die Vorschau liegen und ueberdeckt den echten Wert");
// Und die Vorschau geht NICHT in die Kartendaten.
const vorschauZweig = empfaenger.slice(empfaenger.indexOf("} else {", empfaenger.indexOf("if (gespeichert)")));
assert.ok(!/properties\.curve =/.test(vorschauZweig),
	"eine blosse Vorschau schreibt in die Kartendaten -- sie ueberlebte das Schliessen");

// ---- 3. Beide Faelle zeichnen neu -------------------------------------------------------------
// 🪤 Ohne das aendert sich der Wert im Speicher und auf der Karte passiert nichts -- genau das
// Symptom, mit dem der Owner gekommen ist („warum seh ich auf der karte noch keine aenderungen").
assert.ok(/refreshPowerlineLayers\(\);/.test(empfaenger),
	"nach der Meldung wird nicht neu gezeichnet");

// ---- 4. Unbrauchbares rutscht nicht durch ----------------------------------------------------
assert.ok(/Number\.isFinite\(wert\)/.test(empfaenger),
	"ein unlesbarer Wert wandert ungeprueft in die Kartendaten (NaN in der Geometrie)");

console.log("OK: Kurven-Meldeweg -- Editor meldet, Hauptfenster trennt Vorschau und Gespeichertes.");
