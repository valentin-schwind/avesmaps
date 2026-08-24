const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Die Vorgabemarke auf den Reglern des Beschriftungsdialogs (Entwurf §6).
//
// 🔴 Der Editor sieht EINE Marke, und die kommt aus der Zoombandeinstellung (Owner 24.08.2026:
// „wir ermitteln den median, der wert, den die editoren sehen ist der wert aus der
// zoombandeinstellung").
//
// 💣 DER MEDIAN ERREICHT IHN NIE -- er ist unser Werkzeug, mit dem wir die Vorgabe festlegen. Eine
// zweite, graue Marke hiesse „richte dich nach dem Durchschnitt", und das ist das Gegenteil einer
// Vorgabe: sie zementierte den Bestand, statt ihn zu lenken. Im Prototyp stand eine solche Marke
// kurzzeitig und ist am selben Tag gefallen.
//
// 🔴 DAS MODELL IST GEMISCHT: Farbe und Groesse gibt die Tafel VOR (der Editor hat dafuer kein
// Feld mehr), Zoomband, max. Namen und Prioritaet RAET sie nur -- dort behaelt er seinen Regler und
// sieht die Vorgabe als Marke.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/label-vorgabemarke.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const seite = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const skript = fs.readFileSync(path.join(wurzel, "js/review/review-labels.js"), "utf8");
const stil = fs.readFileSync(path.join(wurzel, "css/components/location-report-dialog.css"), "utf8");

// ---- A. Die Marke ist da, fuer die vier geratenen Felder ----------------------------------------
["curve-max", "min-zoom", "max-zoom", "priority"].forEach((feld) => {
	assert.ok(seite.indexOf('id="label-edit-' + feld + '-marke"') >= 0,
		"das Feld " + feld + " traegt eine Vorgabemarke");
});

