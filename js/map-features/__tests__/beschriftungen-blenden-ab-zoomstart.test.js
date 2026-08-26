const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 ALLE VIER BESCHRIFTUNGS-EBENEN BLENDEN AB `zoomanim` t = 0 AUS.
// Owner 26.08.2026, nachdem die Siedlungsnamen es taten: „WOW zum erstenmal verschwinden die labels
// im augenblick des reinzoomens!!!!! ... das bei allen beschriftungen wenns geht!"
//
// Die vier Ebenen und wo ihre Blende sitzt:
//   Siedlungs-/Landschaftsnamen  DOM, Pane-Klon        js/app/bootstrap.js
//   Territoriumsnamen            DOM, CSS-Blende       css/features/map-labels.css
//   Grenzbeschriftungen          Canvas, CSS-Blende    map-features-boundary-canvas-overlay.js
//   Wege-/Flussnamen             Canvas, INLINE-Blende map-features-path-label-canvas-overlay.js
//
// 💣 ZWEI BAUFORMEN, UND DAS IST KEIN SCHLENDRIAN. Bei den Grenznamen steht die Blende im CSS, bei
// den Wegenamen inline -- erzwungen, weil deren zoomanim-Handler `style.transition` seit jeher
// selbst setzt und inline gegen CSS gewinnt. Wer bei den Grenznamen eine Inline-Transition
// ergaenzt, loescht ihre CSS-Blendenregel dauerhaft aus (`transition` ist EINE Eigenschaft).
// Deshalb prueft dieser Test bei den Grenznamen NUR die Deckkraft und die Dauer-Variable.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/beschriftungen-blenden-ab-zoomstart.test.js

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt.
const ohneKommentare = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const zoomanimBlock = (quelle) => {
	const a = quelle.indexOf('map.on("zoomanim"');
	assert.ok(a > 0, "Kein zoomanim-Handler gefunden.");
	// Bis zum naechsten map.on(...) oder zum Ende -- der Handler steht immer vor dem naechsten.
	const b = quelle.indexOf("map.on(", a + 10);
	return quelle.slice(a, b > a ? b : quelle.length);
};

// ---- Grenzbeschriftungen (Canvas, CSS-Blende) --------------------------------------------------
{
	const roh = lies("js/map-features/map-features-boundary-canvas-overlay.js");
	const quelle = ohneKommentare(roh);
	const block = zoomanimBlock(quelle);
	assert.ok(/labelVorne\.style\.opacity\s*=\s*"0"/.test(block),
		"🔴 Die Grenzbeschriftungen blenden im zoomanim nicht aus -- das alte Bild bleibt waehrend "
		+ "des ganzen Zooms stehen.");
	// 🔴 Und zwar UNBEDINGT, nicht nur im ?crossfade=0-Zweig. Genau darin lag der Unterschied:
	// mit Ueberblendung blieb die alte Schrift bis nach dem Zoom stehen.
	assert.ok(!/if\s*\(!KREUZBLENDE_AN\)\s*\{\s*labelVorne\.style\.opacity\s*=\s*"0";\s*\}/.test(block),
		"🔴 Das Ausblenden haengt noch am ?crossfade=0-Zweig -- mit Ueberblendung bleibt die alte "
		+ "Schrift stehen, und genau das hat der Owner beanstandet.");
	// 💣 KEINE Inline-Transition hier: sie wuerde die CSS-Blendenregel dauerhaft ausloeschen.
	assert.ok(!/labelVorne\.style\.transition\s*=/.test(block),
		"💣 Im zoomanim wird eine Inline-Transition auf die Grenz-Beschriftungsflaeche gesetzt. "
		+ "`transition` ist EINE Eigenschaft, und inline gewinnt -- damit ist die Blendenregel aus "
		+ "css/features/map-labels.css dauerhaft tot.");
	assert.ok(/return AVESMAPS_ZOOM_DAUER_MS;/.test(quelle),
		"Die Ausblenddauer liest nicht die gemeinsame Zahl (stand auf 120).");
	assert.ok(!/return 350;/.test(quelle), "Die Einblenddauer steht noch auf eigenen 350 ms.");
}

