// „Rechnen -> Kurven" muss die Karte NACHZEICHNEN.
//
// 🔴 DER BEFUND (07.09.2026, Owner: „setzen sich kurvenlabels immer wieder zurueck zu normalen
// labels ... Rechnen -> Kurven hat aber keinen effekt"). Der Sammellauf schreibt den
// Zwischenspeicher der Beschriftungskurven serverseitig korrekt -- nachgemessen am Dump vom
// 04.09.2026: alle 82 eingeschalteten Regionen lassen sich fehlerfrei rechnen. Nur erfaehrt die
// KARTE es nie: `runCurveLabels` im Landschaften-Editor schrieb eine Statuszeile und verwarf seinen
// eigenen Vorschau-Speicher, mehr nicht. Der Editor ist ein iframe ueber der lebenden Karte, deren
// `labelMarkers` ihre alten Objekte behalten; die Kartennutzlast wird nach einem Speichern nicht neu
// geholt, und der Lauf bumpt `ecosystem_revision`, nicht `map_revision` -- der Live-Abgleich sieht
// also ebenfalls nichts. Ergebnis: der Knopf wirkt tot, und ein Label, das seine Kurve bei einer
// Geometrieaenderung verloren hat, bleibt waagerecht, bis jemand die ganze Seite neu laedt.
//
// 💣 DIE TRAGENDE EIGENSCHAFT IST „EINMAL", NICHT „UEBERHAUPT". `avesmapsCurveSettingAufLabelsAnwenden`
// zeichnet je Aufruf nach (Platzierung neu rechnen, Marker nachziehen, Kollisionsdurchgang) -- das ist
// fuer EINE gespeicherte Region richtig und fuer 82 Regionen des Sammellaufs untragbar: die
// Platzierung rechnet dabei jedes Mal ALLE Kurvenlabels neu. Der Sammelweg setzt deshalb erst alle
// Daten und zeichnet DANN einmal nach.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");
let checks = 0;

// map-features-labels.js laesst sich nicht als Ganzes laden (sie fasst beim Laden `map` an, siehe
// curve-label-normalize.test.js). Geschnitten wird deshalb je Funktion -- zeilenendenneutral, weil
// die Arbeitskopie CRLF traegt und die CI LF (AGENTS.md §9).
function rumpfVon(name) {
	const von = quelle.indexOf("function " + name + "(");
	assert.ok(von >= 0, name + " steht nicht in map-features-labels.js");
	const bis = quelle.indexOf("\n}", von);
	assert.ok(bis > von, name + " hat kein Ende");
	return quelle.slice(von, bis + 2);
}

// Ein Label-Eintrag, wie ihn labelMarkers traegt.
function eintragBauen(publicId, regionId, curveLine = null) {
	return {
		label: { publicId, text: publicId, curveLine, curveMax: 1, __region: regionId },
		marker: { setIcon() { this.iconGesetzt = (this.iconGesetzt || 0) + 1; } },
	};
}

// Die vier Funktionen zusammen ausfuehren -- MIT ihren echten Rumpfen, nicht nachgebaut.
// Die freien Bezeichner kommen als Parameter herein.
function bauen(eintraege) {
	const zaehler = { platzierungen: 0, sync: [], kollision: 0 };
	const avesmapsLabelEntriesForEcosystemRegion = (regionPublicId) =>
		eintraege.filter((e) => e.label.__region === String(regionPublicId));
	// Der ECHTE Leser waere readLabelCurveLine; hier genuegt seine Zusage: [x, y] -> [lat, lng],
	// und `null` fuer eine unbrauchbare Linie.
	const readLabelCurveLine = (props) => {
		const roh = props && props.curve_label_line;
		if (!Array.isArray(roh) || roh.length < 2) { return null; }
		return roh.map(([x, y]) => [y, x]);
	};
	const createLabelIcon = () => "ICON";
	const avesmapsKurvenlabelPlatzierungen = () => { zaehler.platzierungen += 1; };
	const syncLabelMarkerVisibility = (eintrag) => { zaehler.sync.push(eintrag.label.publicId); };
	const scheduleLabelCollisionResolution = () => { zaehler.kollision += 1; };

	const quelltext = [
		rumpfVon("avesmapsCurveDatenAnLabels"),
		rumpfVon("avesmapsCurveNachzeichnen"),
		rumpfVon("avesmapsCurveSettingAufLabelsAnwenden"),
		rumpfVon("avesmapsCurveBaselinesAufLabelsAnwenden"),
	].join("\n");

	const fabrik = new Function(
		"avesmapsLabelEntriesForEcosystemRegion", "readLabelCurveLine", "createLabelIcon",
		"avesmapsKurvenlabelPlatzierungen", "syncLabelMarkerVisibility", "scheduleLabelCollisionResolution",
		quelltext + "; return { einzeln: avesmapsCurveSettingAufLabelsAnwenden, sammel: avesmapsCurveBaselinesAufLabelsAnwenden };"
	);
	return {
		zaehler,
		...fabrik(
			avesmapsLabelEntriesForEcosystemRegion, readLabelCurveLine, createLabelIcon,
			avesmapsKurvenlabelPlatzierungen, syncLabelMarkerVisibility, scheduleLabelCollisionResolution
		),
	};
}