// ---- B. 💣 KEINE Median-Marke --------------------------------------------------------------------
const vonD = seite.indexOf('id="label-edit-form"');
assert.ok(vonD >= 0, "der Beschriftungsdialog steht in der Seite");
const dialog = seite.slice(vonD, vonD + 8000);
assert.ok(!/median/i.test(dialog), "im Beschriftungsdialog steht nirgends „Median“");
// 🪤 Gemessen wird der CODE, nicht die Prosa: der Kommentar ueber der Marke ERKLAERT genau
// diese Regel und traegt das Wort. Ein Test, der ihn trifft, prueft seine eigene Begruendung --
// derselbe Fehler steckte schon in zwei Zusicherungen dieses Umbaus (map-labels.css und der
// Kurven-Prototyp).
const ohneKommentare = skript
	.replace(/\/\*[\s\S]*?\*\//g, " ")
	.split(String.fromCharCode(10))
	.map((zeile) => { const s = zeile.indexOf("//"); return s === -1 ? zeile : zeile.slice(0, s); })
	.join(String.fromCharCode(10));
assert.ok(!/median/i.test(ohneKommentare),
	"der Dialogcode rechnet mit keinem Median -- er sieht nur die Vorgabe");

// ---- C. 💣 Die Umrechnung beruecksichtigt die Knopfbreite ---------------------------------------
// Ohne die Korrektur steht die Marke an BEIDEN Enden sichtbar daneben -- der Knopf hat eine Breite,
// sein Mittelpunkt wandert nur ueber (100% - Knopfbreite). Und an den Enden liegen die
// interessanten Werte (z0, z7).
const vonP = skript.indexOf("function avesmapsLabelVorgabeMarkePosition");
assert.ok(vonP >= 0, "die Umrechnung steht als eigene Funktion da");
const avesmapsLabelVorgabeMarkePosition = new Function(
	skript.slice(vonP, skript.indexOf("\n}", vonP) + 2) + "; return avesmapsLabelVorgabeMarkePosition;"
)();

// Sie ist rein und wird AUSGEFUEHRT -- ein Blick in den Quelltext belegt keine Rechnung.
const links = avesmapsLabelVorgabeMarkePosition(0, 0, 7);
const mitte = avesmapsLabelVorgabeMarkePosition(3.5, 0, 7);
const rechts = avesmapsLabelVorgabeMarkePosition(7, 0, 7);
assert.ok(/calc\(/.test(links) && /px/.test(links), "die Position rechnet in calc mit Pixeln: " + links);
assert.ok(links.indexOf("0%") >= 0, "ganz links sind es 0 % plus der halbe Knopf: " + links);
assert.ok(rechts.indexOf("100%") >= 0, "ganz rechts 100 % minus der halbe Knopf: " + rechts);
// 🔴 Die Korrektur muss an den Enden ENTGEGENGESETZT wirken, sonst verschiebt sie nur alles.
const zahl = (s) => Number((s.match(/([+-]?[0-9.]+)px/) || [])[1]);
assert.ok(zahl(links) > 0, "links wird nach INNEN geschoben: " + links);
assert.ok(zahl(rechts) < 0, "rechts nach innen, also andersherum: " + rechts);
assert.ok(Math.abs(zahl(mitte)) < 1e-9, "in der Mitte ist die Korrektur null: " + mitte);

// ⚠️ Eine Spanne ohne Breite darf nicht durch null teilen.
assert.ok(/calc\(/.test(avesmapsLabelVorgabeMarkePosition(3, 3, 3)),
	"min === max liefert eine gueltige Position statt NaN");

// ---- D. Das Groessenfeld ist ein hidden geworden -------------------------------------------------
// 🔴 GROESSE gibt die Tafel VOR -- der Editor hat dafuer kein Feld mehr. Aber das Feld BLEIBT als
// hidden im Formular: der Payload liest formData.get("size"), und ohne das Feld schriebe jedes
// Speichern eine 0 ueber den gemerkten Wert.
assert.ok(/id="label-edit-size"[^>]*type="hidden"/.test(seite), "Groesse ist hidden");
assert.ok(/id="label-edit-size"[^>]*name="size"/.test(seite), "und traegt weiter seinen Namen");
assert.ok(!/id="label-edit-size-range"/.test(seite), "der Regler dazu ist weg");

// ---- E. Die Marke sitzt UNTER dem Balken ---------------------------------------------------------
// 💣 Auf dem Balken verdeckt der Reglerknopf sie genau dann, wenn Wert und Vorgabe uebereinstimmen
// -- also im HAEUFIGSTEN Fall. Eine Marke, die im Normalfall unsichtbar ist, ist keine.
assert.ok(/\.label-edit-marke\b/.test(stil), "die Marke hat eine Regel");
// 🪤 Gesucht wird die REGEL, nicht der Praefix: `.label-edit-markewrap` steht davor und faengt
// den blossen indexOf ab -- der Test las dann die Huelle statt der Marke.
const vonM = stil.indexOf(".label-edit-marke {");
const regel = stil.slice(vonM, stil.indexOf("}", vonM));
assert.ok(/position:\s*absolute/.test(regel), "sie liegt absolut");
assert.ok(/bottom:/.test(regel), "und haengt am unteren Rand, nicht auf dem Balken");
// ⚠️ Kein harter Farbwert (§12).
assert.ok(!/#[0-9a-fA-F]{3,6}/.test(regel), "und benutzt ein Token, keinen Hexwert: " + regel);

// ---- F. Die Vorgaben kommen aus dem geteilten Modul ----------------------------------------------
// 🔴 Nicht aus einer zweiten Tafel im Dialog -- sonst saehe der Editor etwas anderes als die Karte.
assert.ok(/avesmapsEcosystemDisplayVorgabe/.test(skript),
	"der Dialog liest die Vorgabe aus dem Modul, gegen das auch die Karte zeichnet");
assert.ok(!/ab:\s*0,\s*bis:\s*7/.test(skript), "und schreibt sie nicht ab");

// ---- G. 💣 Wechselt die ART, wandern die Marken -------------------------------------------------
// Die Vorgabe haengt an der Art. Ohne diese Verdrahtung zeigte ein Dialog, in dem jemand die Art
// umstellt, weiter die Marken der ALTEN -- und das sieht aus wie eine Vorgabe, die nicht stimmt.
const vonZ = skript.indexOf("function avesmapsLabelZeichneVorgabeMarken");
assert.ok(vonZ >= 0, "es gibt einen Zeichner fuer die Marken");
assert.ok(/label-edit-subtype[\s\S]{0,400}addEventListener\("change"/.test(skript)
	|| /addEventListener\("change"[\s\S]{0,400}avesmapsLabelZeichneVorgabeMarken/.test(skript),
	"und er haengt am Wechsel der Art");

console.log("label-vorgabemarke: alle Zusicherungen gruen");
