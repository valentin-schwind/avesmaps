const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER ABNAHMEFALL. Die Vorgaben muessen das Bild vom 24.08.2026 reproduzieren -- sonst aendert
// eine Auslieferung, die „nichts aendern" soll, die ganze Karte.
//
// ⚠️ EINE Ausnahme, und sie ist im Entwurf §5.5 begruendet: die SCHRIFTGROESSE kann es nicht,
// weil heute jedes Label seine eigene Grundgroesse traegt (12-50, Vorgabe 18). Die Vorgabe ist die
// echte Formel bei Grundgroesse 18 -- und genau die steht hier als ZEUGE, nicht als Quelle. Wird
// sie je „angepasst", damit der Test gruen wird, ist der Test wertlos.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-vorgabe.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);

// ---- A. Die Deckkraft je Ebene, Ziffer fuer Ziffer aus css/features/ecosystem-layer.css --------
// 💣 Sie ist NICHT eine Zahl fuer alle. Wer hier eine einzige Zahl einsetzt, zieht die vier Ebenen
// zusammen -- und die 0,16 der derographischen Behaelter ist Absicht, keine Nachlaessigkeit.
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("derographisch", "region"), 0.16);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "gebirge"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("klima", "polar"), 0.30);

// ---- B. Die Groessenkurve = die echte Formel bei Grundgroesse 18 -------------------------------
// Der ABGESCHAFFTE Rechenweg, als Zeuge. VISUAL_MAX_ZOOM_LEVEL = 5, dazu der Zuschlag ueber Zoom 5
// vom 23.08.2026 („nach unten hin etwas groessere schriftart", LABEL_SIZE_DEEP_ZOOM_STEP = 0.08).
const VISUAL_MAX = 5;
const TIEF_SCHRITT = 0.08;
const alteGroesse = (z) => {
	const ratio = Math.max(0, Math.min(1, z / VISUAL_MAX));
	const ueber = Math.max(0, Math.min(2, z - VISUAL_MAX));
	return Math.round(18 * (0.5 + ratio * 0.5) * (1 + ueber * TIEF_SCHRITT));
};
for (let z = 0; z <= 8; z += 1) {
	assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", z), alteGroesse(z),
		`Zoom ${z} reproduziert die heutige Kurve`);
}
assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(alteGroesse), [9, 11, 13, 14, 16, 18, 19, 21, 21],
	"und das sind die Zahlen, die live gemessen wurden");

// ---- C. Band und die zwei kleinen Vorgaben ----------------------------------------------------
// 🔴 SEIT DEM 24.08.2026 IST DIE VORGABE NICHT MEHR UNIFORM. Hier stand `{ ab: 0, bis: 7 }` für
// jede Art -- am Livebestand gemessen weichen davon **933 von 939** Beschriftungen ab. Ein Wald
// erscheint typischerweise ab z4, ein Gebirge ab z2, eine Wüstenoase ab z5.
//
// ⚠️ Die Umstellung bewegt KEINE bestehende Beschriftung: alle 939 tragen ihr eigenes `min_zoom`,
// und die fünf ohne `max_zoom` gehören Arten, deren Median dort ohnehin 7 ist. Sie wirkt erst auf
// Beschriftungen, die von hier an entstehen.
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("wald"), { ab: 4, bis: 7 },
	"Wald: der gemessene Median, nicht mehr z0");
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("gebirge"), { ab: 2, bis: 7 },
	"Gebirge ab z2");
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("wuestenoase"), { ab: 5, bis: 7 },
	"Wüstenoase ab z5 -- alle 9 stehen dort, die einzige Art mit 100 % Einigkeit");
// 🔴 Und die einzige Art, deren OBERES Ende abweicht: ein Kontinentname verschwindet beim
// Hineinzoomen. Genau dafür hat eine Landschaftsbeschriftung zwei Enden.
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("kontinent"), { ab: 0, bis: 3 },
	"Kontinent bis z3");

