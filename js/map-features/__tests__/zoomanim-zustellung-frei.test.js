// Die zoomanim-Zustellung muss frei bleiben -- sonst laufen die Schichten auseinander.
//
// 💣 EINE CSS-TRANSITION BEGINNT NICHT, WENN MAN SIE SETZT, SONDERN BEIM NAECHSTEN STILABGLEICH.
// In EINER zoomanim-Zustellung setzen live 157 Zuhoerer ihre Transform: die Kacheln auf Platz 4,
// unsere Canvas-Flaechen auf 5-7, der SVG-Renderer mit STRASSEN UND FLUESSEN auf 9-11. Ein
// `void offsetWidth` mittendrin erzwingt einen Stilabgleich und startet damit die Uhr fuer alle,
// die vorher gesetzt haben -- alle danach gehen erst beim naechsten los. Dazu die reine
// Rechenzeit: gemessen 27.08.2026 blockierte das Vorabzeichnen die Zustellung 25-87 ms, ohne es
// 13,9 ms.
//
// Live gemeldet (Owner): „die strassen/flüsse ziehen manchmal kurz hinter" -- und danach, richtig
// beobachtet: „kann es sein dass die easing curves nicht ganz passen?"
// ⚠️ Die Kurven PASSTEN (an allen Flaechen nachgemessen: identisch). Ein Start-Versatz SIEHT unter
// ease-in-out nur so aus: der Abstand ist am Anfang null, in der Mitte am groessten und am Ende
// wieder null. Gerechnet mit avesmapsZoomEasing: 25 ms Versatz = 8,6 % der Zoomstrecke, 87 ms =
// 29,4 % -- bei einer LINEAREN Kurve waeren es konstante 5 % bzw. 17,4 %.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoomanim-zustellung-frei.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join("\n");
// ⚠️ Ohne Kommentare, sonst schlaegt der Test an der Warnung an, die vor der Falle warnt.
const ohneKommentare = (t) => t
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const quelle = ohneKommentare(lies("js/map-features/map-features-path-label-canvas-overlay.js"));
const zoomanim = quelle.slice(quelle.indexOf('map.on("zoomanim"'));
const mikroAb = zoomanim.indexOf("queueMicrotask(");
assert.notStrictEqual(mikroAb, -1,
	"💣 Das Vorabzeichnen laeuft wieder synchron in der zoomanim-Zustellung -- damit startet der "
	+ "SVG-Renderer (Strassen/Fluesse) spaeter als die Kacheln.");
const synchron = zoomanim.slice(0, mikroAb);
const verschoben = zoomanim.slice(mikroAb);

// --- Das TEURE gehoert hinaus ---------------------------------------------------------------------
assert.ok(/redraw\(event\.zoom, event\.center\)/.test(verschoben),
	"💣 Das Vorabzeichnen steht nicht im Microtask.");
assert.ok(!/redraw\(event\.zoom, event\.center\)/.test(synchron),
	"💣 Das Vorabzeichnen steht (auch) noch synchron in der Zustellung.");
assert.ok(!/offsetWidth/.test(synchron),
	"💣 Es wird wieder mitten in der Zustellung ein Stilabgleich erzwungen -- genau das startet die "
	+ "Uhr fuer die Kacheln und laesst die Strassen zurueck.");

// --- Das ZUSTANDSABHAENGIGE muss drinbleiben -------------------------------------------------------
// 🔴 Unmittelbar nach dem `fire` laeuft Leaflets `_move`: danach steht der interne Zustand schon am
// ZIEL, und die Quellstufe ist nicht mehr zu sehen. Wer diese drei mit hinausschiebt, rechnet die
// Gegenrechnung gegen die Zielstufe -- Start und Ende waeren gleich und es gaebe gar keine Bewegung.
for (const muss of ["avesmapsZoomVorabFlaeche(", "map.getZoomScale(", "_latLngToNewLayerPoint("]) {
	assert.ok(synchron.includes(muss),
		"🔴 `" + muss + "` ist aus der synchronen Haelfte verschwunden -- nach der Zustellung steht "
		+ "Leaflet schon am Ziel und der Wert waere falsch.");
	assert.ok(!verschoben.includes(muss),
		"🔴 `" + muss + "` steht im Microtask -- dort ist Leaflet schon am Ziel.");
}
// Der Rollentausch bleibt ebenfalls synchron: der naechste zeichneJetzt muss die richtige Flaeche finden.
assert.ok(/tauscheLabelFlaechen\(\);/.test(synchron),
	"Der Rollentausch gehoert in die synchrone Haelfte.");

// --- Der ZWEITE Stilabgleich ist tragend ------------------------------------------------------------
// 💣 Ohne ihn beginnt UNSER Uebergang erst im naechsten Bild, waehrend alle anderen beim ersten
// losgelaufen sind -- der Versatz waere nur von den Strassen auf die Beschriftung verschoben.
assert.strictEqual((verschoben.match(/offsetWidth/g) || []).length, 2,
	"💣 Im Microtask stehen nicht genau ZWEI erzwungene Stilabgleiche (einer trennt Start- und "
	+ "Endwert, der zweite startet unseren Uebergang im selben Augenblick wie alle anderen).");
const letzterSetTransform = verschoben.lastIndexOf("L.DomUtil.setTransform(");
const letzterOffsetWidth = verschoben.lastIndexOf("offsetWidth");
assert.ok(letzterOffsetWidth > letzterSetTransform,
	"💣 Der zweite Stilabgleich steht VOR dem Endwert -- dann startet er nichts.");

// --- Und die Kurve ist EINE, auch bei der Deckkraft ------------------------------------------------
// 🔴 Die letzte abweichende Kurve des Zoomschritts: die Grenzbeschriftungen blendeten ihre Deckkraft
// mit `ease-out`, waehrend Kacheln, SVG, Marker, Schraffur und Wegenamen alle auf der Hauskurve
// laufen (nachgemessen 27.08.2026).
const labelsCss = ohneKommentare(lies("css/features/map-labels.css"));
assert.ok(!/opacity var\(--border-label-fade-out[^;]*ease-out/.test(labelsCss),
	"🔴 Die Deckkraft der Grenzbeschriftungen laeuft wieder auf `ease-out` statt auf der Hauskurve.");
assert.ok(/opacity var\(--border-label-fade-out[^;]*var\(--avesmaps-zoom-kurve\)/.test(labelsCss),
	"🔴 Die Deckkraft liest die gemeinsame Kurve nicht.");
// ⚠️ Die DAUER bleibt eigen -- sie ist der Anteil des Ausblendens am Blendenbudget, nicht die Zoomdauer.
assert.ok(/opacity var\(--border-label-fade-out, 120ms\)/.test(labelsCss),
	"⚠️ Die eigene Ausblenddauer ist verschwunden -- sie muss kuerzer bleiben als der Zoomschritt.");

console.log("OK: die zoomanim-Zustellung bleibt frei, das Zustandsabhaengige synchron, die Kurve eine.");
