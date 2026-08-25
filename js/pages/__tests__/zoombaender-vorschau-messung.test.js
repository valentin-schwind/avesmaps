const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Messphase der Bühne im Fenster „Zoombänder" (Ortseditor → Darstellung, Abschnitt „Abstände").
//
// 💣 EIN NAME WURDE MIT DER DEKORATION DER VORRUNDE GEMESSEN. `updateZoomBandVorschau` misst jeden
// Kasten mit getBoundingClientRect(), setzte die Klasse aber erst in der SCHREIBphase weiter unten
// zurück. Ein Name, den der vorige Lauf als `--gone` markiert hatte, trug beim Messen also noch
// dessen `border:1px dashed` + `padding:0 2px` -- gemessen 26.08.2026 im Browser: „Angbar" bei
// 20 px Schrift abwechselnd 80,41 und 74,41 px, „Zwingard" 70,25 / 76,25. Fünf Aufrufe OHNE jede
// Änderung lieferten abwechselnd „23 sichtbar / 3 ausgewichen" und „24 / 5", und einzelne Namen
// wechselten grundlos zwischen `--gone` und `--drift`.
//
// 🔴 `--drift` IST DIE ZWEITE, LEISERE HÄLFTE: es setzt `font-weight:bold`, und fett ist breiter.
// Sie fällt nicht als glatte Pixelzahl auf -- ohne diesen Test bliebe sie stehen, wenn jemand nur
// die sichtbaren 6 px des Rahmens beseitigt.
//
// ⭐ Der Test schneidet die ECHTEN Funktionen aus der Seite (Hausmuster aus
// js/app/__tests__/dubletten-verweis.test.js) und lässt den ECHTEN Löser aus
// js/map-features/label-placement.js darüber laufen. Nachgebaut ist nur, was Node nicht hat: die
// Textmessung -- und die bildet genau die zwei CSS-Regeln nach, die den Kasten aufblasen.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/zoombaender-vorschau-messung.test.js

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const SEITE = read("html/wiki-sync-settlement-editor.html");

// ---- Der Schnitt aus dem echten Quelltext --------------------------------------------------------
// ⚠️ Das Endzeichen "\n}" trifft auch auf einer CRLF-Arbeitskopie, weil "\r\n}" es enthält -- der
// Test läuft hier wie im Deploy-Tor gleich (js/routing/__tests__/duplicate-location-name.test.js).
function schneide(anfang, ende) {
	const start = SEITE.indexOf(anfang);
	assert.notStrictEqual(start, -1, `Deklaration nicht gefunden: ${anfang}`);
	const stop = SEITE.indexOf(ende, start + anfang.length);
	assert.notStrictEqual(stop, -1, `Ende der Deklaration nicht gefunden: ${anfang}`);
	return SEITE.slice(start, stop + ende.length);
}

// ---- Stubs: nur das, was Node nicht hat ----------------------------------------------------------
globalThis.window = { getComputedStyle: () => ({ getPropertyValue: () => "0" }) };
globalThis.location = { search: "" };

// 💣 DIE ZWEI CSS-REGELN, DIE DEN KASTEN AUFBLASEN -- der ganze Grund, warum es diesen Test gibt.
// Sie stehen im <style>-Block derselben Seite (.zbv-name--gone / .zbv-name--drift).
const GONE_BREITE = 6;   // border:1px dashed (2 px) + padding:0 2px (4 px)
const GONE_HOEHE = 2;    // border:1px dashed, oben und unten
const DRIFT_FETT = 1.06; // font-weight:bold -- breiter, aber keine glatte Pixelzahl

// Was beim MESSEN am Knoten hing. Genau diese Liste ist der Befund.
const messprotokoll = [];

function macheKnoten() {
	const knoten = {
		textContent: "",
		className: "",
		style: { setProperty: () => {} },
		classList: { add: (c) => { knoten.className += " " + c; } },
		getBoundingClientRect() {
			const px = parseFloat(knoten.style.fontSize) || 0;
			let breite = knoten.textContent.length * px * 0.5;
			let hoehe = px * 1.35;
			if (/(^|\s)zbv-name--gone(\s|$)/.test(knoten.className)) {
				breite += GONE_BREITE;
				hoehe += GONE_HOEHE;
			}
			if (/(^|\s)zbv-name--drift(\s|$)/.test(knoten.className)) { breite *= DRIFT_FETT; }
			messprotokoll.push({
				name: knoten.textContent,
				klasse: knoten.className,
				breite: Math.round(breite * 100) / 100,
			});
			return { width: breite, height: hoehe };
		},
	};
	return knoten;
}

globalThis.document = { createElement: () => macheKnoten() };

const ANZEIGEN = ["zbvSicht", "zbvDrift", "zbvWeg", "zbvMax", "zbvLines", "zbvHint"];
const anzeige = {};
ANZEIGEN.forEach((id) => { anzeige[id] = { textContent: "", innerHTML: "", hidden: false }; });
globalThis.$ = (id) => {
	if (id === "zbvPunkte" || id === "zbvNamen") { return { appendChild: () => {} }; }
	if (id === "zbvZoom") { return null; } // keine Segmentleiste => kein Listener
	return Object.prototype.hasOwnProperty.call(anzeige, id) ? anzeige[id] : null;
};

