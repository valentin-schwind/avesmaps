// Die Rechnung hinter Text auf einer gebogenen Linie. 🔴 Diese Funktionen tragen live JEDEN Weg-,
// Fluss- und Kraftlinien-Namen der Karte und waren bis zum 22.08.2026 von keinem Test gedeckt --
// nicht aus Nachlaessigkeit, sondern weil sie in einer IIFE steckten und gar nicht ladbar waren.
// Seit dem Umzug in curved-label-layout.js geht es, also steht es hier.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 BEFUND, KEIN TEIL DIESER AUFGABE (siehe Bericht): findFreePlacement ruft in
// curved-label-layout.js OHNE typeof-Schutz `pathLabelBendSettings()` auf. Die Funktion selbst
// zieht laut Bauplan bewusst NICHT um -- sie bleibt lokale Closure-Variable INNERHALB der IIFE
// von map-features-path-label-canvas-overlay.js. Seit findFreePlacement diese IIFE verlassen hat,
// ist der Name aus seiner Sicht nicht mehr aufloesbar: jeder echte Aufruf (beide Aufrufstellen im
// Overlay) wirft live `ReferenceError: pathLabelBendSettings is not defined` -- nachgemessen, nicht
// vermutet: ohne den Schein-Ersatz unten stirbt genau dieser Test mit exakt dieser Meldung.
// Der Schein-Ersatz hier behebt NICHTS an der Produktion -- er haengt nur genug an den globalen
// Objekt, damit die REINE Rechnung von findFreePlacement ueberhaupt geprueft werden kann.
global.pathLabelBendSettings = function () {
	return { searchPx: 0, anchor: 0, relief: 0, maxTurn: 0 };
};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "curved-label-layout.js"), "utf8"));

// Eine waagerechte Linie von links nach rechts, 400 px lang.
const rechts = [{x: 0, y: 100}, {x: 400, y: 100}];
// Dieselbe Linie rueckwaerts.
const links = [{x: 400, y: 100}, {x: 0, y: 100}];

// --- Leserichtung: die Regel des Owners (Entwurf §4.1) -------------------------------------------
// „kannst du nicht ueberpruefen ob der 1. buchstabe weiter links ist wie der letzte?"
assert.strictEqual(labelSpanRunsLeftward(rechts, 100), false, "nach rechts laufend ist NICHT leftward");
assert.strictEqual(labelSpanRunsLeftward(links, 100), true, "nach links laufend IST leftward");

// 💣 Der Fall, an dem die Regel beim Entwerfen zweimal gescheitert ist: fast senkrecht, minimal nach
// links. Ein Toleranzband um die Senkrechte laesst genau das durch -- gemessen wurde damals eine
// Sehne von -102°, die als „noch senkrecht" durchging. Entschieden wird am Vorzeichen von dx, nicht
// an einem Winkelband.
const fastSenkrechtLinks = [{x: 200, y: 0}, {x: 199, y: 300}];
assert.strictEqual(labelSpanRunsLeftward(fastSenkrechtLinks, 100), true,
  "1 px nach links ist nach links -- kein Toleranzband um die verbotene Lage");

// --- Glyphenlagen ---------------------------------------------------------------------------------
const zeichen = ["A", "B", "C"];
const breiten = [10, 10, 10];
const glyphen = layoutGlyphsAlong(rechts, zeichen, breiten, 0, 0, 12);
assert.ok(Array.isArray(glyphen), "eine passende Linie liefert Glyphen");
assert.strictEqual(glyphen.length, 3, "je Zeichen eine Glyphe");
assert.ok(glyphen[0].x < glyphen[2].x, "erste Glyphe links von der letzten");
assert.ok(Math.abs(glyphen[0].y - 100) < 0.001, "auf der Linie");
// 🔧 Die Glyphe traegt ihre Drehung als `ang` (siehe layoutGlyphsAlong: `ang: p.ang`), nicht als
// `angle` -- der Brief hatte hier ein Feld benannt, das die Funktion nie zurueckgibt.
assert.ok(Math.abs(glyphen[0].ang) < 0.001, "waagerecht -> Drehung 0");

// 🔴 Zu kurz ist NULL, nicht eine gequetschte Reihe. Genau daran haengt Entwurf §4.4: ein
// abgeschnittener Buchstabe ist ein Laengenproblem und muss als solches erkennbar bleiben.
const kurz = [{x: 0, y: 0}, {x: 5, y: 0}];
assert.strictEqual(layoutGlyphsAlong(kurz, zeichen, breiten, 0, 0, 12), null,
  "passt der Text nicht, kommt null zurueck -- kein Teiltext");

// --- Bogenlaengen ---------------------------------------------------------------------------------
const knick = [{x: 0, y: 0}, {x: 30, y: 40}, {x: 30, y: 140}];
const kum = cumulativeLengths(knick);
assert.strictEqual(kum[0], 0);
assert.strictEqual(kum[1], 50, "3-4-5-Dreieck");
assert.strictEqual(kum[2], 150);

