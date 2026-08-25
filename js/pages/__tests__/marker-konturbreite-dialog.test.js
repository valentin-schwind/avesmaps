const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Der Regler „Konturbreite" im Fenster „Zoombänder" (Ortseditor → Darstellung).
// Owner 26.08.2026: „mit dem punkt wachsen, bau das."
//
// 💣 WARUM DAS EINEN EIGENEN TEST BRAUCHT (dieselbe Begründung wie zoombaender-abstaende-dialog.test.js):
// Fenster, Vorgabetafel und Kartenzeichner sprechen über einen Bezeichnernamen und eine JSON-Nutzlast
// miteinander, und keins davon hat eine Signatur. Läuft ein Name auseinander, passiert NICHTS
// Sichtbares -- der Wert wird gespeichert und gelesen, aber ignoriert.
//
// ⭐ Der Test liest die betroffenen Dateien als TEXT, wie sein Vorbild.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/marker-konturbreite-dialog.test.js

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const seite = read("html/wiki-sync-settlement-editor.html");
const vorgabetafel = read("js/map-features/location-zoom-bands.js");
const zeichner = read("js/map-features/map-features-location-marker-rendering.js");

// ---- 1. Die Reglerzeile steht im Markup, mit ihrer eigenen Schranke ------------------------------
// 🔴 0 bis 100 PROZENT -- nicht die 0-20 px der Abstände. Wäre sie an deren Schranke geklemmt, wären
// vier Fünftel des Reglers wirkungslos, ohne dass irgendwo eine Meldung erschiene.
const rangeTag = seite.match(/<input[^>]*id="zbKonturRange"[^>]*>/);
assert.ok(rangeTag, "der Regler zbKonturRange steht im Markup");
assert.ok(/type="range"/.test(rangeTag[0]), "zbKonturRange ist ein <input type=\"range\">");
assert.ok(/min="0"/.test(rangeTag[0]) && /max="100"/.test(rangeTag[0]) && /step="1"/.test(rangeTag[0]),
	"zbKonturRange traegt min=0, max=100, step=1");
const inputTag = seite.match(/<input[^>]*id="zbKonturInput"[^>]*>/);
assert.ok(inputTag, "das Zahlenfeld zbKonturInput steht im Markup");
assert.ok(/min="0"/.test(inputTag[0]) && /max="100"/.test(inputTag[0]) && /step="1"/.test(inputTag[0]),
	"zbKonturInput traegt dieselben Schranken");
assert.ok(/id="zbKonturReset"/.test(seite), "der Ruecksetzer zbKonturReset steht im Markup");

// ---- 2. 🔴 SIE STEHT AM ENDE DES MARKER-ABSCHNITTS, VOR DER VORSCHAU -----------------------------
// Owner-Vorgabe, woertlich: „am Ende von Marker (aber vor Vorschau)". Die Zeile teilt sich ihre
// Mechanik mit den vier Reglern unter „Abstände" -- wer sie dorthin schiebt, weil das bequemer ist,
// trennt sie von der Zahl, die sie aufteilt (dem Aussendurchmesser aus dem Plot darueber).
const posMarkerPlot = seite.indexOf('id="zbPlotMarker"');
const posKontur = seite.indexOf('id="zbKonturRange"');
const posVorschau = seite.indexOf('id="seZoomBandsPreviewStage"');
const posAbstaende = seite.indexOf("<h3>Abstände</h3>");
assert.ok(posMarkerPlot > 0 && posKontur > 0 && posVorschau > 0 && posAbstaende > 0, "alle vier Anker gefunden");
assert.ok(posMarkerPlot < posKontur, "die Konturbreite steht NACH dem Marker-Plot");
assert.ok(posKontur < posVorschau, "und VOR der Vorschau");
assert.ok(posVorschau < posAbstaende, "der Abschnitt „Abstände\" bleibt darunter -- sie ist nicht dorthin gewandert");

// ---- 3. Der Schluessel haengt in derselben Mechanik wie die Abstaende ----------------------------
// Laden, Speichern, Zuruecksetzen und Zaehlen laufen ueber ZOOM_BAND_SPACING_KEYS -- der Abschnitt
// `abstaende` ist in Wahrheit der Eimer fuer alle GLOBALEN Einzelwerte.
assert.ok(/const ZOOM_BAND_SPACING_KEYS = \["spalt", "repel", "versatz", "drift", "kontur"\];/.test(seite),
	"„kontur\" steht in ZOOM_BAND_SPACING_KEYS -- damit reist er in derselben Nutzlast wie alles andere");
