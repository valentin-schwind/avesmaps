const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Kurvenfeinheiten im Fenster „Darstellung" (Entwurf §5.6).
//
// 🔴 Die Vorgaben werden AUS DEM PRODUKTIONSMODUL gelesen, nicht abgeschrieben. Eine zweite Tabelle
// waere genau die Divergenz, gegen die dieser ganze Umbau argumentiert -- und diese Zahlen sind an
// einem Abnahmebild gemessen worden, nicht geraten.
//
// 💣 UND DIE UEBERSTEUERUNG MUSS BEI JEDEM VERBRAUCHER ANKOMMEN. Es sind zwei: die Passung
// (avesmapsCurveLabelFit) und die Ausweichweite im Canvas-Overlay. Waere nur einer gebunden, haette
// das Fenster einen Regler, der nichts bewirkt -- dieselbe Lehre wie bei der Verkehrsmittel-Sperre,
// wo eine Regel zwei von vier Erzeugern band.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/darstellung-kurvenwerte.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");

vm.runInThisContext(lies("js/map-features/ecosystem-display.js"), { filename: "ecosystem-display.js" });
vm.runInThisContext(lies("js/map-features/curved-label-layout.js"), { filename: "curved-label-layout.js" });
vm.runInThisContext(lies("js/map-features/curve-label-fit.js"), { filename: "curve-label-fit.js" });

// ---- A. Die echte Tafel ist da ------------------------------------------------------------------
assert.strictEqual(typeof AVESMAPS_CURVE_LABEL_DEFAULTS, "object", "die Tafel ist da");
assert.strictEqual(AVESMAPS_CURVE_LABEL_DEFAULTS.maxTurnDeg, 30);
assert.strictEqual(AVESMAPS_CURVE_LABEL_DEFAULTS.trackingPct, 20);
assert.strictEqual(AVESMAPS_CURVE_LABEL_DEFAULTS.dodgePx, 6);

// ---- B. Der Leser mischt Vorgabe und Uebersteuerung ---------------------------------------------
avesmapsEcosystemDisplayInstall(null);
assert.deepStrictEqual(avesmapsEcosystemDisplayKurve(), AVESMAPS_CURVE_LABEL_DEFAULTS,
	"ohne Uebersteuerung ist die wirkende Tafel die Vorgabe");

avesmapsEcosystemDisplayInstall({ kurve: { maxTurnDeg: 12 } });
assert.strictEqual(avesmapsEcosystemDisplayKurve().maxTurnDeg, 12, "ein gesetzter Wert gilt");
assert.strictEqual(avesmapsEcosystemDisplayKurve().trackingPct, 20, "die uebrigen bleiben Vorgabe");

// 🔴 Ein FREMDER Schluessel aus der Datenbank erfindet keine neue Stellschraube.
avesmapsEcosystemDisplayInstall({ kurve: { erfunden: 99 } });
assert.strictEqual(avesmapsEcosystemDisplayKurve().erfunden, undefined,
	"was die Vorgabetafel nicht kennt, kommt nicht durch");
// ⚠️ Und ein halb getipptes Feld (NaN, Text) faellt auf die Vorgabe zurueck, statt die Passung in
// die Irre zu schicken -- eine NaN-Schwelle laesst JEDEN Vergleich fehlschlagen.
avesmapsEcosystemDisplayInstall({ kurve: { minGapEm: "zwei", maxTurnDeg: NaN } });
assert.strictEqual(avesmapsEcosystemDisplayKurve().minGapEm, AVESMAPS_CURVE_LABEL_DEFAULTS.minGapEm);
assert.strictEqual(avesmapsEcosystemDisplayKurve().maxTurnDeg, AVESMAPS_CURVE_LABEL_DEFAULTS.maxTurnDeg);

// 💣 Und der Zwischenspeicher darf eine neue Tafel nicht ueberdauern -- sonst wirkt „Speichern"
// erst nach einem Neuladen, und das sieht aus wie „hat nichts getan".
avesmapsEcosystemDisplayInstall({ kurve: { trackingPct: 45 } });
assert.strictEqual(avesmapsEcosystemDisplayKurve().trackingPct, 45,
	"eine zweite Install-Runde kommt durch -- der Cache wird geleert");