// ---- Wege- und Flussnamen (Canvas, Inline-Blende) ----------------------------------------------
{
	const roh = lies("js/map-features/map-features-path-label-canvas-overlay.js");
	const quelle = ohneKommentare(roh);
	const block = zoomanimBlock(quelle);
	assert.ok(/vorne\.style\.opacity\s*=\s*"0"/.test(block),
		"🔴 Die Wege-/Flussnamen blenden im zoomanim nicht aus.");
	assert.ok(!/\}\s*else\s*\{[\s\S]{0,200}?vorne\.style\.opacity\s*=\s*"0";\s*\}\s*$/.test(block.trim()),
		"🔴 Das Ausblenden steht nur im else-Zweig (?crossfade=0).");
	assert.ok(/pfadLabelDauer\("wegefadeout",\s*AVESMAPS_ZOOM_DAUER_MS\)/.test(quelle),
		"Die Ausblenddauer der Wegenamen liest nicht die gemeinsame Zahl (stand auf 120).");
	assert.ok(/pfadLabelDauer\("wegefade",\s*AVESMAPS_ZOOM_DAUER_MS\)/.test(quelle),
		"Die Einblenddauer der Wegenamen liest nicht die gemeinsame Zahl (stand auf 350).");
	assert.ok(!/ms ease"/.test(quelle) && !/ms ease-out"/.test(quelle),
		"Es steht noch eine eigene Kurve (`ease` / `ease-out`) in den Wegenamen.");
}

// ---- Die beiden DOM-Panes (CSS) ----------------------------------------------------------------
{
	const css = lies("css/features/map-labels.css").replace(/\/\*[\s\S]*?\*\//g, "");
	assert.ok(!/opacity\s+200ms\s+ease-in/.test(css),
		"Die alte Einblend-Kurve der Label-Panes (200ms ease-in) steht noch im CSS.");
	assert.ok(!/opacity\s+100ms\s+ease-out/.test(css),
		"Die alte Ausblend-Kurve der Label-Panes (100ms ease-out) steht noch im CSS.");
	// Die Regel unter .leaflet-zoom-anim traegt weiterhin opacity: 0 -- das IST das Ausblenden ab t=0.
	assert.ok(/\.leaflet-zoom-anim\s+\.region-labels-pane[\s\S]{0,160}?opacity:\s*0/.test(css),
		"🔴 Die Territoriumsnamen blenden nicht mehr ab Zoomstart aus.");
	// Und beide Blenden laufen auf der gemeinsamen Kurve.
	const zoomAnimRegel = css.slice(css.indexOf(".leaflet-zoom-anim .region-labels-pane"));
	assert.ok(/var\(--avesmaps-zoom-dauer\)/.test(zoomAnimRegel)
		&& /var\(--avesmaps-zoom-kurve\)/.test(zoomAnimRegel),
		"Die Pane-Blende liest die gemeinsamen Token nicht.");
}

// ---- Und keine der vier Ebenen traegt noch eine eigene Kurve ------------------------------------
// 🪤 `ease-out` in einer Transform-Transition waere etwas anderes; hier geht es nur um Deckkraft.
for (const datei of [
	"js/map-features/map-features-boundary-canvas-overlay.js",
	"js/map-features/map-features-path-label-canvas-overlay.js",
	"js/app/bootstrap.js",
]) {
	const quelle = ohneKommentare(lies(datei));
	const treffer = quelle.match(/opacity [^"`;]*\b(ease|ease-in|ease-out|linear)\b/g) || [];
	assert.strictEqual(treffer.length, 0,
		datei + ": traegt noch eine eigene Blendenkurve -- " + JSON.stringify(treffer));
}

console.log("beschriftungen-blenden-ab-zoomstart.test.js: alle Zusicherungen erfuellt");
