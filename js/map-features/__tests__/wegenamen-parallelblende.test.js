const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 SCHRITT 4: die Wege- und Flussnamen wechseln WAEHREND des Zooms, wie die Grenznamen seit
// 29ced4aa. Gestaffelt, nicht ueberlappend -- alt raus in der ersten Haelfte, neu rein in der
// zweiten, beides innerhalb der Zoomdauer (Begruendung: docs/kartenflaechen-und-zoomblenden.md §5a,
// die doppelten Beschriftungen vom 26.08.2026).
//
// 💣 DER UNTERSCHIED ZU DEN GRENZNAMEN, UND ER IST DER GANZE AUFWAND: dort gab es EINE Projektion.
// Hier sind es VIER, verteilt ueber zwei Funktionen (berechneKurvenlabels und redraw), plus ein
// ZWISCHENSPEICHER, der die fertigen Kurvenlabels unter einem Ansichts-Stempel ablegt. Wer eine
// Projektion uebersieht, bekommt die Haelfte der Namen auf der alten und die Haelfte auf der neuen
// Stufe -- und das sieht aus wie ein Kollisionsfehler, nicht wie ein halber Umbau. Wer den Stempel
// vergisst, legt Ziel-Inhalt unter Quell-Stempel ab und vergiftet die naechste Ansicht.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wegenamen-parallelblende.test.js

const roh = fs.readFileSync(
	path.join(__dirname, "../map-features-path-label-canvas-overlay.js"), "utf8");
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt.
const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ---- ALLE Projektionsstellen gehen ueber die gemeinsame Weiche --------------------------------
// 🔴 Gezaehlt, nicht gesucht: `map.latLngToContainerPoint` darf im Zeichenpfad nur noch EINMAL
// vorkommen -- in der Weiche selbst. Jede weitere Fundstelle ist eine uebersehene Projektion.
{
	const treffer = (quelle.match(/map\.latLngToContainerPoint\(/g) || []).length;
	assert.strictEqual(treffer, 1,
		"💣 `map.latLngToContainerPoint` steht " + treffer + "-mal im Zeichenpfad statt genau einmal "
		+ "(in der Weiche). Jede weitere Stelle zeichnet auf der ALTEN Stufe, waehrend die uebrigen "
		+ "schon auf der neuen sind -- das liest sich als Kollisionsfehler, nicht als halber Umbau.");
}
assert.ok(/function projiziere\(/.test(quelle) || /const projiziere = /.test(quelle),
	"Es gibt keine gemeinsame Projektions-Weiche.");
assert.ok(/avesmapsZoomZielProjektion\s*\(/.test(quelle),
	"💣 Die Zielprojektion aus zoom-uebergang.js wird nicht benutzt -- von Hand nachgebaut waere sie "
	+ "die zweite Wahrheit, die den Vorgaengerversuch gekostet hat.");

// ---- Der Ansichts-Stempel wandert mit ----------------------------------------------------------
assert.ok(/function kurvenlabelAnsichtsStempel\(\)[\s\S]{0,400}?zeichenZiel/.test(quelle),
	"💣 Der Ansichts-Stempel des Kurvenlabel-Zwischenspeichers liest weiterhin nur den AKTUELLEN "
	+ "Zustand. Beim Zeichnen fuer die Zielstufe landet Ziel-Inhalt unter Quell-Stempel -- der "
	+ "naechste Redraw haelt ihn fuer gueltig und malt Namen der falschen Stufe.");

// ---- 💣 Der fruehe Ausstieg muss das Vorabzeichnen DURCHLASSEN ---------------------------------
// `cssZoomActive` sperrt den Zeichner waehrend der Animation -- richtig fuer jeden gewoehnlichen
// Aufruf, falsch fuer das Vorabzeichnen: das PASSIERT waehrend der Animation und ist ihr Sinn.
// 🪤 Ohne die Ausnahme steigt Schritt 4 WORTLOS aus und die Flaeche bleibt leer -- ein Fehler, der
// wie „die Blende tut nichts" aussieht und nirgends eine Meldung hinterlaesst.
assert.ok(/\(cssZoomActive && !fuerZiel\)/.test(quelle),
	"💣 Der fruehe Ausstieg von redraw sperrt auch das Vorabzeichnen -- damit tut Schritt 4 gar "
	+ "nichts, und zwar lautlos.");

// ---- Ein vorab gezeichnetes Bild darf der redraw NICHT loeschen --------------------------------
assert.ok(/wegeLabelsVorabGezeichnet/.test(quelle),
	"💣 Ohne diese Wache loescht der redraw am zoomend das eben eingeblendete Bild.");

// ---- GESTAFFELT, nicht ueberlappend ------------------------------------------------------------
const zoomanimStart = quelle.indexOf('map.on("zoomanim"');
assert.ok(zoomanimStart > 0, "zoomanim-Handler nicht gefunden.");
const zoomanimBlock = quelle.slice(zoomanimStart, quelle.indexOf("map.on(", zoomanimStart + 10));
// 🪤 Und die Gegenrechnung muss IM zoomanim-Block aus der geteilten Funktion kommen -- nicht
// irgendwo in der Datei. Eine Mutationsprobe am 26.08.2026 fand genau diese Luecke: der Aufruf im
// redraw-Umschlag liess die Zusicherung gruen, waehrend der zoomanim-Block eine handgeschriebene
// Fassung benutzte.
assert.ok(/avesmapsZoomVorabFlaeche\(map, event\.zoom, event\.center\)/.test(zoomanimBlock),
	"💣 Die Gegenrechnung im zoomanim ist von Hand geschrieben statt aus zoom-uebergang.js geholt. "
	+ "Genau daran ist der Vorgaengerversuch ed1e2e93 gescheitert.");
assert.ok(/AUSBLENDEN_MS/.test(zoomanimBlock) && /EINBLENDEN_MS/.test(zoomanimBlock),
	"🔴 Es gibt keine Staffelung -- alt und neu liefen gleichzeitig, und das ist die doppelte "
	+ "Beschriftung vom 26.08.2026.");
assert.ok(/EINBLENDEN_MS \+ "ms " \+ AVESMAPS_ZOOM_KURVE \+ " " \+ AUSBLENDEN_MS \+ "ms"/.test(zoomanimBlock),
	"🔴 Die einblendende Flaeche startet ohne Verzug -- damit ueberlappt sie mit der ausblendenden. "
	+ "Beide Uebergaenge muessen im SELBEN Augenblick gesetzt und nur durch transition-delay getrennt "
	+ "sein, sonst geht die Staffelung bei verspaetetem Stilabgleich verloren.");

// ---- 🔴 DIE REGRESSION, DIE ZWEIMAL BEZAHLT WURDE ----------------------------------------------
const moveendStart = quelle.indexOf('map.on("moveend zoomend viewreset resize"');
assert.ok(moveendStart > 0, "Der moveend-Handler wurde nicht gefunden.");
assert.ok(/transition\s*=\s*""/.test(quelle.slice(moveendStart, moveendStart + 600)),
	"💣 Der moveend-Handler loescht die Transform-Transition nicht -- danach animiert JEDER Pan die "
	+ "Position nach (Owner 24.08.2026: die Flaechen ziehen beim Pannen doppelt nach).");

// ---- Notausgang --------------------------------------------------------------------------------
assert.ok(/PARALLELBLENDE_AN/.test(quelle) && /parallelfade/.test(roh),
	"⭐ ?parallelfade=0 muss den Stand von vorher herstellen.");

console.log("wegenamen-parallelblende.test.js: alle Zusicherungen erfuellt");
