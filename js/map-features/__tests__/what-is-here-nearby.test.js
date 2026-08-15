// „In der Nähe" -- die Auswahlregel und die Peilung.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/what-is-here-nearby.test.js
//
// Jeder Fall hier ist an einem echten Punkt gemessen worden (15.08.2026) und ohne die Regel
// danebengegangen -- lautlos, mit einer Liste, die plausibel aussah und nichts beantwortete.

const assert = require("assert");
const { avesmapsWhatIsHereNearby, avesmapsWhatIsHereBearing } =
	require("../map-features-what-is-here-nearby.js");

// ---------------------------------------------------------------- DIE PEILUNG -------------------
// 💣 atan2(dx, dy), NICHT atan2(dy, dx): 0 Grad ist Norden, gezaehlt im Uhrzeigersinn -- dieselbe
// Zaehlweise wie ein Kompass und wie rotate(). Mit der gewohnten Reihenfolge zeigt jeder Pfeil an
// der Diagonale gespiegelt, und das faellt bei genau N/O/S/W NICHT auf. Deshalb steht hier
// ausdruecklich KEIN Test auf 0/90/180/270 allein.
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, 0, 10)), 0, "y groesser = Norden");
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, 10, 0)), 90, "x groesser = Osten");
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, 10, 10)), 45, "Nordost, nicht Suedost");
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, -10, 10)), 315, "Nordwest");

// ---------------------------------------------------------------- DIE AUSWAHL -------------------
const ort = (name, art, x, y) => ({ properties: { feature_type: "location", name, settlement_class_label: art },
	geometry: { type: "Point", coordinates: [x, y] } });
const weg = (name, art, x, y) => ({ properties: { feature_type: "path", display_name: name, feature_subtype: art },
	geometry: { type: "LineString", coordinates: [[x, y], [x, y + 0.01]] } });

const P = { x: 0, y: 0 };

// 💣 VIER namenlose Wege derselben Art. Ungefiltert stuenden am gemessenen Landpunkt genau so
// vier hintereinander (Pfad-5401, Pfad-5400, Weg-5248, Strasse-5219), bevor das erste Dorf kaeme.
const vielePfade = [
	weg("Pfad-1", "Pfad", 0, 0.2), weg("Pfad-2", "Pfad", 0, 0.4),
	weg("Pfad-3", "Pfad", 0, 0.6), weg("Pfad-4", "Pfad", 0, 0.8),
	ort("Dorf A", "Dorf", 0, 1.0), ort("Dorf B", "Dorf", 0, 1.2), ort("Dorf C", "Dorf", 0, 1.4),
];
const a = avesmapsWhatIsHereNearby(P, vielePfade);
assert.strictEqual(a.filter((z) => z.art === "Pfad").length, 1, "je Wegart hoechstens EINER");
assert.strictEqual(a.filter((z) => z.name).length, 3, "die drei Ortschaften tragen Namen");

// 💣 Ein Weg ohne echten Namen wird NUR mit seiner Art genannt. „Pfad-5401" ist eine laufende
// Nummer, keine Auskunft -- dieselbe Regel sortiert im Konfliktzentrum 2448 von 3721 Wegen aus.
assert.strictEqual(a.find((z) => z.art === "Pfad").name, "", "automatischer Name faellt weg");

// 💣 DIE ENTFERNUNGSSCHRANKE. Ohne sie stand auf Maraskan eine Reichsstrasse 534 Meilen weit weg
// in der Liste -- formal die naechste ihrer Art, praktisch auf einem anderen Kontinent.
const weitWeg = [
	ort("Nah", "Dorf", 0, 1), ort("Mittel", "Dorf", 0, 2), ort("Fern", "Dorf", 0, 3),
	weg("Reichsstrasse 3", "Reichsstrasse", 0, 100),
	weg("Pfad-9", "Pfad", 0, 2),
];
const b = avesmapsWhatIsHereNearby(P, weitWeg);
assert.ok(!b.some((z) => z.art === "Reichsstrasse"), "jenseits der Schranke faellt der Weg heraus");
assert.ok(b.some((z) => z.art === "Pfad"), "innerhalb bleibt er");

// ⚠️ Der Massstab ist die ORTSLISTE, nicht die Wegeliste. Eine Schranke, die mit dem mitwandert,
// was sie begrenzen soll, begrenzt nichts -- die Lehre vom Querfeldein-Ausstieg (14.08.2026).
// Hier: 3 x der weiteste Ort (3 Einheiten = 9 Meilen) x 1,5 = 13,5 Meilen. Der Pfad bei 6 bleibt.
assert.ok(b.filter((z) => z.name === "").every((z) => z.meilen <= 3 * 3 * 1.5), "Schranke haelt");

// Sortiert nach Entfernung, Wege und Orte gemischt.
const sortiert = b.map((z) => z.meilen);
assert.deepStrictEqual(sortiert.slice().sort((u, v) => u - v), sortiert, "nach Entfernung sortiert");

// Kein Nachbar ueberhaupt -> leere Liste, kein Absturz.
assert.deepStrictEqual(avesmapsWhatIsHereNearby(P, []), [], "leere Karte");

console.log("what-is-here-nearby: alles gruen");
