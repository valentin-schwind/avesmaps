// Tests for the way editor's travel model (js/pages/wege-editor-model.js).
//
// 🔴 THE POINT OF THIS FILE: the browser draws the curve, the server prices the route, and both
// implement the Leistungskilometer. The reference points below are the SAME ones
// api/_internal/routing/__tests__/terrain-factor-test.php asserts. If one side changes and the
// other does not, this goes red -- instead of the editor quietly drawing a model nothing computes.
//
// Run: node js/pages/__tests__/wege-editor-model.test.js

"use strict";

const assert = require("assert");
const M = require("../wege-editor-model.js");

let checks = 0;
function ok(label, actual, expected, epsilon) {
	checks++;
	const eps = epsilon === undefined ? 1e-9 : epsilon;
	assert.ok(Math.abs(actual - expected) <= eps,
		`${label}: erwartet ${expected}, bekommen ${actual}`);
}

// ---- 1. The rule of thumb, i.e. every number the dialog text promises --------------------------
ok("eben -> 1,0", M.wpFactorForGradientPercent(0), 1.0);
ok("5 % Steigung -> 1,5", M.wpFactorForGradientPercent(5), 1.5);
ok("10 % Steigung -> 2,0", M.wpFactorForGradientPercent(10), 2.0);
ok("20 % Steigung -> 3,0", M.wpFactorForGradientPercent(20), 3.0);
ok("30 % Steigung -> 4,0 (Deckel)", M.wpFactorForGradientPercent(30), 4.0);
ok("45 % Steigung bleibt am Deckel", M.wpFactorForGradientPercent(45), 4.0);

// ---- 2. Descent is asymmetric, and the 20 % edge is a STEP -------------------------------------
ok("10 % Gefälle ist frei", M.wpFactorForGradientPercent(-10), 1.0);
ok("genau 20 % Gefälle ist noch frei", M.wpFactorForGradientPercent(-20), 1.0);
// 💣 Immediately past the threshold the WHOLE descent counts -- the curve jumps, it does not ramp.
ok("knapp über 20 % Gefälle springt auf 1+0,2·1000/150", M.wpFactorForGradientPercent(-20.0001),
	1 + (1000 * 0.200001) / 150, 1e-4);
assert.ok(M.wpFactorForGradientPercent(-20.0001) - M.wpFactorForGradientPercent(-20) > 1.3,
	"die Kante bei 20 % Gefälle muss ein Sprung sein, keine Rampe");
ok("30 % Gefälle -> 3,0", M.wpFactorForGradientPercent(-30), 3.0);
ok("45 % Gefälle erreicht den Deckel", M.wpFactorForGradientPercent(-45), 4.0);
ok("60 % Gefälle bleibt am Deckel", M.wpFactorForGradientPercent(-60), 4.0);

// Nothing is ever faster than the level -- the defensible stance for a planner.
for (let g = -60; g <= 60; g += 0.5) {
	assert.ok(M.wpFactorForGradientPercent(g) >= 1.0,
		`Faktor bei ${g} % darf nie unter 1,0 fallen`);
	checks++;
}

// ---- 3. wpLeistungsFactor: „no data" and „measured and level" are NOT the same -----------------
ok("null Aufstieg -> 1,0 (keine Daten)", M.wpLeistungsFactor(null, 0, 5), 1.0);
ok("null steiler Abstieg -> 1,0 (keine Daten)", M.wpLeistungsFactor(0, null, 5), 1.0);
ok("gemessen und eben -> exakt 1,0", M.wpLeistungsFactor(0, 0, 5), 1.0);
ok("entartete Strecke -> 1,0", M.wpLeistungsFactor(500, 0, 0), 1.0);
// 1 Karteneinheit = 3 Meilen: 300 Schritt Anstieg auf 1 Einheit sind 300/100 = 3 Leistungsmeilen
// Zuschlag auf 3 Meilen -> Faktor 2,0.
ok("300 Schritt auf 1 Karteneinheit -> 2,0", M.wpLeistungsFactor(300, 0, 1), 2.0);
ok("Deckel greift", M.wpLeistungsFactor(3000, 0, 1), 4.0);

// 💣 DER UNGEDECKELTE PFAD IST DER, DEN DIE EICHUNG BRAUCHT.
ok("ungedeckelt läuft über 4,0 hinaus", M.wpLeistungsFactor(3000, 0, 1, { capped: false }), 11.0);

