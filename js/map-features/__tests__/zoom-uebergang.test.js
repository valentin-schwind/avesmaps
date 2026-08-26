const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DIE ZOOMKURVE IST EINE KURVE, UND DIESER TEST IST DER EINZIGE, DER DAS HAELT.
// Entwurf: docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md
// Bauplan: docs/superpowers/plans/2026-08-26-zoom-uebergang-konsistenz.md (Aufgabe 1)
//
// Vorher stand dieselbe Zeichenkette an ACHT Stellen -- sechsmal im JS, zweimal im CSS. Der
// Entwurf zaehlte fuenf und uebersah drei (Schraffur, Fluss- und Tempopfeile). Genau so laufen
// Werte auseinander: nicht weil jemand einen aendert, sondern weil niemand alle findet.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoom-uebergang.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../zoom-uebergang.js"), "utf8"),
	{ filename: "zoom-uebergang.js" }
);

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
// 💣 KOMMENTARE ZUERST STRIPPEN. Sonst schlaegt der Test an der Warnung an, die vor dem Muster
// warnt -- und der naechste Leser loescht den Kommentar, um den Test gruen zu bekommen. Damit
// waere die Warnung weg und der Fehler wieder moeglich.
const ohneKommentare = (text) => text
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ---- Die Kurve ist EINE Kurve -----------------------------------------------------------------
assert.strictEqual(AVESMAPS_ZOOM_DAUER_MS, 250,
	"💣 250 ist Leaflets eigene Zahl (setTimeout(_onZoomTransitionEnd, 250) in js/third-party/"
	+ "leaflet.js, minifiziert) -- eine andere Dauer laeuft an Leaflets Ende vorbei.");
assert.strictEqual(AVESMAPS_ZOOM_KURVE, "cubic-bezier(0.42, 0, 0.58, 1)");
assert.deepStrictEqual(AVESMAPS_ZOOM_KURVE_PUNKTE, [0.42, 0, 0.58, 1],
	"💣 Der String und die Punkte sind ein GEKOPPELTER Wert: der String faehrt die CSS-Uebergaenge, "
	+ "die Punkte die Gegenrechnung der Marker. Laufen sie auseinander, rechnet die Korrektur gegen "
	+ "eine Kurve, die gar nicht laeuft.");
assert.strictEqual(avesmapsZoomTransition("transform"),
	"transform 250ms cubic-bezier(0.42, 0, 0.58, 1)");
assert.strictEqual(avesmapsZoomTransition("opacity"),
	"opacity 250ms cubic-bezier(0.42, 0, 0.58, 1)");

// ---- Keine alte Kurve bleibt stehen -----------------------------------------------------------
// 🔴 DIESE LISTE IST DER PUNKT DES GANZEN TESTS. Wer eine Zeichenflaeche ergaenzt, die beim Zoom
// mitskaliert, traegt sie hier ein -- sonst ist sie die neunte Stelle mit einer eigenen Kurve.
const WIRTE = [
	"js/map-features/map-features-boundary-canvas-overlay.js",
	"js/map-features/map-features-path-label-canvas-overlay.js",
	"js/map-features/map-features-location-canvas-layer.js",
	"js/map-features/map-features-contested-hatch-overlay.js",
	"js/map-features/map-features-river-flow-arrows.js",
	"js/routing/route-speed-arrows.js",
];
for (const w of WIRTE) {
	const quelle = ohneKommentare(lies(w));
	assert.ok(!/cubic-bezier\(\s*0\s*,\s*0\s*,\s*0\.25\s*,\s*1\s*\)/.test(quelle),
		w + ": traegt noch Leaflets alte Kurve als Zeichenkette.");
	assert.ok(/avesmapsZoomTransition\s*\(/.test(quelle),
		w + ": liest die Kurve nicht aus zoom-uebergang.js.");
}

// ---- Auch das CSS liest sie, und leaflet.css wird ueberschrieben -------------------------------
const token = lies("css/features/zoom-uebergang.css");
assert.ok(/--avesmaps-zoom-dauer:\s*250ms/.test(token),
	"Das Dauer-Token fehlt oder traegt eine andere Zahl als die JS-Konstante.");
assert.ok(/--avesmaps-zoom-kurve:\s*cubic-bezier\(0\.42,\s*0,\s*0\.58,\s*1\)/.test(token),
	"Das Kurven-Token fehlt oder traegt eine andere Kurve als die JS-Konstante.");
assert.ok(/\.leaflet-zoom-anim\s+\.leaflet-zoom-animated/.test(token),
	"💣 Leaflets eigene Regel muss ueberschrieben werden -- sonst laufen die KACHELN weiter auf der "
	+ "alten Kurve, und der Guss ist an der auffaelligsten Flaeche gebrochen.");
assert.ok(/@import\s+url\("features\/zoom-uebergang\.css"\)/.test(lies("css/styles.css")),
	"Ohne @import erreicht die Datei weder den Stempler noch den Browser.");

// 💣 Die Reihenfolge im CSS ist tragend: die Token muessen VOR ihren Lesern stehen, sonst loest
// var() nichts auf -- und ein undefiniertes var() macht die GANZE Deklaration ungueltig.
const styles = lies("css/styles.css");
assert.ok(styles.indexOf('features/zoom-uebergang.css') < styles.indexOf('features/map-labels.css'),
	"💣 zoom-uebergang.css wird nach map-labels.css importiert -- dort loest var(--avesmaps-zoom-*) "
	+ "dann nichts auf, und die ganze transition-Deklaration faellt aus.");

const labelsCss = lies("css/features/map-labels.css").replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/cubic-bezier\(\s*0\s*,\s*0\s*,\s*0\.25\s*,\s*1\s*\)/.test(labelsCss),
	"map-labels.css traegt noch die alte Kurve.");
