const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER ABNAHMEFALL DER MARKER-GEGENRECHNUNG, und er ist EINE Zusicherung: am Ende der
// Zoom-Animation ist die SCHEINBARE Groesse jeder Ortsklasse exakt ihre Groesse fuer die neue
// Zoomstufe. Genau das heisst „kein Sprung".
//     scheinbar = gezeichnet x Massstab = alt x faktor x massstab
//
// Owner-Entscheid 26.08.2026 (Entwurf §3.1): die Zoombaender bleiben unangetastet -- ein
// gemeinsamer Wachstumsfaktor haette 2,0 sein muessen, und der kostet 53 % RMS Bildaenderung
// (Metropole bei z0 2,35 px statt 6,65, bei z6 150 px statt 53,2). Korrigiert wird stattdessen
// waehrend der Animation.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/marker-zoom-gegenrechnung.test.js

const laden = (datei) => vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "..", datei), "utf8"), { filename: datei });
laden("zoom-uebergang.js");
laden("location-zoom-bands.js");

const KLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
const groesse = (typ, z) => AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker[typ][z];

// ---- Hineinzoomen: landet jede Klasse exakt auf ihrer Zielgroesse? ----------------------------
for (let z = 0; z < 6; z++) {
	for (const typ of KLASSEN) {
		const alt = groesse(typ, z), neu = groesse(typ, z + 1);
		if (alt === null || neu === null) { continue; }
		const massstab = 2;   // eine Zoomstufe hinein
		const faktor = avesmapsMarkerZoomSizeFactor(alt, neu, 1, massstab);
		assert.ok(Math.abs(alt * faktor * massstab - neu) < 1e-9,
			`${typ} z${z}->z${z + 1}: landet bei ${alt * faktor * massstab} statt ${neu}`);
		// Und am Anfang steht sie unveraendert da -- kein Sprung bei t = 0.
		assert.strictEqual(avesmapsMarkerZoomSizeFactor(alt, neu, 0, massstab), 1,
			`${typ} z${z}: springt schon bei t=0`);
	}
}

// ---- Herauszoomen: derselbe Vertrag, Massstab 0,5 ---------------------------------------------
for (let z = 1; z <= 6; z++) {
	for (const typ of KLASSEN) {
		const alt = groesse(typ, z), neu = groesse(typ, z - 1);
		if (alt === null || neu === null) { continue; }
		const faktor = avesmapsMarkerZoomSizeFactor(alt, neu, 1, 0.5);
		assert.ok(Math.abs(alt * faktor * 0.5 - neu) < 1e-9,
			`${typ} z${z}->z${z - 1} (raus): landet bei ${alt * faktor * 0.5} statt ${neu}`);
	}
}

// ---- Mehrere Stufen auf einmal (Pinch, setZoom) ------------------------------------------------
// ⚠️ Der Massstab ist dann 4 oder 8, nicht 2. Die Rechnung darf keine Zoomstufe voraussetzen --
// sie bekommt den echten Massstab von map.getZoomScale() herein.
for (const [von, nach] of [[2, 4], [1, 4], [6, 3]]) {
	const massstab = Math.pow(2, nach - von);
	for (const typ of KLASSEN) {
		const alt = groesse(typ, von), neu = groesse(typ, nach);
		if (alt === null || neu === null) { continue; }
		const faktor = avesmapsMarkerZoomSizeFactor(alt, neu, 1, massstab);
		assert.ok(Math.abs(alt * faktor * massstab - neu) < 1e-9,
			`${typ} z${von}->z${nach}: landet bei ${alt * faktor * massstab} statt ${neu}`);
	}
}