// ---- 4. Additivität: genau der Mittelungsfehler, vor dem der Auftrag warnt ---------------------
// Ohne Deckel ist der längengewichtete Mittelwert über die Stücke BIT-IDENTISCH mit dem Wert des
// ganzen Weges. Das ist die Eigenschaft, auf der die Eichung steht -- und der Deckel bricht sie.
{
	const pieces = [
		{ ascent: 120, steepDescent: 0, length: 0.4 },
		{ ascent: 900, steepDescent: 60, length: 0.6 }
	];
	const gesamtAnstieg = pieces.reduce((s, p) => s + p.ascent, 0);
	const gesamtSteil = pieces.reduce((s, p) => s + p.steepDescent, 0);
	const gesamtLaenge = pieces.reduce((s, p) => s + p.length, 0);

	const ganzerWeg = M.wpLeistungsFactor(gesamtAnstieg, gesamtSteil, gesamtLaenge, { capped: false });
	const gewichtet = pieces.reduce((s, p) =>
		s + p.length * M.wpLeistungsFactor(p.ascent, p.steepDescent, p.length, { capped: false }), 0) / gesamtLaenge;
	ok("ungedeckelt: längengewichtetes Mittel == ganzer Weg", gewichtet, ganzerWeg, 1e-12);

	// Mit Deckel driftet es -- deshalb rechnet die Eichung ungedeckelt.
	const ganzGedeckelt = M.wpLeistungsFactor(gesamtAnstieg, gesamtSteil, gesamtLaenge);
	const gewGedeckelt = pieces.reduce((s, p) =>
		s + p.length * M.wpLeistungsFactor(p.ascent, p.steepDescent, p.length), 0) / gesamtLaenge;
	assert.ok(Math.abs(gewGedeckelt - ganzGedeckelt) > 0.01,
		"mit Deckel MUSS es auseinanderlaufen -- sonst prüft der Test nichts");
	checks++;

	// 💣 UND DER FEHLER, DEN DER AUFTRAG BEZIFFERT: wer GESCHWINDIGKEITEN mittelt statt Faktoren,
	// verfehlt das Ziel. Am Zweisegment-Beispiel sind das hier über 30 %.
	const v0 = 5.0;
	const richtig = gesamtLaenge / pieces.reduce((s, p) =>
		s + p.length * M.wpLeistungsFactor(p.ascent, p.steepDescent, p.length, { capped: false }) / v0, 0);
	const falsch = pieces.reduce((s, p) =>
		s + p.length * (v0 / M.wpLeistungsFactor(p.ascent, p.steepDescent, p.length, { capped: false })), 0) / gesamtLaenge;
	assert.ok(falsch > richtig * 1.3,
		`gemittelte Geschwindigkeit muss deutlich danebenliegen (richtig ${richtig}, falsch ${falsch})`);
	checks++;
}

// ---- 5. Beide Richtungen aus DENSELBEN Summen --------------------------------------------------
{
	// [Anstieg, Abstieg, steiler Anstieg, steiler Abstieg] je Stück, in Speicherrichtung.
	const profile = [[300, 0, 0, 0], [0, 450, 0, 200]];
	const both = M.wpBothDirectionFactors(profile, 1.0, { capped: false });
	// hinwärts: Anstieg 300 + steiler Abstieg 200
	ok("hinwärts nutzt Anstieg + steilen Abstieg", both.forward,
		1 + (300 / 100 + 200 / 150) / 3, 1e-12);
	// rückwärts: Abstieg 450 wird zum Anstieg, steiler Anstieg 0 wird zum steilen Abstieg
	ok("rückwärts nutzt Abstieg + steilen Anstieg", both.backward,
		1 + (450 / 100 + 0 / 150) / 3, 1e-12);
	assert.notStrictEqual(both.forward, both.backward,
		"hin und zurück dürfen nicht zufällig gleich sein, sonst prüft der Test die Paarung nicht");
	checks++;
}

