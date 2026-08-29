// Der Kurvenform-Schieber im Kraftlinien-Editor. Quelltext-Test, weil die Seite ein
// eigenstaendiges iframe-Dokument ohne Modulgrenzen ist. Lauf:
//   node js/pages/__tests__/kraftlinie-kurve-editor.test.js
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §8
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const datei = path.join(__dirname, "..", "..", "..", "html", "wiki-sync-powerline-editor.html");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
const quelle = fs.readFileSync(datei, "utf8").replace(/\r\n/g, "\n");
// ⚠️ Kommentare wegschneiden, sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt
// -- und der naechste Leser loescht dann den Kommentar, um den Test gruen zu bekommen.
const ohneKommentare = quelle
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "");

// ---- 1. Der Schieber steht IM Identitaet-Block ----------------------------------------------
// 🔴 Ausdruecklich KEIN eigener dt-grp-Abschnitt: editor-abschnittsreihenfolge.test.js fuehrt die
// Abschnittsfolge dieses Fensters als feste Owner-Liste (Identitaet -> Beschreibung ->
// Wiki-Zuweisung -> Quellen -> Speicherleiste). Ein neuer Kopf hiesse eine sechste Zeile darin --
// fuer EIN Feld, das eine Darstellungsentscheidung ist wie das Haekchen darueber.
const posShowLabel = ohneKommentare.indexOf('id="plShowLabel"');
const posCurve = ohneKommentare.indexOf('id="plCurve"');
const posBeschreibung = ohneKommentare.indexOf('"dt-grp">Beschreibung<');
assert.ok(posShowLabel > -1, "das Haekchen plShowLabel steht nicht mehr da -- umbenannt?");
assert.ok(posCurve > -1, "der Kurvenform-Schieber (#plCurve) fehlt");
assert.ok(posBeschreibung > -1, "der Abschnitt Beschreibung steht nicht mehr da");
assert.ok(posCurve > posShowLabel,
	"der Schieber gehoert UNTER das Haekchen 'Name auf der Karte anzeigen' (Owner-Bild 29.08.2026)");
assert.ok(posCurve < posBeschreibung,
	"der Schieber ist aus dem Identitaet-Block herausgerutscht");

// ---- 2. Der Bereich ist der des Entwurfs ----------------------------------------------------
const schieber = ohneKommentare.slice(posCurve - 200, posCurve + 200);
assert.ok(/type="range"/.test(schieber), "#plCurve ist kein Schieber");
assert.ok(/min="-45"/.test(schieber), "der Bereich beginnt nicht bei -45");
assert.ok(/max="45"/.test(schieber), "der Bereich endet nicht bei 45");

// ---- 3. Der Wert reist im Schreibrumpf mit --------------------------------------------------
// 💣 Ohne diese Zeile speichert der Schieber nichts, und weil der Server einen fehlenden Schluessel
// als 0 liest, LOESCHT jedes Speichern die Kurve -- lautlos.
assert.ok(/curve:\s*Number\(\$\("plCurve"\)\.value\)/.test(ohneKommentare),
	"saveLine schickt curve nicht mit");

// ---- 4. Der geladene Wert wird angezeigt ----------------------------------------------------
// 💣 Eine Linie hat viele Segmente. Gelesen wird wie bei description/wiki_url ueber fieldSample --
// NICHT some()/every(): das sind Wahrheitswerte, curve ist eine ZAHL, und `some` laese eine
// gespeicherte 0 als "nicht gesetzt".
assert.ok(/fieldSample\(line,\s*"curve"\)/.test(ohneKommentare),
	"renderDetail liest curve nicht ueber fieldSample");
assert.ok(!/segments\.some\(\(s\)\s*=>\s*s\.curve\)/.test(ohneKommentare),
	"curve ist eine ZAHL -- some() liest 0 und -0 als 'nicht gesetzt'");

// ---- 5. Die Attrappe traegt das Feld --------------------------------------------------------
// ⚠️ Ohne curve in demoData laeuft der Vorschau-Modus der Seite gegen undefined, und ein Entwickler
// ohne Datenbank sieht einen Fehler, den es in der Wirklichkeit nicht gibt.
assert.ok(/curve:\s*0/.test(ohneKommentare), "die Demo-Segmente tragen kein curve");

// ---- 6. Die Anzeige nennt eine Einheit ------------------------------------------------------
// Eine nackte Zahl an einem Schieber sagt nicht, ob sie Prozent, Grad oder Meilen ist.
assert.ok(/id="plCurveVal"/.test(ohneKommentare), "es gibt keine Wertanzeige zum Schieber");
assert.ok(/function curveText\(/.test(ohneKommentare), "curveText() fehlt -- wer formatiert dann?");
assert.ok(/"\s*%"/.test(ohneKommentare) || /'\s*%'/.test(ohneKommentare),
	"die Anzeige nennt die Einheit (Prozent) nicht");

// ---- 7. Der Schieber ist mit der Anzeige verdrahtet -----------------------------------------
// 🪤 „Das Element ist da" ist auch dann erfuellt, wenn niemand darauf hoert -- der Schieber liesse
// sich ziehen, und die Zahl daneben bliebe stehen.
assert.ok(/\$\("plCurve"\)\.addEventListener\("input"/.test(ohneKommentare),
	"niemand hoert auf das Ziehen des Schiebers -- die Anzeige bliebe stehen");

console.log("OK: Kraftlinien-Kurve -- Schieber im Identitaet-Block, Bereich, Lesen und Schreiben.");