// ---- Die echten Bausteine ------------------------------------------------------------------------
vm.runInThisContext(read("js/map-features/location-zoom-bands.js"), { filename: "location-zoom-bands.js" });
vm.runInThisContext(read("js/map-features/label-placement.js"), { filename: "label-placement.js" });

vm.runInThisContext([
	schneide("const ZOOM_BAND_KLASSEN = [", "];"),
	schneide("const ZOOM_BAND_SPACING_KEYS = [", "];"),
	schneide("let zoomBandsState =", ";"),
	schneide("function zoomBandMaxZoom() {", "\n}"),
	schneide("function zoomBandLimits(kind) {", "\n}"),
	schneide("function zoomBandSpacingDefault(key) {", "\n}"),
	schneide("function zoomBandRowState(row, kind) {", "\n}"),
	schneide("function zoomBandsFromResolved(resolved) {", "\n}"),
	schneide("function zoomBandKonturBreite(aussenDurchmesser) {", "\n}"),
	schneide("const HINWEIS_LEER =", "Punkt.\";"),
	schneide("const ZBV_ORTE = [", "\n];"),
	schneide("let zbvZoom =", ";"),
	schneide("let zbvKnoten =", ";"),
	schneide("function zbvBandwert(kind, cls, z) {", "\n}"),
	schneide("function zbvAufbauen() {", "\n}"),
	schneide("function MK_LINE(x1, y1, x2, y2) {", "\n}"),
	schneide("function updateZoomBandVorschau() {", "\n}"),
].join("\n\n"), { filename: "wiki-sync-settlement-editor.html (Ausschnitt)" });

// Der gespeicherte Stand spielt keine Rolle -- geprüft wird, ob DERSELBE Zustand DASSELBE Bild
// ergibt. Also die Vorgabetafel, unverändert.
zoomBandsState = zoomBandsFromResolved(avesmapsResolveLocationZoomBands(null));

// ---- Fünf Aufrufe, keine Änderung dazwischen ------------------------------------------------------
const laeufe = [];
for (let i = 0; i < 5; i += 1) {
	messprotokoll.length = 0;
	updateZoomBandVorschau();
	laeufe.push({
		messungen: messprotokoll.slice(),
		zaehler: {
			sicht: anzeige.zbvSicht.textContent,
			drift: anzeige.zbvDrift.textContent,
			weg: anzeige.zbvWeg.textContent,
			max: anzeige.zbvMax.textContent,
		},
	});
}

// Vorbedingung: die Bühne muss überhaupt etwas zu tun haben. Wiche NIE ein Name aus und fiele nie
// einer weg, hinge nie eine Dekoration am Knoten und der Test bewiese nichts.
const belegt = Number(laeufe[0].zaehler.drift) + Number(laeufe[0].zaehler.weg);
assert.ok(belegt > 0,
	`Vorbedingung: auf der Vorgabestufe weicht mindestens ein Name aus oder faellt weg (gemessen: ${belegt})`);

// ---- A. 🔴 DIE REGEL: gemessen wird der NACKTE KASTEN --------------------------------------------
// Jede einzelne Messung findet am Knoten genau `zbv-name` vor -- keine Restdekoration, weder die des
// vorigen Laufs noch die einer vorigen Zoomstufe.
laeufe.forEach((lauf, i) => {
	lauf.messungen.forEach((m) => {
		assert.strictEqual(m.klasse, "zbv-name",
			`Lauf ${i + 1}: „${m.name}" wurde mit der Klasse "${m.klasse}" gemessen -- die Dekoration `
			+ "der Vorrunde haengt noch am Knoten und faelscht den Kasten");
	});
});

// ---- B. Derselbe Zustand, dasselbe Bild ----------------------------------------------------------
// Der beobachtbare Befund vom 26.08.2026: die Kastenbreiten sprangen zwischen zwei Werten hin und her.
const breitenVon = (lauf) => JSON.stringify(lauf.messungen.map((m) => [m.name, m.breite]));
laeufe.slice(1).forEach((lauf, i) => {
	assert.strictEqual(breitenVon(lauf), breitenVon(laeufe[0]),
		`Lauf ${i + 2} misst andere Kastenbreiten als Lauf 1, ohne dass sich etwas geaendert hat`);
});

// ---- C. Und damit stehen die Zähler unter der Bühne still ----------------------------------------
const ersteZaehler = JSON.stringify(laeufe[0].zaehler);
laeufe.slice(1).forEach((lauf, i) => {
	assert.strictEqual(JSON.stringify(lauf.zaehler), ersteZaehler,
		`Lauf ${i + 2}: die Zaehler unter der Buehne sprangen (${JSON.stringify(lauf.zaehler)} statt ${ersteZaehler})`);
});

console.log("OK zoombaender-vorschau-messung: 5 Laeufe, " + laeufe[0].messungen.length
	+ " Messungen je Lauf, Zaehler " + ersteZaehler);
