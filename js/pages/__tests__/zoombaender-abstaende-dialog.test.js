const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Aufgabe 8b: die drei globalen Abstandsregler (Spalt, Repel, Versatz) im Fenster „Zoombänder".
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md
//
// 💣 WARUM DAS EINEN EIGENEN TEST BRAUCHT (wie zoombaender-dialog.test.js für Aufgabe 8): das
// Fenster, der Endpunkt und die drei "Leser" (map-features.js, map-features-location-name-labels.js,
// map-features-label-collisions.js) sprechen über eine JSON-Nutzlast bzw. einen Bezeichnernamen
// miteinander, und keins davon hat eine Signatur. Läuft ein Name auseinander, passiert NICHTS
// Sichtbares -- der Wert wird gespeichert/gelesen, aber ignoriert.
//
// ⭐ Der Test liest die betroffenen Dateien als TEXT, wie sein Vorbild.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/zoombaender-abstaende-dialog.test.js

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const seite = read("html/wiki-sync-settlement-editor.html");
const bibliothek = read("api/_internal/app/zoom-bands.php");
const vorgabetafel = read("js/map-features/location-zoom-bands.js");
const mapFeatures = read("js/map-features/map-features.js");
const nameLabels = read("js/map-features/map-features-location-name-labels.js");
const collisions = read("js/map-features/map-features-label-collisions.js");
const platzierung = read("js/map-features/label-placement.js");

// ---- 1. Die Regler stehen im Markup, mit den geforderten Schranken -----------------------------
// ⚠️ NUR die drei ENGEN (0-20). „Drift" kam am 22.08.2026 dazu und traegt eine eigene, weitere
// Schranke (0-300, ganze Pixel) -- er wird unten eigens geprueft, nicht in diese Schleife gezwungen.
["Gap", "Repel", "Shift"].forEach((suffix) => {
	const rangeTag = seite.match(new RegExp(`<input[^>]*id="zb${suffix}Range"[^>]*>`));
	assert.ok(rangeTag, `der Regler zb${suffix}Range steht im Markup`);
	assert.ok(/type="range"/.test(rangeTag[0]), `zb${suffix}Range ist ein <input type="range">`);
	// ⚠️ Grenzen 0 bis 20, Schrittweite 0,5 -- Aufgabenstellung, wörtlich.
	assert.ok(/min="0"/.test(rangeTag[0]) && /max="20"/.test(rangeTag[0]) && /step="0\.5"/.test(rangeTag[0]),
		`zb${suffix}Range traegt min=0, max=20, step=0.5`);
	const inputTag = seite.match(new RegExp(`<input[^>]*id="zb${suffix}Input"[^>]*>`));
	assert.ok(inputTag, `das Zahlenfeld zb${suffix}Input steht im Markup`);
	assert.ok(/min="0"/.test(inputTag[0]) && /max="20"/.test(inputTag[0]) && /step="0\.5"/.test(inputTag[0]),
		`zb${suffix}Input traegt dieselben Schranken`);
	assert.ok(new RegExp(`id="zb${suffix}Reset"`).test(seite), `der Ruecksetzer zb${suffix}Reset steht im Markup`);
});

// Die Ueberschrift "Abstände" und ihr Hinweis, dass es GLOBALE Werte sind (kein Plot).
assert.ok(/<h3>Abstände<\/h3>/.test(seite), "der Abschnitt heisst „Abstände\"");
assert.ok(/global — ein Wert für alle Ortsklassen und Zoomstufen/.test(seite),
	"und sagt, dass es GLOBALE Werte sind -- kein Wert je Ortsklasse/Zoomstufe");

