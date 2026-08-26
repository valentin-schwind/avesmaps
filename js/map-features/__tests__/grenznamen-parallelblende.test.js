const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 SCHRITT 3: die Grenzbeschriftungen wechseln WAEHREND des Zooms, nicht danach.
// Owner 26.08.2026: „das bei allen beschriftungen wenns geht!" -- das Ausblenden ab t = 0 steht
// seit 53d0bb79; hier kommt die andere Haelfte dazu: die NEUE Schrift wird schon im `zoomanim` fuer
// die Zielstufe gezeichnet und kommt noch waehrend der Bewegung herein.
//
// 🔴 UND SIE KOMMT GESTAFFELT, NICHT UEBERLAPPEND. Der Bauplan sah eine echte Ueberblendung vor --
// alt und neu gleichzeitig. Genau das hat am 26.08.2026 die doppelten Beschriftungen erzeugt
// (Owner per Aufzeichnung: „AVENTURIEN" zweimal, senkrecht versetzt), denn zwischen zwei Zoomstufen
// hat sich die Lage jeder Beschriftung verschoben. Also: erst raus, dann rein -- beides INNERHALB
// der 250 ms. Siehe docs/kartenflaechen-und-zoomblenden.md §5a.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/grenznamen-parallelblende.test.js

const roh = fs.readFileSync(
	path.join(__dirname, "../map-features-boundary-canvas-overlay.js"), "utf8");
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt.
const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ---- Fuer die Zielstufe zeichnen ---------------------------------------------------------------
assert.ok(/function\s+drawTerritoryBorderLabels\s*\(\s*ctx\s*,\s*zielZoom\s*,\s*zielCenter\s*\)/.test(quelle),
	"drawTerritoryBorderLabels nimmt die Zielstufe nicht entgegen -- ohne sie kann im zoomanim kein "
	+ "neues Bild entstehen.");
assert.ok(/avesmapsZoomZielProjektion\s*\(/.test(quelle),
	"💣 Die Zielprojektion wird nicht benutzt. `latLngToContainerPoint` liest IMMER den aktuellen "
	+ "Stand -- fuer die Zielstufe muss von Hand projiziert werden.");
// 🔴 Und ALLE Pro-Zoom-Werte muessen die Zeichenstufe lesen, nicht map.getZoom(). Sonst haetten die
// neuen Namen die Schriftgroesse der alten Stufe.
assert.ok(!/getTerritoryLabelFontSize\(map\.getZoom\(\)\)/.test(quelle)
	&& !/getTerritoryLabelOffset\(map\.getZoom\(\)\)/.test(quelle)
	&& !/getTerritoryLabelDetail\(map\.getZoom\(\)\)/.test(quelle),
	"💣 Ein Pro-Zoom-Wert liest noch map.getZoom() statt der Zeichenstufe -- die neuen Namen kaemen "
	+ "in der Groesse der ALTEN Stufe herein.");

// ---- Die Gegenrechnung kommt aus der geteilten, getesteten Funktion ----------------------------
assert.ok(/avesmapsZoomVorabFlaeche\s*\(/.test(quelle),
	"💣 Die Gegenrechnung ist von Hand geschrieben statt aus zoom-uebergang.js geholt. Genau daran "
	+ "ist der Vorgaengerversuch ed1e2e93 gescheitert.");

// ---- Ein vorab gezeichnetes Bild darf der redraw NICHT loeschen --------------------------------
assert.ok(/labelsVorabGezeichnet/.test(quelle),
	"💣 Ohne diese Wache loescht der redraw am zoomend das eben eingeblendete Bild -- die Flaeche "
	+ "waere genau dann leer, wenn alles fertig aussieht.");
// 💣 UND grenzLabelsGezeichnet DARF DANN NICHT ZURUECKGESETZT WERDEN: die Flagge steht aus dem
// zoomanim und sagt bereits die Wahrheit. Blind auf false gezogen liesse blendeNachZeichnung() die
// eben eingeblendete Schrift sofort wieder auf 0 gehen -- ein Aufblitzen im Moment des Fertigwerdens.
assert.ok(/if \(!labelsSchonDa\) \{ grenzLabelsGezeichnet = false; \}/.test(quelle),
	"💣 grenzLabelsGezeichnet wird auch dann zurueckgesetzt, wenn vorab gezeichnet wurde.");

// ---- GESTAFFELT, nicht ueberlappend ------------------------------------------------------------
assert.ok(/AUSBLENDEN_ANTEIL/.test(quelle),
	"🔴 Es gibt keine Staffelung -- alt und neu liefen gleichzeitig, und das ist die doppelte "
	+ "Beschriftung, die am 26.08.2026 beanstandet wurde.");
assert.ok(/transition-delay|VORAB_EIN_VERZUG|ms " \+ AVESMAPS_ZOOM_KURVE \+ " "/.test(quelle),
	"🔴 Die einblendende Flaeche startet ohne Verzug -- damit ueberlappt sie mit der ausblendenden.");

// ---- 🔴 DIE REGRESSION, DIE ZWEIMAL BEZAHLT WURDE ----------------------------------------------
// Eine inline gesetzte Transform-Transition ueberlebt den Zoom, und L.DomUtil.setPosition verschiebt
// per transform -- danach animiert JEDER Pan die Position nach (Owner 24.08.2026: „wenn ich mit der
// maus panne, ziehen die 2x nach", e85b31d1 und noch einmal im Parallel-Versuch ed1e2e93).
const moveendStart = quelle.indexOf('map.on("moveend zoomend viewreset resize"');
assert.ok(moveendStart > 0, "Der moveend-Handler wurde nicht gefunden.");
const moveendBlock = quelle.slice(moveendStart, moveendStart + 500);
assert.ok(/labelFlaechen\.forEach\([\s\S]{0,160}?transition\s*=\s*""/.test(moveendBlock),
	"💣 Der moveend-Handler loescht die Transform-Transition nicht auf BEIDEN "
	+ "Beschriftungsflaechen. Die eine, die gerade unsichtbar ist, wird beim naechsten Rollentausch "
	+ "die sichtbare -- und dann zieht jeder Pan nach.");

// ---- Keine zweite Dauer daneben ----------------------------------------------------------------
assert.ok(/AVESMAPS_ZOOM_DAUER_MS/.test(quelle), "Die Dauer kommt nicht aus der gemeinsamen Quelle.");
assert.ok(!/\b250\b/.test(quelle.replace(/AVESMAPS_ZOOM_DAUER_MS/g, "")),
	"Eine zweite, abgeschriebene 250 -- das ist der gekoppelte Wert, der auseinanderlaeuft.");

// ---- Notausgang --------------------------------------------------------------------------------
assert.ok(/parallelfade/.test(roh),
	"⭐ ?parallelfade=0 muss den Stand von vorher herstellen -- ohne Deploy vergleichbar.");
assert.ok(/PARALLELBLENDE_AN/.test(quelle),
	"💣 Der Schalter ist definiert, aber nicht abgefragt -- ein Notausgang, den niemand liest.");

console.log("grenznamen-parallelblende.test.js: alle Zusicherungen erfuellt");