// 🔴 DIE ZWEI GIPFEL-ZEILEN SIND KEIN MEDIAN MEHR, SONDERN EIN OWNER-ENTSCHEID -- und sie GELTEN
// (27.08.2026: „berggipfel und vulkane sollen ab Z4 erscheinen"). Fuer jede andere Art raet diese
// Tafel nur; fuer Gipfel schlaegt sie das eigene Band des Labels (avesmapsLabelImBand).
// 💣 Wer hier „Alle uebernehmen" im Darstellungs-Fenster drueberschreibt, verschiebt damit eine
// Entscheidung und nicht bloss eine Marke. Live gemessen 27.08.2026 lagen die 73 Gipfel auf z2 (2),
// z3 (30), z4 (19), z5 (17) und z6 (5) -- ein Median haette den Vulkan auf z3 zurueckgezogen.
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("berggipfel"), { ab: 4, bis: 7 },
	"Berggipfel ab z4");
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("vulkan"), { ab: 4, bis: 7 },
	"🔴 und der Vulkan GENAUSO -- er stand als einziger auf z3 und ist die eine geaenderte Ziffer");

// ⚠️ Eine Art OHNE eigene Zeile faellt auf den Grundwert zurueck -- die Tafel ist eine Ergaenzung,
// kein Ersatz. Ohne diesen Rueckfall haette eine neue Flaechenart gar keine Vorgabe.
assert.deepStrictEqual(avesmapsEcosystemDisplayBand("gibtesnochnicht"), { ab: 0, bis: 7 },
	"unbekannte Art: der Grundwert");

// 💣 Die Tafel ist ein SCHNAPPSCHUSS vom 24.08.2026 und veraltet, sobald die Editoren
// weiterarbeiten. Sie deckt genau die Arten ab, die damals im Bestand vorkamen -- wer sie
// „aufraeumt", nimmt der Messung ihren einzigen Beleg.
assert.strictEqual(Object.keys(AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART).length, 28,
	"28 Arten, so viele trug der Bestand bei der Messung");

// 🔴 NUR das Band. `prio` hatte in 939 Beschriftungen genau 4 Ausreisser -- sein Median IST der
// Grundwert, ihn je Art einzutragen taeuschte eine Messung vor, die nichts gemessen hat.
Object.keys(AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART).forEach((art) => {
	const zeile = AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART[art];
	Object.keys(zeile).forEach((feld) => {
		assert.ok(feld === "ab" || feld === "bis",
			art + " traegt das Feld `" + feld + "` -- die Messung deckt nur `ab` und `bis`");
	});
});
assert.strictEqual(avesmapsEcosystemDisplayVorgabe("wald").curveMax, 1);
assert.strictEqual(avesmapsEcosystemDisplayVorgabe("wald").prio, 3);

// 🔴 z8 ERBT z7 -- die Karte kennt Stufe 8 nicht (maxZoom: 7 in js/app/bootstrap.js).
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 8), true, "z8 erbt z7");

// ---- D. Farben kommen von AUSSEN ---------------------------------------------------------------
// 🔴 Ohne Uebersteuerung reicht das Modul den Token durch. Es kennt keine Farbe -- laege sie auch
// hier, gaebe es sie zweimal (AGENTS.md §12, Entwurf §8).
assert.strictEqual(avesmapsEcosystemDisplayFarbe("wald", "#bfeec8"), "#bfeec8");
assert.strictEqual(avesmapsEcosystemDisplayFlaechenTon("vegetation", "wald", "#3f6b2c"), "#3f6b2c");
const quelle = fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8");
const ohneKommentare = quelle.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/#[0-9a-fA-F]{6}/.test(ohneKommentare), "im Modul steht KEIN Farbwert (AGENTS.md §12)");

// ---- E. Eine Uebersteuerung schlaegt die Vorgabe ----------------------------------------------
avesmapsEcosystemDisplayInstall({
	farbe: { wald: "#112233" },
	deckkraft: { "vegetation:wald": 0.4 },
	groesse: { wald: [5, 5, 5, 5, 5, 5, 5, 5, 5] },
	vorgabe: { wald: { ab: 2, bis: 4, curveMax: 3, prio: 5 } },
});
assert.strictEqual(avesmapsEcosystemDisplayFarbe("wald", "#bfeec8"), "#112233");
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.4);
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 3), 5);
assert.strictEqual(avesmapsEcosystemDisplayVorgabe("wald").prio, 5);
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 1), false, "vor dem Band unsichtbar");
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 3), true, "im Band sichtbar");
assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", 6), false, "hinter dem Band unsichtbar");
// ⚠️ Eine andere Art bleibt bei der Vorgabe -- die Uebersteuerung gilt je Art, nicht global.
assert.strictEqual(avesmapsEcosystemDisplayGroesse("steppe", 3), 14, "steppe bleibt bei der Vorgabe");