// 💣 Das Formatwächter-Verhalten: ein Zweierpaar ist eine Zeile VOR dem Modell und heißt „keine
// Daten", niemals „eben".
assert.strictEqual(M.wpProfileSums([[10, 20]]), null, 'Zweierpaare muessen als "keine Daten" gelten');
assert.strictEqual(M.wpBothDirectionFactors([[10, 20]], 1.0), null, 'auch ueber beide Richtungen');
assert.strictEqual(M.wpProfileSums("keine Liste"), null, 'Unsinn ist keine Datenlage');
checks += 3;

// ---- 6. Die Kurve: Aufsummieren der Differenzen, Start frei --------------------------------------
{
	const profile = [[300, 0, 0, 0], [0, 450, 0, 200], [120, 120, 0, 0]];
	const curve = M.wpProfileCurve(profile, [1, 2, 1]);
	assert.strictEqual(curve.length, 4, "n Stücke ergeben n+1 Punkte");
	ok("Start ist frei gewählt und liegt auf 0", curve[0].y, 0);
	ok("nach Stück 1: +300", curve[1].y, 300);
	ok("nach Stück 2: 300-450", curve[2].y, -150);
	ok("Stück mit Anstieg == Abstieg ist netto flach", curve[3].y, -150);
	ok("x folgt den Stücklängen", curve[3].x, 4);
	// Ohne Längen: gleichmäßige Verteilung.
	ok("ohne Längen wird gleichmäßig verteilt", M.wpProfileCurve(profile)[3].x, 3);
	assert.deepStrictEqual(M.wpProfileCurve([[1, 2]]), [], "Vor-Modell-Zeilen ergeben keine Kurve");
	checks++;
}

// ---- 7. Stücklängen aus der Geometrie ------------------------------------------------------------
{
	const lengths = M.wpPieceLengths([[0, 0], [3, 4], [3, 14]]);
	assert.strictEqual(lengths.length, 2, "n Punkte ergeben n-1 Stücke");
	ok("3-4-5-Dreieck", lengths[0], 5);
	ok("senkrechtes Stück", lengths[1], 10);
	assert.deepStrictEqual(M.wpPieceLengths([[0, 0]]), [], "ein einzelner Punkt hat keine Länge");
	assert.deepStrictEqual(M.wpPieceLengths(null), [], "keine Geometrie, keine Längen");
	checks += 2;
}

// ---- 8. Die Geschwindigkeitstabelle deckt jeden Land-Wegtyp ab -----------------------------------
{
	Object.keys(M.WP_SPEEDS).forEach((key) => {
		M.WP_LAND_TYPES.forEach((type) => {
			assert.ok(typeof M.WP_SPEEDS[key][type.key] === "number" && M.WP_SPEEDS[key][type.key] > 0,
				`${key} braucht eine Geschwindigkeit für ${type.key}`);
			checks++;
		});
	});
	// Wasser gehört NICHT hierher: der Steigungsfaktor ist eine Landregel.
	Object.keys(M.WP_SPEEDS).forEach((key) => {
		assert.ok(!("Flussweg" in M.WP_SPEEDS[key]) && !("Seeweg" in M.WP_SPEEDS[key]),
			`${key} darf keinen Wasserweg tragen -- der Steigungsfaktor gilt dort nicht`);
		checks++;
	});
}

