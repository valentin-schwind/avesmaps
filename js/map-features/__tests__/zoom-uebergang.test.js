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
assert.strictEqual(AVESMAPS_ZOOM_DAUER_BASIS_MS, 500,
	"🔴 Owner 27.08.2026, nachdem er ?zoomlupe=2 zum Hinsehen benutzt hatte: „etwas angenehmer ... "
	+ "kann man das zum default machen?\" 2 x 250 = 500.");
// 💣 UND LEAFLET ZAEHLT WEITER SEINE EIGENEN 250. Solange unsere Dauer laenger ist, MUSS der
// Ausgleich unten Leaflets Ende nachschieben -- sonst raeumt Leaflet mitten in der laufenden
// Animation auf, und die Flaechen saessen zu frueh auf ihrem Platz.
assert.strictEqual(AVESMAPS_LEAFLET_ZOOM_ENDE_MS, 250,
	"Leaflets eigene Zahl ist keine Einstellung -- sie beschreibt Fremdcode.");
// 🪤 Und DAS ist die Stelle, an der ein Leaflet-Update den Zoom lautlos brechen wuerde: aendert
// sich die Zahl dort, gleicht unsere Konstante gegen eine Uhr aus, die es nicht mehr gibt.
assert.ok(/setTimeout\(a\(this\._onZoomTransitionEnd,this\),250\)/
	.test(lies("js/third-party/leaflet.js")),
	"💣 Leaflet zaehlt nicht mehr 250 -- AVESMAPS_LEAFLET_ZOOM_ENDE_MS muss nachgezogen werden, "
	+ "sonst schiebt der Ausgleich um den falschen Betrag.");
// 🔴 OHNE ?zoomlupe ist die wirksame Dauer zifferngenau die Basis. Die Zeitlupe ist ein Werkzeug
// zum Hinsehen; sie darf die Karte im Normalbetrieb nicht anfassen.
assert.strictEqual(AVESMAPS_ZOOM_LUPE, 1, "Ohne Adresszeile darf keine Zeitlupe aktiv sein.");
assert.strictEqual(AVESMAPS_ZOOM_DAUER_MS, AVESMAPS_ZOOM_DAUER_BASIS_MS,
	"Ohne ?zoomlupe muss die wirksame Dauer die Basis sein.");
{
	// 💣 Die Zeitlupe MUSS auch Leaflets eigenes Ende dehnen, sonst ist sie nach 250 ms
	// abgeschnitten -- und man saehe genau den Teil nicht, den man sucht.
	const quelle = ohneKommentare(lies("js/map-features/zoom-uebergang.js"));
	assert.ok(/_onZoomTransitionEnd/.test(quelle),
		"💣 Die Zeitlupe dehnt Leaflets Aufraeumen nicht -- nach 250 ms bricht sie ab.");
	// 🔴 Der Ausgleich haengt an den zwei UHREN, nicht am Parameter. Bis zum 27.08.2026 stand hier
	// `if (AVESMAPS_ZOOM_LUPE > 1)`, weil unsere Dauer damals Leaflets eigene WAR und das Umwickeln
	// im Normalbetrieb nichts zu suchen hatte. Seit die Basis 500 ist, laeuft derselbe Ausgleich
	// immer -- und die Bedingung muss das sagen, statt einen Parameter zu nennen: so faellt sie von
	// selbst weg, wenn jemand die Basis wieder auf 250 stellt.
	assert.ok(/if \(AVESMAPS_ZOOM_DAUER_MS > AVESMAPS_LEAFLET_ZOOM_ENDE_MS\)/.test(quelle),
		"🔴 Der Ausgleich fragt nicht die zwei Uhren ab -- er haengt an etwas anderem.");
	// 💣 Und er muss um die DIFFERENZ zu Leaflets Ende schieben, nicht um die zur Basis: seit die
	// Basis nicht mehr Leaflets Zahl ist, sind das zwei verschiedene Betraege. Mit der alten
	// Rechnung waere der Ausgleich im Normalbetrieb exakt 0 -- also wirkungslos, und zwar lautlos.
	assert.ok(/zusatz = AVESMAPS_ZOOM_DAUER_MS - AVESMAPS_LEAFLET_ZOOM_ENDE_MS/.test(quelle),
		"💣 Der Ausgleich rechnet gegen die falsche Zahl.");
	// ⚠️ Die Konsolenmeldung bleibt an der Zeitlupe -- sonst schreibt jeder Besuch eine Zeile.
	assert.ok(/if \(AVESMAPS_ZOOM_LUPE > 1\) console\.info/.test(quelle),
		"⚠️ Die Zeitlupen-Meldung feuert auch im Normalbetrieb.");
	assert.ok(/wert >= 1 && wert <= 60/.test(quelle),
		"⚠️ Der Faktor ist nicht eingegrenzt -- ein Tippfehler legte den Zoom minutenlang lahm.");
}
assert.strictEqual(AVESMAPS_ZOOM_KURVE, "cubic-bezier(0.42, 0, 0.58, 1)");
assert.deepStrictEqual(AVESMAPS_ZOOM_KURVE_PUNKTE, [0.42, 0, 0.58, 1],
	"💣 Der String und die Punkte sind ein GEKOPPELTER Wert: der String faehrt die CSS-Uebergaenge, "
	+ "die Punkte die Gegenrechnung der Marker. Laufen sie auseinander, rechnet die Korrektur gegen "
	+ "eine Kurve, die gar nicht laeuft.");
