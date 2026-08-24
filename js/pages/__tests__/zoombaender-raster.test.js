// Die Plots im Fenster „Darstellung" rasten: Marker in GANZEN Pixeln, Label in HALBEN Punkten
// (Owner 24.08.2026: „kannst du die marker und label größen unter Darstellung im Orts-Editor mit
// snapper versehen (0,5er Schritte bei pt und 1px bei pixel)").
//
// 🔴 EINE QUELLE FÜR VIER WEGE: Ziehen, Pfeiltasten, Zahlenfeld und das `step`-Attribut lesen alle
// ZOOM_BAND_SNAP. Ein zweiter, abgeschriebener Wert wäre genau die Divergenz, gegen die das Raster
// gebaut ist -- deshalb prüft Abschnitt C, dass keiner der vier eine eigene Zahl trägt.
//
// 🪤 DIE FALLE, DIE ABSCHNITT B FÄNGT: die Pfeiltasten gingen in 0,01er Schritten. Nach dem Rasten
// landet ein solcher Schritt auf DEMSELBEN Wert zurück -- die Taste hätte sichtbar nichts getan,
// und zwar lautlos.
//
// 🔴 Das Fenster ist eine PHP-nahe HTML-Seite und nicht require-bar; die Funktionen werden deshalb
// aus dem <script> geschnitten und ausgeführt -- der echte Rumpf, keine Abschrift.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/zoombaender-raster.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const seite = fs.readFileSync(
	path.join(__dirname, "..", "..", "..", "html", "wiki-sync-settlement-editor.html"), "utf8");

// ---- Die drei Bausteine herausschneiden und ausführen ---------------------------------------------
const schnipsel = [
	/function zoomBandRound2\(v\) \{[^\n]*\}/,
	/const ZOOM_BAND_SNAP = \{[^}]*\};/,
	/function zoomBandSnap\(kind, v\) \{[\s\S]*?\n\}/,
	/function zoomBandClamp\(v, lo, hi\) \{[^\n]*\}/,
].map((re) => {
	const treffer = seite.match(re);
	assert.ok(treffer, `Baustein gefunden: ${re}`);
	return treffer[0];
});

const ctx = { Math };
vm.createContext(ctx);
vm.runInContext(schnipsel.join("\n"), ctx);
const snap = (kind, v) => vm.runInContext(`zoomBandSnap(${JSON.stringify(kind)}, ${v})`, ctx);

// ---- A. Das Raster selbst --------------------------------------------------------------------------
assert.strictEqual(vm.runInContext("ZOOM_BAND_SNAP.marker", ctx), 1, "Marker: ganze Pixel");
assert.strictEqual(vm.runInContext("ZOOM_BAND_SNAP.label", ctx), 0.5, "Label: halbe Punkte");

[[6.65, 7], [18.81, 19], [37.62, 38], [1.33, 1], [26.6, 27], [12, 12]].forEach(([roh, erwartet]) => {
	assert.strictEqual(snap("marker", roh), erwartet, `Marker ${roh} -> ${erwartet}`);
});
[[11.2, 11], [11.3, 11.5], [8.75, 9], [13, 13], [9.5, 9.5], [17.4, 17.5]].forEach(([roh, erwartet]) => {
	assert.strictEqual(snap("label", roh), erwartet, `Label ${roh} -> ${erwartet}`);
});

// 💣 Kein Gleitkomma-Schmutz im Ergebnis -- der Wert steht gleich als TEXT im Zahlenfeld.
[10.26, 0.7, 29.9, 4.1].forEach((roh) => {
	const v = snap("label", roh);
	assert.strictEqual(String(v).replace(/^-?\d+(\.[05])?$/, "ok"), "ok",
		`Label ${roh} -> ${v} ist eine saubere Halbe`);
});

// ⚠️ Ein unbekannter Plot rastet NICHT auf 1 px, sondern faellt auf die alte Feinheit zurueck --
// ein neuer Plot ohne Eintrag soll sich nicht stillschweigend ganzzahlig verhalten.
assert.strictEqual(snap("gibtsnicht", 12.34), 12.34, "ohne Eintrag bleibt es bei 0,01");

// ---- B. Die vier Wege lesen dieselbe Quelle --------------------------------------------------------
// 💣 Der EINE Setzer (Ziehen + Zahlenfeld + Pfeiltasten muenden dort).
assert.ok(/const val = zoomBandClamp\(zoomBandSnap\(kind, zoomBandClamp\(rawVal/.test(seite),
	"setZoomBandPointValue rastet -- klemmen, rasten, klemmen");
// 💣 Die Pfeiltasten, sonst ist die feine Stufe wirkungslos.
assert.ok(/const schritt = ZOOM_BAND_SNAP\[cfg\.kind\]/.test(seite),
	"die Pfeiltasten nehmen die Rasterweite");
assert.ok(!/const step = ev\.shiftKey \? 1 : 0\.01;/.test(seite),
	"und NICHT mehr die alten 0,01 -- die waeren nach dem Rasten wirkungslos");
// 💣 Das step-Attribut der Zahlenfelder.
assert.ok(/cfg\.selInputEl\.step = String\(ZOOM_BAND_SNAP\[cfg\.kind\]/.test(seite),
	"das Zahlenfeld bekommt sein step aus derselben Quelle");
// 🔴 Und im Markup steht KEIN zweites step mehr -- es waere bis zum ersten JS-Lauf eine Luege.
["zbSelMarkerInput", "zbSelLabelInput"].forEach((id) => {
	const zeile = seite.split("\n").find((l) => l.includes(`id="${id}"`));
	assert.ok(zeile && !/step=/.test(zeile), `${id} traegt kein eigenes step-Attribut mehr`);
	assert.ok(/disabled/.test(zeile), `${id} ist bis dahin ohnehin gesperrt`);
});

// ---- C. Die Vorgabewerte bleiben unberuehrt --------------------------------------------------------
// ⚠️ Das Raster greift nur, wo jemand einen Wert ANFASST. Die Tafel traegt weiterhin ihre zwei
// Nachkommastellen; wuerde sie mitgerastet, aenderte sich das Kartenbild beim blossen Oeffnen des
// Fensters (und zoombaender-vorgabe.test.js faenge es erst beim naechsten Speichern).
const tafel = fs.readFileSync(
	path.join(__dirname, "..", "..", "map-features", "location-zoom-bands.js"), "utf8");
assert.ok(/metropole: \[6\.65, 9\.4, 13\.3, 18\.81, 26\.6, 37\.62, 53\.2, 53\.2, 53\.2\]/.test(tafel),
	"die Vorgabekurve steht unveraendert mit ihren Nachkommastellen da");
assert.ok(!/ZOOM_BAND_SNAP/.test(tafel), "und die Tafel kennt das Raster ueberhaupt nicht");

console.log("zoombaender-raster: alle Zusicherungen erfuellt");