// ---- C. 💣 VERBRAUCHER 1: die Passung liest den Leser AUSGEFUEHRT -------------------------------
// Eine gerade Linie, ein kurzer Name -- und dann eine Untergrenze, die die Schrift nicht mehr
// schrumpfen laesst. Faellt `minFontPx` durch, aendert sich das Ergebnis sichtbar.
const linie = [];
for (let i = 0; i <= 40; i += 1) { linie.push({ x: i * 5, y: 100 }); }
const zeichen = "Drachensteine".split("");
const breiten = zeichen.map(() => 30);   // absichtlich zu breit -> die Passung muss verkleinern

avesmapsEcosystemDisplayInstall(null);
const ohne = avesmapsCurveLabelFit(linie, zeichen, breiten, 22, 1);
assert.ok(ohne && ohne.fenster && ohne.fenster.length === 1, "die Passung liefert ein Fenster");

avesmapsEcosystemDisplayInstall({ kurve: { minFontPx: 21 } });
const mit = avesmapsCurveLabelFit(linie, zeichen, breiten, 22, 1);
assert.ok(mit && mit.fenster && mit.fenster.length === 1, "auch mit Untergrenze kommt ein Fenster");
assert.ok(mit.fenster[0].fontSize >= 21 - 1e-9,
	"die uebersteuerte Untergrenze WIRKT: " + mit.fenster[0].fontSize + " pt");
assert.ok(mit.fenster[0].fontSize > ohne.fenster[0].fontSize,
	"und sie aendert das Ergebnis gegenueber der Vorgabe ("
	+ ohne.fenster[0].fontSize + " -> " + mit.fenster[0].fontSize + ")");