// ---- 9. Gruppierung: ein Wegname steht für viele Segmente -----------------------------------
// 💣 Der Fall, der die Liste unbrauchbar machte: „Reichsstraße 1" hat 26 Segmente (gemessen,
// docs/konfliktmanagement-design.md §6a). Ungruppiert waren das 26 gleich aussehende Zeilen.
{
	const r1 = [];
	for (let i = 0; i < 26; i++) {
		r1.push({
			public_id: "r1-" + i, name: "Reichsstraße 1", feature_subtype: "Reichsstrasse",
			// Absichtlich RÜCKWÄRTS eingespeist: die Sortierung muss sie ordnen, nicht die Eingabe.
			wiki_path: { wiki_key: "wiki:reichsstrasse-1" }, bbox: [100 - i, 50, 104 - i, 55]
		});
	}
	const rest = [
		{ public_id: "pf-1", name: "Pfad-0148", feature_subtype: "Pfad", wiki_path: null, bbox: [10, 10, 13, 14] },
		{ public_id: "gp-1", name: "Koschberge-Pass", feature_subtype: "Gebirgspass", wiki_path: null, bbox: [200, 80, 203, 84] },
		{ public_id: "gp-2", name: "Koschberge-Pass", feature_subtype: "Gebirgspass", wiki_path: null, bbox: [198, 80, 201, 84] }
	];

	const groups = M.wpGroupWays(r1.concat(rest));
	assert.strictEqual(groups.length, 3, "26+1+2 Segmente ergeben DREI Wege");
	checks++;

	const strasse = groups.find(g => g.name === "Reichsstraße 1");
	assert.strictEqual(strasse.segments.length, 26, "alle 26 Segmente unter EINEM Eintrag");
	assert.strictEqual(strasse.key, "wiki:wiki:reichsstrasse-1", "mit Wiki-Weg wird danach gruppiert");
	checks += 2;

	// ⭐ Geografisch geordnet, nicht in Eingabereihenfolge -- sonst bedeutet „Abschnitt 3" nichts.
	const xs = strasse.segments.map(s => s.bbox[0]);
	assert.deepStrictEqual(xs, [...xs].sort((a, b) => a - b), "Segmente laufen von West nach Ost");
	assert.strictEqual(strasse.segments[0].public_id, "r1-25", "das westlichste zuerst");
	checks += 2;

	// Ohne Wiki-Weg trägt Name+Typ die Gruppe.
	const pass = groups.find(g => g.name === "Koschberge-Pass");
	assert.strictEqual(pass.segments.length, 2, "gleichnamige Wege ohne Wiki-Bezug bilden auch eine Gruppe");
	assert.strictEqual(pass.key, "name:Gebirgspass:Koschberge-Pass", "Schlüssel aus Typ UND Name");
	assert.strictEqual(pass.segments[0].public_id, "gp-2", "auch hier geografisch sortiert");
	checks += 3;

	// 💣 Gleicher Name, ANDERER Typ = NICHT derselbe Weg.
	const gemischt = M.wpGroupWays([
		{ public_id: "a", name: "Alte Straße", feature_subtype: "Strasse", wiki_path: null, bbox: [0,0,1,1] },
		{ public_id: "b", name: "Alte Straße", feature_subtype: "Pfad", wiki_path: null, bbox: [0,0,1,1] }
	]);
	assert.strictEqual(gemischt.length, 2, "gleicher Name bei verschiedenem Typ bleibt getrennt");
	checks++;

	// Ein einzelner Weg ist eine Gruppe mit einem Segment -- die Anzeige macht daraus eine Zeile.
	assert.strictEqual(groups.find(g => g.name === "Pfad-0148").segments.length, 1, "Einzelweg");
	assert.deepStrictEqual(M.wpGroupWays([]), [], "kein Bestand, keine Gruppen");
	assert.deepStrictEqual(M.wpGroupWays(null), [], "und null ist auch kein Bestand");
	checks += 3;
}

// ---- 10. Die grobe Ausdehnung ist eine SCHRANKE, keine Länge --------------------------------
{
	// 3-4-5-Dreieck als Umgebungsrechteck, × 3 Meilen je Karteneinheit.
	ok("Diagonale × 3", M.wpRoughMiles({ bbox: [0, 0, 3, 4] }), 15);
	assert.strictEqual(M.wpRoughMiles({ bbox: [5, 5, 5, 5] }), 0, "ein Punkt hat keine Ausdehnung");
	assert.strictEqual(M.wpRoughMiles({}), null, "ohne Rechteck keine Zahl");
	assert.strictEqual(M.wpRoughMiles(null), null, "und ohne Weg erst recht nicht");
	assert.strictEqual(M.wpRoughMiles({ bbox: [0, 0] }), null, "ein halbes Rechteck ist keins");
	checks += 4;

	// 💣 Die eigentliche Aussage: sie darf die echte Länge NIE überschätzen. Ein Weg, der im
	// Rechteck schwingt, ist länger als dessen Diagonale.
	const geschwungen = [[0, 0], [3, 4], [0, 8]];
	const echt = M.wpPieceLengths(geschwungen).reduce((s, l) => s + l, 0) * M.WP_MEILEN_PER_MAPUNIT;
	const grob = M.wpRoughMiles({ bbox: [0, 0, 3, 8] });
	assert.ok(grob < echt, `die Schranke (${grob}) muss unter der echten Länge (${echt}) liegen`);
	checks++;
}

console.log(`wege-editor-model: ${checks} Prüfungen bestanden.`);