// ---- z6 -> z7: der schlimmste Schritt von heute -------------------------------------------------
// 🔴 Die Tafel wiederholt dort ihren z6-Wert, der echte Faktor ist also 1,0 -- das Bild skaliert
// x2 und schnappt um -50 % zurueck. Owner-Entscheid 26.08.2026: z7 erbt z6, und der Sprung faellt
// durch die Gegenrechnung weg; die Marker wachsen dort einfach nicht mehr.
for (const typ of KLASSEN) {
	const alt = groesse(typ, 6), neu = groesse(typ, 7);
	assert.strictEqual(alt, neu, typ + ": z7 erbt nicht mehr z6 -- Owner-Entscheid geaendert?");
	const faktor = avesmapsMarkerZoomSizeFactor(alt, neu, 1, 2);
	assert.ok(Math.abs(faktor - 0.5) < 1e-9, typ + ": z6->z7 rechnet nicht auf konstante Groesse");
	assert.ok(Math.abs(alt * faktor * 2 - neu) < 1e-9, typ + ": z6->z7 springt");
}

// ---- Die Faktoren muessen sich je Klasse UNTERSCHEIDEN -----------------------------------------
// 💣 Wer das hier auf EINEN gemeinsamen Faktor „vereinfacht", nimmt den Owner-Entscheid von §3.1
// zurueck und bringt den Sprung wieder mit -- genau das war die verworfene Tafel-Loesung.
const faktorenBeiZ4 = KLASSEN
	.filter((t) => groesse(t, 4) !== null && groesse(t, 5) !== null)
	.map((t) => avesmapsMarkerZoomSizeFactor(groesse(t, 4), groesse(t, 5), 1, 2));
assert.strictEqual(new Set(faktorenBeiZ4.map((f) => f.toFixed(6))).size, faktorenBeiZ4.length,
	"Alle Klassen bekommen denselben Faktor -- die Gegenrechnung ist nicht je Klasse.");
// Und sie liegen wirklich weit auseinander: Metropole ~0,707, Gebaeude ~1,053.
assert.ok(Math.abs(avesmapsMarkerZoomSizeFactor(26.6, 37.62, 1, 2) - 0.7071) < 1e-3,
	"Metropole z4->z5 rechnet nicht auf ~0,707 (der -29-%-Sprung von heute).");
assert.ok(Math.abs(avesmapsMarkerZoomSizeFactor(2.8, 5.9, 1, 2) - 1.0536) < 1e-3,
	"Gebaeude z4->z5 rechnet nicht auf ~1,054 (der +5-%-Sprung von heute, in die andere Richtung).");

// ---- Der Weg dazwischen: monoton und ohne Ueberschwingen ---------------------------------------
for (const typ of KLASSEN) {
	const alt = groesse(typ, 4), neu = groesse(typ, 5);
	if (alt === null || neu === null) { continue; }
	const ziel = neu / alt / 2;
	const steigend = ziel > 1;
	let letzter = 1;
	for (let i = 0; i <= 60; i++) {
		const e = avesmapsZoomEasing(i / 60);
		const f = avesmapsMarkerZoomSizeFactor(alt, neu, e, 2);
		assert.ok(steigend ? f >= letzter - 1e-9 : f <= letzter + 1e-9,
			typ + ": nicht monoton bei i=" + i);
		const lo = Math.min(1, ziel) - 1e-9, hi = Math.max(1, ziel) + 1e-9;
		assert.ok(f >= lo && f <= hi, typ + ": ueberschwingt bei i=" + i + " (" + f + ")");
		letzter = f;
	}
}

// ---- Schutzwerte: unbrauchbare Eingaben aendern nichts -----------------------------------------
// 🔴 Rueckgabe 1, nicht 0: ein Faktor 0 liesse den Marker verschwinden, und „Ortsmarker blenden
// nicht" ist ein Owner-Entscheid vom 24.08.2026.
assert.strictEqual(avesmapsMarkerZoomSizeFactor(0, 10, 0.5, 2), 1);
assert.strictEqual(avesmapsMarkerZoomSizeFactor(10, 0, 0.5, 2), 1);
assert.strictEqual(avesmapsMarkerZoomSizeFactor(10, 20, 0.5, 0), 1);
assert.strictEqual(avesmapsMarkerZoomSizeFactor(NaN, 20, 0.5, 2), 1);
assert.strictEqual(avesmapsMarkerZoomSizeFactor(10, 20, NaN, 2), 1, "NaN-Fortschritt = noch nichts");
assert.strictEqual(avesmapsMarkerZoomSizeFactor(null, null, 0.5, 2), 1);
// Fortschritt ausserhalb [0,1] wird geklemmt, nicht extrapoliert.
assert.strictEqual(avesmapsMarkerZoomSizeFactor(26.6, 37.62, 5, 2),
	avesmapsMarkerZoomSizeFactor(26.6, 37.62, 1, 2));
