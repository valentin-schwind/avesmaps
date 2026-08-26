const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 DIE SIEDLUNGS- UND LANDSCHAFTSNAMEN BLENDEN AB `zoomanim` t = 0 AUS.
// Owner 26.08.2026, woertlich: „koennen wir die stadtlabels nicht ausblenden im moment wo der zoom
// beginnt (nicht erst danach)" -- und davor: „elemente die ausblenden ... sollen bei zoomanim t = 0
// beginnen auszublenden".
//
// ⚠️ NUR DAS AUSBLENDEN. Das EINblenden der neuen Namen kann NICHT mitwandern, und der Grund ist
// derselbe, an dem am 26.08.2026 die Marker-Gegenrechnung gescheitert ist: Leaflet setzt seinen
// internen Zustand direkt nach dem zoomanim-Ereignis auf die Zielstufe
// (docs/kartenflaechen-und-zoomblenden.md §8a). Ein Leaflet-Marker setzt beim `setIcon` seine
// Position ueber genau diese Projektion neu -- waehrend das Pane die Quelle-auf-Ziel-Transform
// seines Elternteils traegt. Die neuen Namen wuerden doppelt transformiert. Dafuer braeuchte es ein
// ZWEITES, gegengerechnetes Pane; das ist ein Umbau und nicht Teil dieser Aenderung.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/labelpane-parallelblende.test.js

const roh = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster
// warnt, und der naechste Leser loescht den Kommentar, um ihn gruen zu bekommen.
const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Den Block der Pane-Ueberblendung herausschneiden -- alles Folgende gilt nur ihm.
const start = quelle.indexOf("function ueberblendungDerLabelPane()");
assert.ok(start > 0, "Der Block ueberblendungDerLabelPane wurde nicht gefunden -- umbenannt?");
// 🪤 Bis zum Ende der IIFE schneiden -- nicht bis zum naechsten beliebigen `})();`, davon gibt es
// in dieser Datei viele. Der Block endet an der Zeile, die die Funktion schliesst und aufruft.
const ende = quelle.indexOf("\n})();", start);
assert.ok(ende > start, "Das Ende des Blocks ueberblendungDerLabelPane wurde nicht gefunden.");
const block = quelle.slice(start, ende);

// ---- Der zoomanim-Handler blendet den Klon aus, statt ihn stehen zu lassen ---------------------
const zoomanimStart = block.indexOf('map.on("zoomanim"');
const zoomendStart = block.indexOf('map.on("zoomend"');
assert.ok(zoomanimStart > 0 && zoomendStart > zoomanimStart,
	"zoomanim- und zoomend-Handler nicht in erwarteter Reihenfolge gefunden.");
const zoomanimBlock = block.slice(zoomanimStart, zoomendStart);

assert.ok(/klon\.style\.opacity\s*=\s*"0"/.test(zoomanimBlock),
	"🔴 Der Klon wird im zoomanim NICHT ausgeblendet -- die Namen bleiben waehrend des ganzen Zooms "
	+ "stehen und wechseln erst danach. Genau das hat der Owner am 26.08.2026 beanstandet.");
assert.ok(/AVESMAPS_ZOOM_KURVE/.test(zoomanimBlock) && /AUSBLENDEN_MS|AVESMAPS_ZOOM_DAUER_MS/.test(zoomanimBlock),
	"Die Ausblendung laeuft nicht auf der gemeinsamen Kurve und Dauer.");

// 💣 Ohne erzwungenen Zwischenstand gibt es KEINEN Uebergang: der Browser fasst „opacity 1" und
// „opacity 0" im selben Tick zusammen und der Klon verschwindet hart.
assert.ok(/offsetWidth|requestAnimationFrame/.test(zoomanimBlock),
	"💣 Zwischen `opacity = 1` und `opacity = 0` wird kein Zwischenstand erzwungen -- der Browser "
	+ "fasst beides zusammen, und der Klon verschwindet hart statt auszublenden.");

// ---- Die eigene 350 ist weg; alles liest die gemeinsame Quelle ---------------------------------
assert.ok(!/const\s+DAUER_MS\s*=\s*350/.test(block),
	"Die eigene 350 steht noch da -- sie war die letzte Blendendauer ohne Anschluss an die "
	+ "gemeinsame Kurve (docs/kartenflaechen-und-zoomblenden.md §7).");
assert.ok(/AVESMAPS_ZOOM_DAUER_MS/.test(block), "Der Block liest die gemeinsame Dauer nicht.");