// ---- Der Sammelweg bringt die Kurven wirklich an die Labels --------------------------------------
{
	const a = eintragBauen("Trollzacken", "r1");
	const b = eintragBauen("Koschberge", "r2");
	const { sammel, zaehler } = bauen([a, b]);
	const beruehrt = sammel({
		r1: { line: [[10, 20], [30, 40], [50, 60]], max: 2 },
		r2: { line: [[1, 2], [3, 4]], max: 1 },
	});

	assert.strictEqual(beruehrt, 2, "beide Labels muessen ihre Kurve bekommen haben");
	// [x, y] aus der Ablage -> [lat, lng] fuer Leaflet. Wer den Tausch vergisst, spiegelt jede Kurve
	// an der Diagonalen -- und bei N/O/S/W faellt das nicht auf (AGENTS.md §5).
	assert.deepStrictEqual(a.label.curveLine, [[20, 10], [40, 30], [60, 50]],
		"die Kurve kommt ungedreht oder gar nicht an");
	assert.strictEqual(a.label.curveMax, 2, "die Anzahl aus der Ablage wird nicht uebernommen");
	assert.strictEqual(b.label.curveMax, 1);
	checks += 4;

	// 💣 DIE PERFORMANCE-ZUSICHERUNG: EIN Nachzeichnen fuer BEIDE Regionen, nicht eines je Region.
	// avesmapsKurvenlabelPlatzierungen rechnet jedes Mal ALLE Kurvenlabels neu; 82 Aufrufe waeren
	// der Grund, den Sammelweg wieder auszubauen.
	assert.strictEqual(zaehler.platzierungen, 1,
		"die Platzierung wird " + zaehler.platzierungen + "x gerechnet -- erwartet: genau einmal");
	assert.strictEqual(zaehler.kollision, 1,
		"der Kollisionsdurchgang laeuft " + zaehler.kollision + "x -- erwartet: genau einmal");
	// Die Marker dagegen einzeln -- jeder geaenderte Eintrag braucht seinen eigenen Riegel-Abgleich.
	assert.deepStrictEqual(zaehler.sync.sort(), ["Koschberge", "Trollzacken"],
		"jeder beruehrte Marker muss einzeln nachgezogen werden");
	checks += 3;
}

// ---- Der Sammelweg ENTFERNT nie eine Kurve -------------------------------------------------------
// 🔴 Die Ablage nennt nur Regionen, deren Kurvenbeschriftung AN ist und deren Kurve sich rechnen
// liess. Eine Region, die dort fehlt, kann beides heissen -- „ausgeschaltet" oder „nicht rechenbar".
// Aus dem Fehlen auf „aus" zu schliessen naehme einem Label seine Kurve, weil der Server sie gerade
// nicht liefern konnte. Das AUSschalten hat seinen eigenen, ausdruecklichen Weg
// (avesmapsCurveSettingAufLabelsAnwenden mit an === false) und laeuft schon beim Speichern.
{
	const bleibt = eintragBauen("Finsterkamm", "r9", [[1, 1], [2, 2]]);
	const { sammel } = bauen([bleibt]);
	sammel({ r1: { line: [[10, 20], [30, 40]], max: 1 } });
	assert.deepStrictEqual(bleibt.label.curveLine, [[1, 1], [2, 2]],
		"eine Region, die in der Ablage fehlt, darf ihre Kurve nicht verlieren");
	checks += 1;
}

// ---- Eine unbrauchbare Linie loescht die vorhandene nicht ----------------------------------------
{
	const e = eintragBauen("Rakulahoehen", "r1", [[7, 7], [8, 8]]);
	const { sammel, zaehler } = bauen([e]);
	const beruehrt = sammel({ r1: { line: [[1, 2]], max: 1 } });   // ein Punkt ist keine Kurve
	assert.deepStrictEqual(e.label.curveLine, [[7, 7], [8, 8]],
		"eine zu kurze Linie darf die bestehende Kurve nicht ueberschreiben");
	// 💣 UND SIE DARF DAS LABEL GAR NICHT ERST ANFASSEN. Ohne den Riegel im Sammelweg laeuft die
	// Region durch avesmapsCurveDatenAnLabels, ihr Label zaehlt als „beruehrt", und ein
	// Nachzeichnen ueber die GANZE Karte wird ausgeloest -- fuer eine Kurve, die es nicht gibt.
	// Die Kurve selbst bliebe dabei heil (readLabelCurveLine faengt die kurze Linie ein zweites
	// Mal ab); geprueft werden muss deshalb der Durchgang, nicht nur die Kurve. Genau diese
	// Mutation ist zuerst durch die Probe geschluepft.
	assert.strictEqual(beruehrt, 0, "eine unbrauchbare Linie darf kein Label als geaendert melden");
	assert.strictEqual(zaehler.platzierungen, 0,
		"eine unbrauchbare Linie loest ein Nachzeichnen der ganzen Karte aus");
	checks += 3;
}