// ---- 2. Die Nutzlast traegt "abstaende" mit, in DERSELBEN Sendung wie marker/label ---------------
assert.ok(/function zoomBandsToPayload\(state\)/.test(seite), "zoomBandsToPayload baut weiterhin die GANZE Tafel");
assert.ok(/payload\.abstaende\s*=\s*\{\}/.test(seite), "und ergaenzt sie um die drei Abstaende");
assert.ok(/ZOOM_BAND_SPACING_KEYS\.forEach\(\(key\) => \{\s*payload\.abstaende\[key\]/.test(seite),
	"alle drei Schluessel wandern in dieselbe Nutzlast wie marker/label");
// 🔴 EIN Speicher, EIN Endpunkt, EIN Speichern-Knopf (Aufgabenstellung) -- kein zweiter POST-Aufruf
// nur fuer die Abstaende.
assert.strictEqual((seite.match(/ZOOM_BANDS_API/g) || []).length >= 1, true, "es gibt weiterhin nur den einen Endpunkt-Namen");
assert.ok(!/abstaende\.php/.test(seite), "kein zweiter, eigener Endpunkt fuer die Abstaende");

// ---- 3. Der Server prueft den Abschnitt, akzeptiert ihn aber auch, wenn er FEHLT -----------------
// 🔴 Der Server fuehrt EINE Schranke fuer alle Abstaende, und sie ist die WEITESTE der im Browser
// gefuehrten (seit 22.08.2026 die des Drift-Deckels, 300). Er prueft die FORM, der Browser die
// BEDEUTUNG und klemmt jeden Schluessel gegen seine eigene, engere Schranke.
assert.ok(/AVESMAPS_ZOOM_BANDS_SPACING_LIMITS\s*=\s*\[0\.0, 300\.0\]/.test(bibliothek),
	"der Server laesst die weiteste der Browser-Schranken durch (0 bis 300)");
assert.ok(/array_key_exists\('abstaende', \$incoming\)/.test(bibliothek),
	"ein FEHLENDER Abschnitt ist gueltig -- rueckwaertskompatibel zu vor Aufgabe 8b gespeicherten Tafeln");
assert.ok(/\$clean\['abstaende'\]\s*=\s*\$cleanAbstaende/.test(bibliothek),
	"ein VORHANDENER, wohlgeformter Abschnitt wird uebernommen");

// ---- 4. Die Vorgabewerte stehen an EINER Stelle -- gelesen, nicht in der Seite abgeschrieben -----
assert.ok(/abstaende:\s*\{\s*spalt:\s*4,\s*repel:\s*2,\s*versatz:\s*8,\s*drift:\s*300\s*\}/.test(vorgabetafel),
	"die Vorgabewerte (4/2/8, die heutigen Konstanten, plus der Drift-Deckel) stehen in der Vorgabetafel");
assert.ok(!/spalt:\s*4/.test(seite) && !/versatz:\s*8/.test(seite),
	"und die Seite schreibt sie nicht ab");
assert.ok(/AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS\.abstaende\[key\]/.test(seite),
	"die Seite liest die Vorgabe (fuer Ruecksetzer-Titel und Rueckfall), statt Zahlen zu fuehren");

// ---- 5. Die drei echten Leser rufen den Zugriff, nicht die alte Konstante ------------------------
// 🔴 Der Kern der Aufgabe: LOCATION_NAME_LABEL_GAP/LOCATION_LABEL_SHIFT_SMALL sind als LITERALE
// Konstanten verschwunden -- die einzige Quelle ist jetzt location-zoom-bands.js.
assert.ok(!/const LOCATION_NAME_LABEL_GAP\s*=/.test(nameLabels),
	"LOCATION_NAME_LABEL_GAP existiert nicht mehr als eigene Konstante");
assert.ok(!/const LOCATION_LABEL_SHIFT_SMALL\s*=/.test(mapFeatures),
	"LOCATION_LABEL_SHIFT_SMALL existiert nicht mehr als eigene Konstante");
// 🔴 22.08.2026 -- Spalt- und Versatz-Leser sind nach js/map-features/label-placement.js
// umgezogen (rein, ohne DOM), damit das Vorschaupanel im Fenster DIESELBE Rechnung ruft wie die
// Karte. Sie lesen weiterhin die Regler, nur ueber avesmapsLabelSpacingOf -- das eine Zeile weiter
// auf avesmapsLocationLabelSpacing faellt, wenn keine Uebersteuerung mitkommt.
assert.ok(/x:\s*Math\.round\(markerAussenradius \+ avesmapsLabelSpacingOf\(abstaende, "spalt"\)\)/.test(platzierung),
	"avesmapsLabelBaseOffset (der Spalt-Leser) liest den Regler");
assert.ok(/return avesmapsLabelBaseOffset\(markerOuterRadius, labelHeightInPixels\)/.test(nameLabels),
	"und die Karte ruft ihn, statt die Formel abzuschreiben");
assert.ok(/const smallShift = avesmapsLabelSpacingOf\(abstaende, "versatz"\)/.test(platzierung),
	"der Versatz-Leser (smallShift, zehn von zwoelf Ausweichstellen) liest den Regler");
assert.ok(/return avesmapsLocationLabelSpacing\(key\);/.test(platzierung),
	"ohne Uebersteuerung gilt der angewandte Stand -- die Karte ruft genau so");
assert.ok(/function measureLabelCollisionRect\(element, padding = avesmapsLocationLabelSpacing\("repel"\)\)/.test(collisions),
	"der Repel-Leser (measureLabelCollisionRect) ruft avesmapsLocationLabelSpacing(\"repel\") als Vorgabewert");

// ---- 5b. Die EXPLIZIT AUSGENOMMENE Fundstelle bleibt UNVERAENDERT (Regionen-Labels) --------------
// 💣 Diese Zeile ist der Rueckfall fuer REGIONEN-Labels und feuert nie (REGION_LABEL_COLLISION_PADDING
// ist immer definiert) -- Regionen-Labels haben ihren eigenen Wert und gehoeren nicht zu dieser
// Aufgabe. Der Test verankert das ausdruecklich, damit ein spaeterer Umbau sie nicht "aus Versehen"
// mitzieht UND damit ein Leser sieht, dass das Auslassen geprueft, nicht vergessen wurde.
assert.ok(
	/const regionPadding = typeof REGION_LABEL_COLLISION_PADDING !== "undefined" \? REGION_LABEL_COLLISION_PADDING : LOCATION_LABEL_COLLISION_PADDING;/.test(collisions),
	"der Regionen-Ruecksetzer bleibt woertlich unveraendert -- er gehoert nicht zur Ortsbeschriftung"
);
// Der Bezeichner LOCATION_LABEL_COLLISION_PADDING existiert deshalb weiterhin -- als abgeleiteter
// Wert (keine zweite Zahl), nicht als eigenes Literal.
assert.ok(/const LOCATION_LABEL_COLLISION_PADDING = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS\.abstaende\.repel;/.test(mapFeatures),
	"LOCATION_LABEL_COLLISION_PADDING bleibt bestehen, aber ABGELEITET aus der Vorgabetafel -- keine zweite Zahl");

// ---- 6. Eine Änderung am Spalt zeichnet die Labels neu ---------------------------------------------
// bumpLocationNameLabelStyleRevision() wird vom Boot-Leser in js/config.js bereits gerufen, sobald
// avesmapsApplyLocationZoomBands "true" meldet (siehe js/config.js) -- das setzt voraus, dass eine
// Uebersteuerung der Abstaende ueberhaupt als "changed" erkannt wird. Diese Zusicherung haelt die
// Kopplungsstelle im Boot-Leser fest, DAMIT sie nicht versehentlich entkoppelt wird.
const configJs = read("js/config.js");
assert.ok(/avesmapsLoadLocationZoomBands\(\)\.then\(function \(changed\) \{/.test(configJs),
	"der Boot-Leser haengt am 'changed'-Rueckgabewert von avesmapsApplyLocationZoomBands");
assert.ok(/bumpLocationNameLabelStyleRevision\(\)/.test(configJs),
	"und zaehlt bei einer Aenderung die Stil-Revision hoch -- sonst ueberspringt der setIcon-Guard das Neuzeichnen");

// ---- 7. Die Speicherleisten-Meldung zaehlt Abstaende getrennt, mit korrektem Plural --------------
assert.ok(/zoomBandSpacingEqualsDefault\(key\)/.test(seite), "die Meldung prueft jeden Abstand gegen seine Vorgabe");
assert.ok(/spacingChanged === 1 \? "Abstand" : "Abstände"/.test(seite),
	"der Plural traegt den Umlaut (Abstände), kein blosses '+e'");

console.log("zoombaender-abstaende-dialog: alle Zusicherungen erfuellt");