assert.ok(/kontur: \{ range: \$\("zbKonturRange"\), input: \$\("zbKonturInput"\), reset: \$\("zbKonturReset"\)/.test(seite),
	"und ist in zoomBandSpacingEls mit seinen drei Elementen verdrahtet");
assert.ok(!/abstaende\.php|kontur\.php/.test(seite), "kein zweiter, eigener Endpunkt fuer die Konturbreite");

// ---- 4. 💣 DIE EINHEIT IST PROZENT, UND DAS MUSS BIS IN DEN RUECKSETZER-TITEL DURCH ---------------
// „Konturbreite auf Vorgabe (33 px) zuruecksetzen" waere lautlos falsch: 33 px ist eine plausible
// Zahl, niemand stutzt, und der Admin haelt die Kontur fuer einen Pixelwert.
assert.ok(/const ZOOM_BAND_SPACING_UNIT = \{ kontur: "%" \};/.test(seite),
	"die Einheit haengt am Schluessel, nicht am Markup");
assert.ok(/auf Vorgabe \(\$\{zoomBandSpacingDefault\(key\)\} \$\{zoomBandSpacingUnit\(key\)\}\)/.test(seite),
	"der Ruecksetzer-Titel liest sie, statt „px\" festzuschreiben");
assert.ok(/<span class="zb-selected__unit">%<\/span>/.test(seite), "und die Zeile selbst zeigt ein Prozentzeichen");

// ---- 5. 🔴 BEIDE VORSCHAUEN RECHNEN NICHT SELBST -------------------------------------------------
// avesmapsLocationMarkerContourSplit ist derselbe Rechner, den der Kartenzeichner ruft. Eine
// Abschrift liefe beim ersten Eingriff auseinander -- und eine Vorschau, die etwas anderes zeigt als
// die Karte, ist schlimmer als keine.
assert.ok(/function avesmapsLocationMarkerContourSplit\(aussenDurchmesser, anteil\)/.test(vorgabetafel),
	"die Aufteilung Kern/Kontur steht in der Vorgabetafel");
assert.ok(/avesmapsLocationMarkerContourSplit\(/.test(zeichner),
	"der Kartenzeichner ruft sie");
assert.ok(/avesmapsLocationMarkerContourSplit\(aussenDurchmesser, anteil\)\.kontur/.test(seite),
	"und das Fenster ruft dieselbe Funktion, statt die Formel abzuschreiben");
// Keine zweite Formel im Fenster: weder der Nenner (1 + Anteil) noch der 0,5-px-Boden stehen dort.
assert.ok(!/\/ 2 \/ \(1 \+/.test(seite), "das Fenster fuehrt keinen eigenen Kern-Nenner");
assert.ok(!/Math\.max\(0\.5,/.test(seite), "und keinen eigenen Kontur-Boden");

// Beide Vorschauen setzen ihre Variable.
assert.ok(/setProperty\("--zb-kontur"/.test(seite), "die Kartenvorschau setzt --zb-kontur je Karte");
assert.ok(/setProperty\("--zbv-kontur"/.test(seite), "die Buehne unten setzt --zbv-kontur je Punkt");
assert.ok(/if \(key === "spalt" \|\| key === "kontur"\) \{ updateZoomBandPreview\(\); \}/.test(seite),
	"eine Reglerbewegung zeichnet die Kartenvorschau neu");

// ---- 6. 💣 DIE KONTUR WAECHST NACH INNEN ---------------------------------------------------------
// Der Aussendurchmesser aus dem Plot bleibt der Chef (Owner-Regel). Ohne box-sizing waere der Punkt
// in der Vorschau um zweimal die Konturbreite groesser, und der Regler verstellte scheinbar die
// Groesse, die einen Absatz darueber eingestellt wird.
const dotRegel = seite.match(/\.zb-dot \{[^}]*\}/);
assert.ok(dotRegel, ".zb-dot ist definiert");
assert.ok(/box-sizing:border-box/.test(dotRegel[0]), ".zb-dot waechst nach innen (box-sizing:border-box)");
assert.ok(/border:var\(--zb-kontur, 0px\) solid var\(--color-marker-settlement-contour\)/.test(dotRegel[0]),
	".zb-dot traegt die weisse Kontur aus dem Token");
assert.ok(/background:var\(--color-marker-settlement\)/.test(dotRegel[0]),
	".zb-dot traegt den roten Kern aus dem Token");
const zbvRegel = seite.match(/\.zbv-dot \{[^}]*\}/);
assert.ok(zbvRegel && /box-sizing:border-box/.test(zbvRegel[0]) && /--zbv-kontur/.test(zbvRegel[0]),
	".zbv-dot ebenso -- die Buehne rechnet ihre Namensstellung aus dem Aussendurchmesser");

// ---- 7. Die Zaehlzeile nennt die Kontur BEIM NAMEN, nicht als Abstand ----------------------------
// 💣 Mitgezaehlt laese die Zeile „1 Abstand weicht ab", waehrend in Wahrheit die Markerkontur
// verstellt ist -- der Admin suchte den Unterschied dann im falschen Abschnitt des Fensters.
assert.ok(/if \(key === "kontur"\) \{ konturChanged = true; return; \}/.test(seite),
	"„kontur\" faellt aus der Abstands-Zaehlung heraus");
assert.ok(/if \(konturChanged\) \{ parts\.push\("die Konturbreite"\); \}/.test(seite),
	"und bekommt ihren eigenen Satzteil");
assert.ok(/const total = curveChanged \+ spacingChanged \+ \(konturChanged \? 1 : 0\);/.test(seite),
	"und zaehlt fuer „weicht\"/„weichen\" mit -- sonst steht dort die Einzahl bei zwei Abweichungen");

console.log("marker-konturbreite-dialog: alle Zusicherungen erfuellt");