// ---- D. 💣 VERBRAUCHER 2: die Ausweichweite geht durch denselben Leser ---------------------------
// ⚠️ Das Canvas-Overlay laesst sich hier nicht ausfuehren (es braucht Leaflet und einen Kontext).
// Gemessen wird deshalb die VERDRAHTUNG: JEDE Nennung der Konstante in einer Verbraucherdatei muss
// den Leser-Vorbehalt ueber sich haben. Ohne diese Zusicherung waere „Ausweichweg" der eine Regler,
// der nichts tut -- und das faellt niemandem auf, weil sechs Pixel niemand nachmisst.
["js/map-features/curve-label-fit.js", "js/map-features/map-features-path-label-canvas-overlay.js"]
	.forEach((datei) => {
		const quelle = lies(datei);
		let von = quelle.indexOf("AVESMAPS_CURVE_LABEL_DEFAULTS");
		while (von !== -1) {
			const zeile = quelle.slice(quelle.lastIndexOf("\n", von) + 1, quelle.indexOf("\n", von));
			const davor = quelle.slice(Math.max(0, von - 400), von);
			const erlaubt = /^const AVESMAPS_CURVE_LABEL_DEFAULTS = \{/.test(zeile)   // die Definition
				|| /^\s*\*/.test(zeile)                                              // ein Kommentar
				|| /typeof avesmapsEcosystemDisplayKurve === "function"/.test(davor); // der Rueckfall
			assert.ok(erlaubt,
				datei + " liest AVESMAPS_CURVE_LABEL_DEFAULTS an der Uebersteuerung VORBEI: "
				+ zeile.trim());
			von = quelle.indexOf("AVESMAPS_CURVE_LABEL_DEFAULTS", von + 1);
		}
	});

// ---- E. Das Fenster schreibt keine der Zahlen ab -------------------------------------------------
const fenster = lies("html/landschaften-editor.html");
assert.ok(/AVESMAPS_CURVE_LABEL_DEFAULTS/.test(fenster), "das Fenster liest die echte Tafel");
assert.ok(!/trackingMaxPerGapEm:\s*0\.6/.test(fenster), "keine abgeschriebene Vorgabe im Fenster");
assert.ok(!/calmAnchorWeight:\s*2\.5/.test(fenster), "auch nicht die Ankergewichtung");

// ⚠️ ZWEI der Werte wirken in der Vorschau NICHT sichtbar (Mindestabstand zweier Namen,
// Ausweichweg): sie brauchen einen Fall, den ein einzelner Name auf einer freien Flaeche nicht
// herstellt. Das gehoert ausgesprochen, statt einen Regler zu zeigen, der scheinbar nichts tut.
assert.ok(/wirk(t|en) in der Vorschau nicht/i.test(fenster),
	"das Fenster sagt, welche zwei Werte man in der Vorschau nicht sieht");

// ---- F. 💣 KEIN WERT OHNE REGLER, KEIN REGLER OHNE WERT -----------------------------------------
// Die Beschriftungen und Spannen stehen im Fenster (ein Schluessel allein laesst sich nicht
// zeichnen) -- aber die MENGE kommt aus der Tafel. Ohne diese Zusicherung faellt beim naechsten
// neuen Wert genau eine Zeile aus dem Fenster, und niemand merkt es: ein fehlender Regler sieht aus
// wie ein Fenster, das eben so viele Zeilen hat.
//
// 🔴 Und umgekehrt: der Prototyp bot fuenf Regler an, die dem SERVER gehoeren (Glaettungsgrad,
// Randvereinfachung, Stuetzpunktabstand, Teilflaechen-Schwelle, Polynomgrad). Die stehen in keiner
// Browsertafel -- ein Regler dafuer waere ein Regler, der nichts bewirkt.
const vonF = fenster.indexOf("const ECO_DISPLAY_KURVENFELDER = {");
assert.ok(vonF >= 0, "die Feldbeschreibung steht im Fenster");
const rumpfF = fenster.slice(vonF, fenster.indexOf(String.fromCharCode(10) + "};", vonF));
const beschrieben = (rumpfF.match(/^	(\w+):/gm) || []).map((t) => t.trim().replace(":", ""));
const erwartet = Object.keys(AVESMAPS_CURVE_LABEL_DEFAULTS);

erwartet.forEach((feld) => {
	assert.ok(beschrieben.indexOf(feld) >= 0,
		"der Wert `" + feld + "` aus der Tafel hat KEIN Bedienelement");
});
beschrieben.forEach((feld) => {
	assert.ok(erwartet.indexOf(feld) >= 0,
		"das Bedienelement `" + feld + "` gehoert zu keinem Wert der Tafel -- es bewirkt nichts");
});
assert.strictEqual(beschrieben.length, erwartet.length,
	"gleich viele: " + beschrieben.length + " Bedienelemente gegen " + erwartet.length + " Werte");

// ---- G. Die Vorschau holt die Kurve, sie rechnet sie nicht ---------------------------------------
// 🔴 Die Chordal-Axis steht in api/_internal/app/curve-labels.php. Eine zweite Fassung im Browser
// waere die dritte im Projekt -- und die Vorschau zeigte etwas, das die Karte so nie zeichnet.
assert.ok(/action: "baselines"/.test(fenster), "die Vorschau holt die gerechneten Kurven");
assert.ok(/curve-labels-run\.php/.test(fenster), "vom bestehenden Endpunkt, ohne einen zweiten");
// 🪤 Und sie laedt NICHT den Prototyp.
// 🪤 Gesucht wird das SCRIPT-Element, nicht das Wort: der Kommentar an der Vorschau erklaert
// genau diese Regel und traegt den Dateinamen -- ein Test, der ihn trifft, prueft seine eigene
// Prosa. Derselbe Fehler steckte schon in der map-labels.css-Zusicherung nebenan.
assert.ok(fenster.indexOf('src="docs/kurvenlabel-pipeline') < 0
	&& fenster.indexOf('src="/docs/kurvenlabel-pipeline') < 0,
	"docs/kurvenlabel-pipeline.js ist der PROTOTYP und gehoert nicht ins Fenster");
assert.ok(/avesmapsCurveLabelFit/.test(fenster) && /layoutGlyphsAlong/.test(fenster),
	"eingepasst wird mit den Produktionsmodulen");
// ⚠️ Und die muessen auf der Seite ueberhaupt geladen sein -- sonst ist der Aufruf ein ReferenceError.
["curved-label-layout.js", "curve-label-fit.js"].forEach((datei) => {
	assert.ok(fenster.indexOf('<script src="/js/map-features/' + datei + '"') >= 0,
		datei + " ist auf der Editorseite geladen");
});

// ---- H. 🪤 Der Sammellauf verwirft die geholten Kurven -------------------------------------------
// Die Vorschau haelt sie fest (EIN Abruf je Seitenaufruf, damit ein Reiterwechsel nicht jedesmal
// ans Netz geht). Nach „Kurven rechnen" sind sie veraltet -- und eine Vorschau, die die ALTE Kurve
// zeigt, ist schlimmer als keine: sie sieht richtig aus.
const vonRun = fenster.indexOf("CURVE_RUN_API,");
assert.ok(vonRun >= 0, "der Sammellauf steht in der Datei");
const rumpfRun = fenster.slice(vonRun, fenster.indexOf("flashStatus(\"Kurven rechnen: \"", vonRun));
assert.ok(/ecoDisplayKurvenLinien = null/.test(rumpfRun),
	"nach einem Sammellauf werden die geholten Kurven verworfen");

console.log("darstellung-kurvenwerte: alle Zusicherungen gruen");