// --- Huellbox ---------------------------------------------------------------------------------
const box = glyphsHullBox(glyphen, 12);
assert.ok(box.right > box.left && box.bottom > box.top, "die Huelle hat Flaeche");
assert.ok(box.left < glyphen[0].x && box.right > glyphen[2].x, "sie umschliesst die Glyphen");

// --- Fenster schneiden ---------------------------------------------------------------------------
// 🔧 Ein blosses "laenger als 2" waere hier trivial erfuellt -- die Funktion haengt immer
// mindestens Start- und Endpunkt an (auch bei kaputter Interpolation), das Array ist also so gut
// wie garantiert nicht-leer. Stattdessen die Lage nachrechnen: bei center=75 (Mitte der 150 px
// langen Kette) und half=20 liegt das Fenster zwischen d=55 und d=95 -- beides auf dem zweiten
// Schenkel (d=50..150, x=30 fest, y=40+t*100), und weder d=50 noch d=150 liegen strikt dazwischen.
// Erwartet also GENAU zwei Punkte: (30, 45) und (30, 85).
const gesamt = kum[kum.length - 1];
const fenster = sliceLabelWindowAt(knick, kum, gesamt, gesamt / 2, 20);
assert.strictEqual(fenster.length, 2, "kein Original-Stuetzpunkt liegt strikt im Fenster -> genau die zwei Schnittpunkte");
assert.ok(Math.abs(fenster[0].x - 30) < 0.001 && Math.abs(fenster[0].y - 45) < 0.001, "Fensteranfang bei d=55 ist (30, 45)");
assert.ok(Math.abs(fenster[1].x - 30) < 0.001 && Math.abs(fenster[1].y - 85) < 0.001, "Fensterende bei d=95 ist (30, 85)");

// --- Drehprofil ---------------------------------------------------------------------------------
const profil = buildLabelTurningProfile(knick, LABEL_TURN_PROFILE_STEP_PX);
assert.ok(profil, "ein Profil entsteht");
const geradesProfil = buildLabelTurningProfile(rechts, LABEL_TURN_PROFILE_STEP_PX);
assert.ok(labelSpanTurning(geradesProfil, 0, 100) < 1, "eine Gerade dreht nicht");
assert.ok(labelSpanTurning(profil, 0, 150) > labelSpanTurning(geradesProfil, 0, 150),
  "der Knick dreht messbar mehr als die Gerade");

// --- Ausweichreihenfolge ---------------------------------------------------------------------------
const versatz = orderDodgeOffsets(60, 10, geradesProfil, 200, 100, 0);
assert.strictEqual(versatz[0], 0, "der Wunschplatz wird zuerst versucht");
assert.ok(versatz.length > 1, "und danach gibt es Ausweichplaetze");

// 🔧 "laenger als 1" allein waere trivial -- slide/step bestimmen die ANZAHL der Ausweichplaetze
// ganz unabhaengig davon, ob die Sortierung nach Kruemmung ueberhaupt funktioniert (12 Plaetze bei
// slide=60/step=10 entstehen auch bei kaputter Kostenrechnung). Deshalb hier zusaetzlich auf dem
// GEKRUEMMTEN Profil pruefen, dass tatsaechlich nach Kosten sortiert wird: wishCenter=75 liegt auf
// dem 3-4-5-Knick, textLen=20. Offsets +30..+60 und -40..-60 bleiben auf dem ruhigen ersten Schenkel
// (Kosten 0), -20 und -30 aber wandern hinter d=55 zurueck auf den Knick selbst und tragen die volle
// Kruemmung (0,6435 rad, wie oben gemessen) -- sie muessen deshalb ans ENDE der Liste rutschen.
const versatzGekruemmt = orderDodgeOffsets(60, 10, profil, 75, 20, 0);
const kostenGekruemmt = versatzGekruemmt.slice(1).map((offset) => labelSpanTurning(profil, 75 + offset - 10, 20));
for (let i = 1; i < kostenGekruemmt.length; i += 1) {
  assert.ok(kostenGekruemmt[i] >= kostenGekruemmt[i - 1] - 1e-9,
    "die Ausweichplaetze stehen in aufsteigender Kruemmung -- Platz " + i + " billiger als " + (i - 1));
}
assert.ok(kostenGekruemmt[kostenGekruemmt.length - 1] > 0,
  "mindestens ein Ausweichplatz beruehrt den Knick und traegt dessen Kruemmung");

// --- findFreePlacement ohne Belegungskarte ---------------------------------------------------------
// ⚠️ avesmapsLabelOccupancy und labelOccupancyBlocksGlyphs sind hier NICHT definiert. Beide werden
// per `typeof` abgefragt; ohne sie weicht niemand aus, und genau das wird hier festgehalten -- damit
// ein spaeterer Umbau, der die Abfrage in einen harten Zugriff verwandelt, hier auffliegt.
const platz = findFreePlacement(rechts, cumulativeLengths(rechts), 400, 200, zeichen, breiten, 0, 12, null, null);
assert.ok(platz && Array.isArray(platz.glyphs), "ohne Hindernisse steht der Name");

console.log("curved-label-layout: alle Zusicherungen erfuellt");
