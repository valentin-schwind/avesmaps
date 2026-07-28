// Landschaften — mehrere Höhenfelder zu EINEM Gelände (V8).
//
// Die ganze Regel:
//
//     W(x,y) = EIN Gipfelfenster über ALLE Gipfel ALLER Flächen
//     h(x,y) = Σ über alle Flächen F:  Feld_F(x, y, W(x,y))
//
// Mehr nicht. Kein Enthaltensein-Test, kein Baum, keine Eltern-Kind-Fensterung.
//
// 🔴 OWNER-ENTSCHEID 2026-07-28, wörtlich: „sie brauchen sich nicht zu schachteln/zu fenstern. die
// überlappung und verschmelzung zu einem zug ist ok." Eine frühere Fassung des Plans baute einen
// Enthaltensein-Wald mit Eltern-Kind-Fensterung. Der ist gestrichen. Wer ihn wiedererfindet, baut
// einen Sonderfall für ein Problem, das an zwei anderen Stellen bereits gelöst ist:
//
//  1. **Die Überlappung türmt nicht.** Jede Fläche läuft an ihrem eigenen Rand auf null aus
//     (Fußhöhe-0-Invariante). Wo zwei sich überlappen, sind BEIDE nahe ihrem Fuß; die Summe füllt
//     dort den Sattel, statt zwei Gipfelhöhen zu stapeln. Das ist die Überblendung zweier Züge, und
//     sie entsteht von selbst.
//  2. **Der Turm entstünde nur an einer Stelle:** wenn der Gipfelpunkt der einen Fläche in der
//     anderen liegt. Dagegen wirken zwei Dinge aus dem Feldmodul, beide GLOBAL gerechnet — das
//     Gipfelfenster löscht dort das Rauschen, und die Radiusklemme auf 0,72 × dem Gipfelabstand
//     sorgt dafür, dass kein Gipfelbuckel bis zu einem anderen Gipfel reicht. Zusammen heisst das:
//     jeder Gipfel liest genau seine eigene Zahl, egal wie viele Flächen sich dort überlagern.
//
// Wie GUT die Überblendung aussieht, hängt am Überlappungsstreifen, nicht an dieser Rechnung:
// schmal → sichtbare Kerbe zwischen zwei Bergen, breit → ein Zug. Das ist eine Zeichenanleitung für
// den Editor (oekosystem-editor-verhalten.md §5), keine Rechenregel.

// 💣 EIN GIPFEL, EIN BUCKEL. Überlappen sich zwei Flächen, liegt ein Gipfel im Überlappungsstreifen
// in BEIDEN -- und würde in beiden zu einem Buckel. Dann summieren sich seine eigenen 3.000 zu 6.000,
// hier genau so gemessen, bevor diese Zuordnung da war. Das ist dieselbe Doppelzählung, die §0 als
// „zweite Positionsliste" verbietet, nur in Zahlen statt in Zeilen.
//
// Zugeteilt wird an die KLEINSTE enthaltende Fläche, bei Gleichstand an die kleinere `public_id`.
// Zwei Gründe, und der zweite ist der wichtigere:
//
//  - Die kleinste ist die genaueste Aussage darüber, wo der Gipfel liegt; ihr näherer Rand klemmt
//    seinen Buckelradius enger, was einem benannten Teilkamm besser entspricht als die weite Hülle
//    des umgebenden Gebirges.
//  - Sie ist eine EIGENSCHAFT der Geometrie, nicht der Ladereihenfolge. „Die erste, die ihn enthält"
//    wäre einfacher, hinge aber daran, in welcher Reihenfolge die Flächen ankamen -- und damit läge
//    dasselbe Gelände nach einem Neuladen anders. Genau die Sorte stiller Verschiebung, gegen die
//    §4.2 den Determinismus verlangt.
function assignEcosystemPeaksToAreas(areas, peaks) {
	const sizes = new Map();
	areas.forEach((area) => {
		const geometry = area?.geometry_geojson || area?.geometry || null;
		sizes.set(area, geometry ? ecosystemGeometryArea(geometry) : Infinity);
	});

	const assignment = new Map(areas.map((area) => [area, []]));
	peaks.forEach((peak) => {
		const x = Number(peak?.x);
		const y = Number(peak?.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return;
		}
		let winner = null;
		areas.forEach((area) => {
			const geometry = area?.geometry_geojson || area?.geometry || null;
			if (!geometry || !pointInGeometry([x, y], geometry)) {
				return;
			}
			if (!winner) {
				winner = area;
				return;
			}
			const size = sizes.get(area);
			const best = sizes.get(winner);
			if (size < best || (size === best && String(area?.public_id || "") < String(winner?.public_id || ""))) {
				winner = area;
			}
		});
		if (winner) {
			assignment.get(winner).push(peak);
		}
	});

	return assignment;
}