assert.strictEqual(avesmapsZoomTransition("transform"),
	"transform 500ms cubic-bezier(0.42, 0, 0.58, 1)");
assert.strictEqual(avesmapsZoomTransition("opacity"),
	"opacity 500ms cubic-bezier(0.42, 0, 0.58, 1)");

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
// 💣 ABGELEITET, NICHT ABGESCHRIEBEN. Hier stand die 250 ein zweites Mal als Literal -- dann haelt
// der Test nur fest, dass irgendwo 250 steht, und beim naechsten Aendern muss man ihn an ZWEI
// Stellen nachziehen. Aus der Konstante gerechnet koennen die beiden Dateien nicht mehr
// auseinanderlaufen, egal welche Zahl jemand waehlt.
assert.ok(new RegExp("--avesmaps-zoom-dauer:\\s*" + AVESMAPS_ZOOM_DAUER_BASIS_MS + "ms").test(token),
	"Das Dauer-Token traegt eine andere Zahl als die JS-Konstante ("
	+ AVESMAPS_ZOOM_DAUER_BASIS_MS + "ms erwartet).");
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
// 💣 OHNE KOMMENTARE gelesen: ein Dateipfad in einem <!-- --> ist fuer `indexOf` ein
// frueheres script-Tag. Das dreht eine Reihenfolgepruefung um (falsch ROT) und macht eine
// Vorhandenseinspruefung falsch GRUEN. Am 02.09.2026 genau so passiert.
const html = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
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

// ---- 🔴 DAS BLENDEN-BUDGET MUSS KUERZER SEIN ALS DER ZOOM ------------------------------------
// 💣 Am Ende der Zoomdauer raeumt Leaflet auf (Transitions loeschen, Flaechen neu setzen). Eine
// Blende, die dann noch laeuft, wird abgeschnitten und ihr Rest springt in EINEM Bild.
// Owner 26.08.2026: „zuerst stabil, dann ploetzlich sprung auf neues" -- und mit ?zoomlupe war
// es richtig, weil dort das Aufraeumen mitgedehnt wird. Genau diese Gegenprobe hat den
// Wettlauf sichtbar gemacht.
// ⚠️ Null Reserve reicht NICHT: eine Blende beginnt beim naechsten Stilabgleich, nicht bei der
// Zuweisung -- startet sie 40 ms zu spaet, endet sie 40 ms zu spaet.
assert.ok(avesmapsZoomBlendenBudgetMs() < AVESMAPS_ZOOM_DAUER_MS,
	"💣 Die Blenden duerfen die ganze Zoomdauer verbrauchen -- dann schneidet Leaflets Aufraeumen "
	+ "ihren Rest ab, und der springt in einem Bild.");
assert.ok(AVESMAPS_ZOOM_DAUER_MS - avesmapsZoomBlendenBudgetMs() >= 40,
	"⚠️ Die Reserve vor dem Aufraeumen ist kleiner als 40 ms -- so viel kann allein der "
	+ "verspaetete Start der Blende ausmachen, wenn der Hauptthread beim Zoomstart belegt ist.");
// Und sie waechst mit der Zeitlupe mit, statt eine feste Zahl zu sein.
assert.strictEqual(avesmapsZoomBlendenBudgetMs(), Math.round(AVESMAPS_ZOOM_DAUER_MS * 0.75),
	"Das Budget haengt nicht an der Zoomdauer.");

console.log("zoom-uebergang.test.js: alle Zusicherungen erfuellt");
