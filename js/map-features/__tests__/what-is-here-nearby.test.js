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

// Fix-Runde 1, Befund 1: die Berechnung ruft jetzt getPathTitleName (js/map-features/
// map-features-path-domain.js) statt eines eigenen Regex -- die Funktion lebt aber nur im
// BROWSER (reines <script>-Global, kein module.exports), unter Node gibt es sie nicht. Fuer
// die Faelle unten, die die FILTERUNG selbst pruefen, speisen wir eine Attrappe ein, die dieselben
// drei Muell-Muster kennt wie die echte shouldShowRoutePathDisplayName (js/routing/route-node.js):
// nackter Subtyp, "<Subtyp>-<n>", generisch "<Wort>-<Zahl>" ("Meer-468", wo der Praefix vom
// Subtyp "Seeweg" abweicht -- genau der Fall, an dem eine subtyp-genaue Regel scheitert). Die
// Attrappe ist ein Test-Stellvertreter fuer die ANBINDUNG, nicht die Produktionslogik selbst --
// die bleibt allein in path-domain.js/route-node.js.
global.getPathTitleName = function (path) {
	const wiki = String(path?.properties?.wiki_path?.name || "").trim();
	if (wiki) {
		return wiki;
	}
	const roh = String(path?.properties?.display_name || "").trim();
	const subtyp = String(path?.properties?.feature_subtype || "");
	if (!roh || roh === subtyp || /^\S+-\d+$/.test(roh)) {
		return "";
	}
	return roh;
};

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

// -------------------------------------- FIX-RUNDE 1, BEFUND 1: DIE NAMENSREGEL IM DETAIL --------
// Die vier Faelle aus der Pruefung, ueber die eingespeiste Attrappe (s.o.).
const namensFaelle = [
	weg("Alte Handelsstrasse", "Strasse", 0, 1),    // echter Name -- bleibt
	weg("Pfad-5401", "Pfad", 0, 2),                  // "<Subtyp>-<n>" -- faellt weg
	weg("Meer-468", "Seeweg", 0, 3),                 // Praefix "Meer" != Subtyp "Seeweg" -- faellt trotzdem weg
	weg("Flussweg", "Flussweg", 0, 4),                // nackter Subtyp als "Name" -- faellt weg
];
const n = avesmapsWhatIsHereNearby(P, namensFaelle);
assert.strictEqual(n.find((z) => z.art === "Strasse").name, "Alte Handelsstrasse", "echter Name bleibt");
assert.strictEqual(n.find((z) => z.art === "Pfad").name, "", "<Subtyp>-<n> faellt weg (Pfad-5401)");
assert.strictEqual(n.find((z) => z.art === "Seeweg").name, "", "generisches <Wort>-<Zahl> faellt weg (Meer-468)");
assert.strictEqual(n.find((z) => z.art === "Flussweg").name, "", "nackter Subtyp faellt weg (Flussweg)");

// -------------------------------------- FIX-RUNDE 2: DIE TYPREGEL-ANBINDUNG ----------------------
// Ohne eingespeiste Attrappe ist `typeof getPathTypeLabel === "function"` unter Node IMMER falsch --
// der bewachte Zweig bliebe im Test niemals betreten, und ein Tippfehler im Funktionsnamen, ein
// falsches Argument oder eine vertauschte Reihenfolge fiele nie auf: der Test bliebe grün, waehrend
// live "Strasse" statt "Straße" stuende. Genau dieser Fehler ist in map-features-path-domain.js:48-53
// als bereits einmal passiert dokumentiert. Die Attrappe veraendert den Subtyp ERKENNBAR, damit die
// Zusicherung beweist, dass die Wegzeile durch sie hindurchging -- und dass die Ortszeile es NICHT
// tut (settlement_class_label ist schon Prosa, siehe Befund 2).
global.getPathTypeLabel = function (subtype) {
	return "GEPRUEFT:" + subtype;
};
const typRegel = avesmapsWhatIsHereNearby(
	P, [weg("Beispielweg", "Strasse", 0, 1), ort("Beispieldorf", "Dorf", 0, 2)]);
// .find(...) statt .every(...) auf einer moeglicherweise leeren Menge -- die Falle aus Fix-Runde 1:
// ein leerer Treffer wirft hier sofort (Zugriff auf .art von undefined), statt eine leere Menge
// stillschweigend als "bestanden" durchzuwinken.
assert.strictEqual(typRegel.find((z) => z.name === "Beispielweg").art, "GEPRUEFT:Strasse",
	"die Wegzeile lief durch getPathTypeLabel");
assert.strictEqual(typRegel.find((z) => z.name === "Beispieldorf").art, "Dorf",
	"die Ortszeile bleibt UNVERAENDERT -- sie geht nie durch getPathTypeLabel");
// Sofort wieder abraeumen: die weitWeg-Pruefung unten vergleicht `art` gegen den ROHEN Subtyp
// (kein getPathTypeLabel gemockt) -- bliebe die Attrappe aktiv, stuende dort "GEPRUEFT:Pfad" statt
// "Pfad" und die Zusicherung risse grundlos.
delete global.getPathTypeLabel;

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

// -------------------------------------- FIX-RUNDE 1, BEFUND 1: DER RUECKFALL OHNE FUNKTION -------
// Attrappe wieder entfernen: das hier ist ausdruecklich der Zustand OHNE getPathTitleName, wie ihn
// die Browser-Datei nie sieht (dort ist die Funktion laengst geladen, index.html Zeile 3144 vor
// Zeile 3241), aber dieser Node-Test standardmaessig hat. Der Waechter degradiert dann auf den
// ROHEN Namen -- KEIN eigener Regex (das war genau der Fehler, den Befund 1 behebt). Deshalb bleibt
// hier auch ein Muell-Name wie "Pfad-77" ungefiltert stehen; das ist beabsichtigt.
delete global.getPathTitleName;
const ohneWaechter = avesmapsWhatIsHereNearby(P, [weg("Pfad-77", "Pfad", 0, 1)]);
assert.strictEqual(ohneWaechter[0].name, "Pfad-77", "ohne getPathTitleName bleibt der rohe Name stehen");

console.log("what-is-here-nearby: alles gruen");