assert.ok(/var\(--avesmaps-zoom-dauer\)/.test(labelsCss) && /var\(--avesmaps-zoom-kurve\)/.test(labelsCss),
	"map-labels.css liest die gemeinsamen Token nicht.");

// 💣 Und das Skript muss VOR seinen Lesern geladen werden: `const` auf Dateiebene wird nicht
// gehoistet, ein zu spaet geladenes zoom-uebergang.js hiesse `undefined` in jedem Wirt.
const html = lies("index.html");
const posQuelle = html.indexOf("js/map-features/zoom-uebergang.js");
assert.ok(posQuelle > 0, "index.html laedt js/map-features/zoom-uebergang.js gar nicht.");
for (const w of WIRTE.concat(["js/app/bootstrap.js"])) {
	assert.ok(posQuelle < html.indexOf(w),
		"💣 zoom-uebergang.js wird NACH " + w + " geladen -- dort stuende dann undefined.");
}
// ⚠️ Kein `?v=` von Hand (AGENTS.md §7) -- der Deploy stempelt, ein Handstempel kann nur veralten.
assert.ok(!/js\/map-features\/zoom-uebergang\.js\?v=/.test(html),
	"Ein von Hand geschriebenes ?v= -- der Deploy ueberschreibt es und es kann nur veralten.");

// ---- Die Easing-Rechnung stimmt mit der Kurve ueberein ----------------------------------------
assert.strictEqual(avesmapsZoomEasing(0), 0);
assert.strictEqual(avesmapsZoomEasing(1), 1);
assert.ok(Math.abs(avesmapsZoomEasing(0.5) - 0.5) < 1e-6,
	"ease-in-out ist punktsymmetrisch: bei der Haelfte der Zeit die Haelfte des Weges.");
// Symmetrie ueber die ganze Kurve -- der Test, der ein vertauschtes Kontrollpunktpaar faengt.
for (const t of [0.1, 0.25, 0.4, 0.75, 0.9]) {
	assert.ok(Math.abs(avesmapsZoomEasing(t) + avesmapsZoomEasing(1 - t) - 1) < 1e-5,
		"Symmetrie verletzt bei t=" + t);
}
// 💣 Eine cubic-bezier-Kurve ist nach der ZEIT parametrisiert, nicht nach dem Kurvenparameter.
// Wer Y(t) statt Y(u mit X(u)=t) rechnet, bekommt eine aehnlich aussehende, aber falsche Kurve.
// Bei ease-in-out weicht sie in der Mitte der ersten Haelfte am staerksten ab -- genau dort messen.
{
	const naiv = (u) => 3 * (1 - u) * (1 - u) * u * 0 + 3 * (1 - u) * u * u * 1 + u * u * u;
	assert.ok(Math.abs(avesmapsZoomEasing(0.25) - naiv(0.25)) > 0.02,
		"💣 avesmapsZoomEasing rechnet offenbar Y(t) statt Y(u) -- die Marker liefen der Animation "
		+ "dann um einige Prozent hinterher.");
}
// Monoton steigend und im Fenster -- faengt einen Newton-Lauf, der aus [0,1] hinauslaeuft.
let vorher = -1;
for (let i = 0; i <= 200; i++) {
	const y = avesmapsZoomEasing(i / 200);
	assert.ok(y >= vorher - 1e-9, "nicht monoton bei t=" + (i / 200));
	assert.ok(y >= -1e-9 && y <= 1 + 1e-9, "ausserhalb [0,1] bei t=" + (i / 200));
	vorher = y;
}
// X(u) wird wirklich invertiert: die Rueckrechnung muss auf t zurueckfuehren.
{
	const bezX = (u) => 3 * (1 - u) * (1 - u) * u * 0.42 + 3 * (1 - u) * u * u * 0.58 + u * u * u;
	const bezY = (u) => 3 * (1 - u) * u * u * 1 + u * u * u;
	for (const u of [0.13, 0.37, 0.62, 0.88]) {
		assert.ok(Math.abs(avesmapsZoomEasing(bezX(u)) - bezY(u)) < 1e-5,
			"Die Umkehrung von X trifft u nicht bei u=" + u);
	}
}
// Ausserhalb des Fensters wird geklemmt, nicht extrapoliert.
assert.strictEqual(avesmapsZoomEasing(-1), 0);
assert.strictEqual(avesmapsZoomEasing(2), 1);
assert.strictEqual(avesmapsZoomEasing(NaN), 0);
assert.strictEqual(avesmapsZoomEasing(undefined), 0);

console.log("zoom-uebergang.test.js: alle Zusicherungen erfuellt");