assert.strictEqual(avesmapsMarkerZoomSizeFactor(26.6, 37.62, -5, 2), 1);

// ---- Verdrahtung: der Marker-Canvas benutzt die Rechnung wirklich ------------------------------
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster
// warnt, und der naechste Leser loescht den Kommentar, um ihn gruen zu bekommen.
const quelle = fs.readFileSync(path.join(__dirname, "../map-features-location-canvas-layer.js"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
assert.ok(/avesmapsMarkerZoomSizeFactor\s*\(/.test(quelle),
	"💣 Der Marker-Canvas ruft die Gegenrechnung nicht -- die Datei allein tut nichts.");
assert.ok(/typ:\s*locationType/.test(quelle),
	"💣 Ohne die Ortsklasse am Eintrag weiss _redraw nicht, welcher Faktor gilt -- und ohne sie "
	+ "bekaeme jeder Marker denselben, was der Sinn der Sache zunichte macht.");

// 🔴 UND DER FAKTOR MUSS ANGEWANDT WERDEN, NICHT NUR GERECHNET. Eine Mutationsprobe am
// 26.08.2026 hat genau hier eine Luecke gefunden: `const k = 1;` im Zeichner liess den ganzen
// Test gruen, obwohl die Gegenrechnung damit wirkungslos war. „Die Funktion kommt vor" ist keine
// Zusicherung -- dieselbe Lehre wie bei der Quellen-Kuerzung („die Datei ist eingebunden" ist
// erfuellt, auch wenn niemand sie ruft).
assert.ok(/const k = \(zoomFaktoren && zoomFaktoren\[item\.typ\]\) \|\| 1;/.test(quelle),
	"💣 Der Zeichner leitet den Faktor nicht je Eintrag aus der Klassentafel ab.");
assert.ok(/const zoomFaktoren = this\._zoomGroessenFaktoren;/.test(quelle),
	"💣 Der Zeichner liest die Faktoren der laufenden Animation gar nicht.");
// Jede der VIER Groessen muss mit k multipliziert werden -- fehlt eine, waechst sie weiter um den
// vollen Kartenfaktor und der Marker verformt sich waehrend des Zooms (z.B. Kern korrigiert,
// Kontur nicht -> der weisse Rand wird zusehends dicker).
for (const [feld, muster] of [
	["core", /const core = item\.core \* k;/],
	["contour", /const outer = core \+ item\.contour \* k;/],
	["accentRing", /const accentRing = item\.accentRing \* k;/],
	["leyR", /const leyR = item\.leyR \* k;/],
]) {
	assert.ok(muster.test(quelle),
		"💣 Die Groesse `" + feld + "` wird im Zeichner nicht mit dem Zoomfaktor multipliziert -- "
		+ "sie waechst dann weiter um den vollen Kartenfaktor, und der Marker verformt sich "
		+ "waehrend der Animation.");
}
// 🪤 Und die alten, unskalierten Zugriffe duerfen NICHT stehengeblieben sein: `item.accentRing`
// neben `accentRing` waere ein halber Umbau, den kein anderer Test sieht.
const zeichner = quelle.slice(quelle.indexOf("\n\t_redraw() {"), quelle.indexOf("\n\t_square("));
assert.ok(zeichner.length > 100, "Der Zeichner _redraw wurde nicht gefunden -- umbenannt?");
// Gezaehlt, nicht gesucht: die EINE erlaubte Fundstelle ist die Definitionszeile, in der der
// Faktor angewandt wird. Jede weitere ist ein unskalierter Zugriff.
for (const alt of ["item.accentRing", "item.leyR", "item.core", "item.contour"]) {
	const treffer = zeichner.split(alt).length - 1;
	assert.strictEqual(treffer, 1,
		"🪤 `" + alt + "` steht " + treffer + "-mal im Zeichner statt genau einmal -- entweder ein "
		+ "unskalierter Zugriff ist stehengeblieben (halber Umbau) oder die Skalierung fehlt ganz.");
}

// ⭐ Der Notausgang muss da sein: eine sichtbare Aenderung ohne Weg zurueck ist keine.
const rohQuelle = fs.readFileSync(path.join(__dirname, "../map-features-location-canvas-layer.js"), "utf8");
assert.ok(/markerscale/.test(rohQuelle),
	"⭐ ?markerscale=0 fehlt -- ohne Notausgang laesst sich das Bild nicht ohne Deploy vergleichen "
	+ "und ein Fehlgriff nicht abstellen.");
assert.ok(/if \(!LOCATION_MARKER_ZOOM_SCALE_ENABLED\) \{ return; \}/.test(quelle),
	"💣 Der Schalter ist definiert, aber die Schleife fragt ihn nicht -- ein Notausgang, den "
	+ "niemand liest, ist keiner.");

// ⭐ Die Sparbremse: nicht jedes Bild neu zeichnen, sondern nur wenn sich ein halbes Pixel bewegt.
// 🔴 ABER DAS LETZTE BILD IMMER -- dort sitzt die sprungfreie Landung, der ganze Sinn der Sache.
assert.ok(/const letztesBild = t >= 1;/.test(quelle) && /if \(letztesBild \|\|/.test(quelle),
	"🔴 Die Sparbremse laesst das letzte Bild nicht durch -- dann landet der Marker doch wieder "
	+ "neben seiner Zielgroesse, und zwar genau um den uebersprungenen Rest.");

// 🔴 Die Formentscheidungen duerfen NICHT mitskaliert werden: eine Raute, die waehrend der
// Animation zum Kreis wird, waere ein Formwechsel mitten in der Bewegung.
assert.ok(!/isDiamond \* k|isCapital \* k/.test(quelle),
	"🔴 Eine Formentscheidung wird mit dem Groessenfaktor multipliziert -- das ist keine Groesse.");
assert.ok(/_zoomGroessenFaktoren\s*=\s*null/.test(quelle),
	"💣 Die Faktoren muessen am Ende der Animation zurueckgesetzt werden, sonst zeichnet jeder "
	+ "spaetere Pan die Marker in Zwischengroesse.");
assert.ok(/cancelAnimationFrame/.test(quelle),
	"💣 Ohne Abbruch laeuft die Schleife nach einem abgebrochenen Zoom weiter und zeichnet gegen "
	+ "eine Animation, die es nicht mehr gibt.");
// Der Ruecksetzer gehoert in die METHODE _reset (laeuft an moveend/zoomend/viewreset/resize),
// nicht irgendwohin.
// 🪤 Nicht per indexOf("_reset()") schneiden: `this._reset();` steht als AUFRUF schon weiter oben,
// und `_redraw()` sogar noch davor (in setActiveLocationMarker) -- der Ausschnitt waere leer, und
// der Test meldete einen Fehler, den es nicht gibt. Geschnitten wird an der Methoden-DEFINITION
// bis zur naechsten.
const resetStart = quelle.indexOf("\n\t_reset() {");
assert.ok(resetStart > 0, "Die Methode _reset() wurde nicht gefunden -- umbenannt?");
const resetEnde = quelle.indexOf("\n\t_onMove(", resetStart);
assert.ok(resetEnde > resetStart, "Die Methode nach _reset() wurde nicht gefunden -- umsortiert?");
const resetBlock = quelle.slice(resetStart, resetEnde);
assert.ok(/_zoomGroessenFaktoren\s*=\s*null/.test(resetBlock),
	"💣 Der Ruecksetzer steht nicht in _reset -- dort laeuft er an zoomend UND an jedem moveend, "
	+ "und genau das braucht es.");
assert.ok(/cancelAnimationFrame/.test(resetBlock),
	"💣 _reset bricht die laufende Bildschleife nicht ab -- sie zeichnete dann gegen eine "
	+ "Animation weiter, die es nicht mehr gibt.");

console.log("marker-zoom-gegenrechnung.test.js: alle Zusicherungen erfuellt");