// ---- F. Die globale Deckkraft ueberschreibt, LOESCHT aber nicht --------------------------------
// 💣 Ein Haekchen ist keine Datenaenderung. Wer es abnimmt, bekommt seine Arbeit zurueck.
avesmapsEcosystemDisplayInstall({
	deckkraft: { "vegetation:wald": 0.15 },
	global: { vegetation: { an: true, wert: 0.9 } },
});
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.9, "global gewinnt");
avesmapsEcosystemDisplayInstall({
	deckkraft: { "vegetation:wald": 0.15 },
	global: { vegetation: { an: false, wert: 0.9 } },
});
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.15,
	"abgehakt kommt der Zeilenwert UNVERAENDERT zurueck");
// 🔴 „Global" heisst FUER DIESE EBENE. Eine andere Ebene bleibt unberuehrt.
avesmapsEcosystemDisplayInstall({ global: { vegetation: { an: true, wert: 0.9 } } });
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("derographisch", "region"), 0.16,
	"Derographie bleibt bei 0,16 -- global gilt je Ebene");

// ---- G. „aus" ---------------------------------------------------------------------------------
avesmapsEcosystemDisplayInstall({ vorgabe: { wald: { ab: 0, bis: -1 } } });
for (let z = 0; z <= 8; z += 1) {
	assert.strictEqual(avesmapsEcosystemDisplaySichtbar("wald", z), false, `„aus" gilt auch auf z${z}`);
}

// ---- H. Kaputte Uebersteuerung faellt auf die Vorgabe zurueck ----------------------------------
// ⚠️ Die Karte darf an einem kaputten Einstellungswert nicht haengenbleiben.
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.72);
avesmapsEcosystemDisplayInstall("unsinn");
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 5), 18);
avesmapsEcosystemDisplayInstall({ groesse: { wald: "keine Zeile" } });
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 5), 18, "eine kaputte Zeile gilt als nichts");
avesmapsEcosystemDisplayInstall({ groesse: { wald: [9, 11] } });
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 5), 18,
	"eine zu kurze Zeile faellt an ihrer Luecke auf die Vorgabe zurueck");

// ---- I. Das Modul haengt in index.html, und zwar VOR seinen Lesern -----------------------------
// 💣 Ein gruener Test beweist nichts ohne Verdrahtung. Und die Reihenfolge ist ein Vertrag:
// map-features-labels.js ruft die Funktionen zur Laufzeit, aber `const` auf Dateiebene sind in
// einem klassischen Script nicht gehoistet -- laedt das Modul spaeter, ist es beim ersten Zeichnen
// undefined.
// 🪤 Gesucht wird das SKRIPT-TAG, nicht der blosse Dateiname: ein Kommentar, der die Nachbardatei
// erwaehnt, steht sonst „vor" ihr und die Reihenfolgeprobe misst Prosa statt Ladeordnung. Genau das
// ist beim ersten Lauf passiert -- der erklaerende Kommentar ueber dem neuen Tag nennt
// map-features-labels.js beim Namen.
const seite = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
const tag = (datei) => seite.indexOf(`<script src="js/map-features/${datei}"></script>`);
const posModul = tag("ecosystem-display.js");
const posLabels = tag("map-features-labels.js");
assert.ok(posModul >= 0, "das Modul haengt als Skript in index.html");
assert.ok(posLabels >= 0, "und map-features-labels.js ebenfalls");
assert.ok(posModul < posLabels, "das Modul laedt VOR map-features-labels.js");

console.log("ecosystem-display-vorgabe: alle Zusicherungen gruen");