// `peaks` ist die FLACHE Liste aller Gipfel (aus den geladenen Labels), nicht nach Flächen sortiert.
//
// Die Trennung, auf der alles ruht: **alle** Gipfel klemmen und fenstern (deshalb bekommt das Fenster
// die volle Liste), aber **je einer** wird nur in **einer** Fläche zum Buckel.
function buildEcosystemHeightStack(areas, peaks) {
	const list = Array.isArray(areas) ? areas : [];
	const allPeaks = Array.isArray(peaks) ? peaks : [];
	// EIN Fenster für alle. Es trägt auch die Gipfeltrennung (`separation`), aus der die Radiusklemme
	// kommt -- je Fläche gerechnet wäre beides wertlos, weil der Nachbargipfel dann nicht mitzählt.
	const peakWindow = buildEcosystemPeakWindow(allPeaks);
	const assignment = assignEcosystemPeaksToAreas(list, allPeaks);

	const fields = [];
	const areaIdsByField = [];
	list.forEach((area) => {
		const field = buildEcosystemHeightField(area, assignment.get(area) || [], peakWindow, {});
		// Flächen ohne eigenen Gipfel liefern kein Feld. Sie gar nicht erst aufzunehmen spart in der
		// Malschleife eine Abfrage je Pixel je Fläche.
		// 💣 `fields.length` ist deshalb NICHT `areas.length` -- wer über `areas` indiziert, greift daneben.
		if (field && Array.isArray(field.peakBumps) && field.peakBumps.length > 0) {
			fields.push(field);
			areaIdsByField.push(String(area?.public_id || ""));
		}
	});

	return { peakWindow, fields, areaIdsByField };
}

// 💣 Indizierte Schleife, kein for..of: das läuft in der Malschleife hunderttausendfach, und jede
// Iterator-Allokation kostet dort mehr als die eigentliche Rechnung (im Prototyp gemessen: 47 ms
// statt 8,6 -- :576).
function sampleEcosystemHeightStack(stack, x, y) {
	if (!stack || !Array.isArray(stack.fields) || stack.fields.length === 0) {
		return 0;
	}
	// Das Fenster EINMAL je Abfragepunkt, nicht je Fläche.
	const noiseWindow = stack.peakWindow ? stack.peakWindow.sample(x, y) : 1;
	const fields = stack.fields;
	let height = 0;
	for (let i = 0; i < fields.length; i++) {
		height += sampleEcosystemHeightField(fields[i], x, y, noiseWindow);
	}

	return height;
}

// Welche Flächen enthalten diesen Punkt? Die Invalidierung braucht es (Aufgabe 9): eine
// Gipfeländerung macht nur die enthaltenden Felder ungültig, nicht alle.
function ecosystemHeightFieldsAtPoint(stack, x, y) {
	if (!stack || !Array.isArray(stack.fields)) {
		return [];
	}
	const hits = [];
	stack.fields.forEach((field, index) => {
		if (field.geometry && pointInGeometry([x, y], field.geometry)) {
			hits.push(stack.areaIdsByField[index]);
		}
	});

	return hits;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		buildEcosystemHeightStack,
		sampleEcosystemHeightStack,
		ecosystemHeightFieldsAtPoint,
	};
}