// 💣 Die Konstanten stehen in js/map-features/zoom-uebergang.js und werden NICHT gehoistet --
// das Skript muss VOR bootstrap.js geladen werden, sonst steht dort undefined.
const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
assert.ok(html.indexOf("js/map-features/zoom-uebergang.js") < html.indexOf("js/app/bootstrap.js"),
	"💣 zoom-uebergang.js wird nach bootstrap.js geladen -- der Klon bekaeme 'opacity undefinedms'.");

// ---- Was NICHT verlorengehen darf --------------------------------------------------------------
// 🔴 DAS ECHTE PANE MUSS HART AUF 0, NICHT UEBERBLENDET -- die Ursache der doppelten Schrift
// vom 26.08.2026, vom Owner per Messprotokoll belegt:
//     0 ms | Klon 1.00 | Pane 1.00   <-- BEIDE SICHTBAR
//   740 ms | Klon 0.96 | Pane 0.96   <-- BEIDE SICHTBAR
// Beide blendeten im Gleichschritt, beide mit den ALTEN Namen -- der Klon auf den Quell-, das
// Pane auf den Zielpositionen (Leaflet setzt seine Marker im zoomanim um, §8a). Daher „eines
// stabil, eines driftet".
// 💣 DIE FALLE: `style.transition = ""` heisst NICHT „kein Uebergang", sondern „nimm wieder die
// CSS-Regel". Und die stand seit der Vereinheitlichung auf der vollen Zoomdauer -- vorher auf
// 100 ms, weshalb es jahrelang niemand sah. Nur `transition = "none"` plus erzwungener
// Zwischenstand setzt wirklich hart.
assert.ok(/pane\.style\.transition = "none";[\s\S]{0,120}?pane\.style\.opacity = "0"/.test(quelle),
	"💣 Das echte Pane wird nicht HART auf 0 gesetzt. Mit `transition = \"\"` uebernimmt die "
	+ "CSS-Regel, und die laeuft ueber die volle Zoomdauer -- Pane und Klon blenden dann im "
	+ "Gleichschritt und zeigen dieselben Namen an zwei Stellen.");
assert.ok(/void pane\.offsetWidth/.test(quelle),
	"💣 Ohne erzwungenen Zwischenstand wirkt `transition: none` nicht -- der Browser fasst das "
	+ "Setzen und die Ruecknahme zusammen.");

// ⚠️ Und das Sicherheitsnetz muss mit der Zoomdauer wachsen: mit ?zoomlupe feuerte es mitten in
// die laufende Bewegung und machte das Pane sichtbar, waehrend der Klon noch da war.
assert.ok(/AVESMAPS_ZOOM_DAUER_MS \+ 1750/.test(quelle),
	"⚠️ Das Sicherheitsnetz haengt an einer festen Zahl statt an der Zoomdauer -- unter der "
	+ "Zeitlupe feuert es mitten in die Bewegung.");

// 💣 Das harte Netz: feuert requestAnimationFrame nie, stuende der Klon fuer immer -- und auf der
// Karte stuende doppelte Schrift.
assert.ok(/setTimeout\([\s\S]{0,220}?AVESMAPS_ZOOM_DAUER_MS \+ 1750\)/.test(block),
	"💣 Das Netz gegen den haengenden Klon fehlt. Es ergibt bei Vorgabedauer weiterhin 2000 ms, "
	+ "waechst aber jetzt mit -- unter ?zoomlupe feuerte eine feste 2000 mitten in die Bewegung.");
// 💣 Immer nur EIN Klon -- zwei uebereinander waeren doppelte Schrift.
assert.ok(block.indexOf("klonWeg()") < block.indexOf("cloneNode"),
	"💣 Der zoomanim raeumt den vorigen Klon nicht zuerst weg.");
// 🔴 Der Klon verliert die Pane-Klasse, sonst griffe die CSS-Blende auch auf ihm.
assert.ok(/classList\.remove\("map-labels-pane"\)/.test(block),
	"🔴 Der Klon behaelt die Pane-Klasse -- dann greift die CSS-Blende doppelt.");

// ---- Notausgang --------------------------------------------------------------------------------
assert.ok(/labelparallel/.test(roh),
	"⭐ ?labelparallel=0 fehlt -- ohne Weg zurueck laesst sich die Aenderung nicht vergleichen und "
	+ "ein Fehlgriff nicht ohne Deploy abstellen.");
assert.ok(/AUSBLENDEN_AB_ZOOMSTART/.test(zoomanimBlock),
	"💣 Der Schalter ist definiert, aber der zoomanim-Handler fragt ihn nicht -- ein Notausgang, "
	+ "den niemand liest, ist keiner.");

console.log("labelpane-parallelblende.test.js: alle Zusicherungen erfuellt");