// ---- Der Einzelweg bleibt unveraendert -----------------------------------------------------------
// Er ist der Weg des SPEICHERNS (Flaechendialog, Beschriftungsdialog, „Labelkurve aktualisieren")
// und muss weiterhin ausschalten koennen.
{
	const e = eintragBauen("Ingvaltal", "r1", [[5, 5], [6, 6]]);
	const { einzeln, zaehler } = bauen([e]);
	assert.strictEqual(einzeln("r1", false, 1, null), 1);
	assert.strictEqual(e.label.curveLine, null, "das AUSschalten entfernt die Kurve nicht");
	assert.strictEqual(zaehler.platzierungen, 1, "auch der Einzelweg zeichnet nach");
	assert.strictEqual(zaehler.kollision, 1);
	checks += 4;
}

// ---- Ohne beruehrte Labels wird NICHT nachgezeichnet ---------------------------------------------
// Eine Region ohne Beschriftung darf keinen Durchgang ausloesen -- der Sammellauf traefe sonst bei
// jedem Aufruf die ganze Karte, obwohl sich nichts geaendert hat.
{
	const { sammel, einzeln, zaehler } = bauen([]);
	assert.strictEqual(sammel({ r1: { line: [[1, 2], [3, 4]], max: 1 } }), 0);
	assert.strictEqual(einzeln("r1", true, 1, [[1, 2], [3, 4]]), 0);
	assert.strictEqual(zaehler.platzierungen, 0, "ohne beruehrtes Label darf nichts nachgezeichnet werden");
	assert.strictEqual(zaehler.kollision, 0);
	checks += 4;
}

// ---- UND DIE VERDRAHTUNG: der Sammellauf im Editor ruft ihn auch ---------------------------------
// 💣 Ohne diese Zusicherung ist alles darueber gruen und der Knopf trotzdem tot -- genau der Zustand,
// der gemeldet wurde. Geprueft wird der Rumpf von `runCurveLabels`, nicht die ganze Datei: ein
// Vorkommen irgendwo im Editor beweist nicht, dass DIESER Knopf es tut.
{
	const editor = fs.readFileSync(path.join(wurzel, "html", "landschaften-editor.html"), "utf8");
	const von = editor.indexOf("async function runCurveLabels(");
	assert.ok(von >= 0, "runCurveLabels steht nicht mehr im Landschaften-Editor");
	const bis = editor.indexOf("\n}", von);
	assert.ok(bis > von, "runCurveLabels hat kein Ende");
	const lauf = editor.slice(von, bis + 2);

	assert.ok(/curveKurvenAufDieKarteBringen\s*\(/.test(lauf),
		"der Sammellauf bringt seine Kurven nicht auf die Karte -- der Knopf bleibt wirkungslos");
	checks += 1;

	// Und der Bringer selbst: er holt die Ablage und reicht sie ins Elternfenster.
	const bVon = editor.indexOf("async function curveKurvenAufDieKarteBringen(");
	assert.ok(bVon >= 0, "curveKurvenAufDieKarteBringen fehlt");
	// ⚠️ `\n}` und nicht `\n\t}`: die Funktion steht auf oberster Ebene des Skripts, ihr Ende ist
	// also unindentiert -- ein `\n\t}` traefe schon die schliessende Klammer des ersten if-Blocks
	// und schnitte den Rumpf vor dem Abruf ab.
	const bBis = editor.indexOf("\n}", bVon);
	assert.ok(bBis > bVon, "curveKurvenAufDieKarteBringen hat kein Ende");
	const bringer = editor.slice(bVon, bBis + 2);
	assert.ok(/"baselines"|'baselines'/.test(bringer),
		"die frischen Kurven werden nicht geholt (action: \"baselines\")");
	assert.ok(bringer.includes("avesmapsCurveBaselinesAufLabelsAnwenden"),
		"die geholten Kurven werden nicht an das Elternfenster gereicht");
	// 🔴 Der SAMMELweg, nicht der Einzelweg: 82 Einzelaufrufe waeren 82 volle Neuberechnungen.
	assert.ok(!bringer.includes("avesmapsCurveSettingAufLabelsAnwenden("),
		"der Bringer nimmt den Einzelweg -- das rechnet die Platzierung je Region einmal neu");
	checks += 4;
}

console.log("kurvenlauf-zeichnet-karte-nach: " + checks + " checks passed");
