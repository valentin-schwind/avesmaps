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
// Welche Art wird wie dargestellt. Absichtlich kurz: was hier NICHT steht, bekommt das additive
// Rauschen -- das ist die richtige Vorgabe für eine Art, über die noch niemand nachgedacht hat.
const ECOSYSTEM_TERRAIN_METHOD_BY_TYPE = {
	// 💣 GEBIRGE STEHT WIEDER AUF ADDITIV. „Exponential Slope Weighting" ist gebaut, getestet und
	// bleibt verfügbar -- es ist nur nicht bezahlbar: die zentrale Differenz kostet VIER zusätzliche
	// Feldabfragen je Rasterpunkt, und am echten Viewport des Owners (2560x1271) stieg die Malzeit auf
	// **248,7 ms**; neun Neuzeichnungen am Stück froren den Tab ein. Meine früheren 25-36 ms stammten
	// von einem 900x620-Testfenster, also einem Viertel der Pixel -- die Zahl war nie allgemein gültig.
	//
	// Sichtbar war der Nutzen ohnehin nicht, solange die Gipfel Stecknadelköpfe waren (siehe die
	// Radiusklemme im Feldmodul). Wer es zurückholt, misst vorher am GRÖSSTEN Viewport, nicht am
	// bequemsten -- und braucht entweder ein gröberes Raster oder einen Gradienten ohne Nachbarabfragen.
	gebirge: "perlin",
	huegelland: "warp",
};
// 🔧 „ridged" (2026-07-29) ist gebaut, getestet und liefert das Gratbild, auf das der Owner gezeigt
// hat -- es steht hier nur BEWUSST noch nicht drin. Zuweisen wäre eine Zeile oben.
//
// ⚠️ NICHT AUS KOSTENGRÜNDEN. Der Owner hat die Zuweisung beauftragt und dann abgebrochen, weil ihm
// der Bestand mit den neuen Reglern schon gefiel -- eine Geschmacksentscheidung, keine technische.
//
// 💣 EINE FRÜHERE FASSUNG DIESES KOMMENTARS BEHAUPTETE „verdoppelt die Malzeit". DAS WAR FALSCH, und
// es hätte die nächste Zuweisung grundlos verhindert. Die Zahl stammte aus einer nachgebauten Szene
// (drei Rechtecke). Am LIVEBESTAND gemessen -- 636 Flächen, 65 Gipfel, 15 Felder mit eigenem Gipfel,
// Browser, 2560×1271, 4-px-Raster, Median aus 7 Läufen -- kostet das Verfahren nichts:
//
//                        Übersicht        hineingezoomt (ein Gebirge füllt das Fenster)
//   perlin (heute)        191,3 ms         507,3 ms
//   ridged, 3 Oktaven     179,3 ms         498,8 ms
//
// Die Malschleife wird von dem beherrscht, was ohnehin je Abfrage läuft; die Gratoktaven verschwinden
// darin. Im Modellfall machten dieselben Oktaven +120 % aus -- ein Mikro-Benchmark misst hier sehr
// genau etwas, das es nicht gibt.
//
// 💣 UND DIE NODE-ZAHLEN LÜGEN OBENDREIN. Dieselbe Messung unter Node sagt ridged 52 ms gegen slope
// 90 ms, im Browser ist die Rangfolge umgekehrt. Wer hier etwas ändert, misst IM BROWSER und GEGEN
// DEN LIVEBESTAND (Nutzlast einmal ziehen, lokal ablegen, dagegen messen -- `verify-ridged-live.html`
// im Worktree `landschaften-v8-aufgabe-b` macht genau das), nicht unter Node und nicht an einer
// nachgebauten Szene.
//
// ⚠️ Die 507 ms hineingezoomt sind der BESTAND, verfahrensunabhängig -- ebenso der Feldbau mit ~306 ms.
// Wenn dort etwas zu tun ist, ist der Hebel das Malraster (8 px statt 4) oder der Feldbau, nie die Wahl
// zwischen diesen Verfahren.

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
		// V8: die drei Geländeregler der FLÄCHE durchreichen. Fehlt einer (null), leitet das Feld ihn
		// ab wie bisher -- deshalb wird hier nichts mit `|| Vorgabe` aufgefüllt: das machte aus „nicht
		// eingestellt" stillschweigend einen eingestellten Wert und nähme dem Editor die Rücknahme.
		const field = buildEcosystemHeightField(area, assignment.get(area) || [], peakWindow, {
			grain: area?.terrain_grain ?? undefined,
			levels: area?.terrain_levels ?? undefined,
			avgHeight: area?.terrain_avg_height ?? null,
			// V8-Fortsetzung: die zweite Zahl. `null` = Potenz 1, also genau das Feld von vorher.
			meanHeight: area?.terrain_mean_height ?? null,
			// 🔴 Das Darstellungsverfahren folgt der ART (Owner-Entscheid 2026-07-28): Gebirge bekommt
			// „Exponential Slope Weighting", Hügelland „Domain Warping", alles andere das additive
			// Rauschen. Die Zuordnung steht hier und nicht in der Datenbank, weil sie eine Aussage über
			// das VERFAHREN ist und nicht über die Fläche -- eine neue Art bekommt bewusst das additive
			// Rauschen, bis jemand entscheidet, dass sie etwas anderes braucht.
			method: ECOSYSTEM_TERRAIN_METHOD_BY_TYPE[String(area?.region_type || "")] || "perlin",
		});
		// Flache Flächen liefern kein Feld. Sie gar nicht erst aufzunehmen spart in der Malschleife eine
		// Abfrage je Pixel je Fläche.
		// 💣 `fields.length` ist deshalb NICHT `areas.length` -- wer über `areas` indiziert, greift daneben.
		//
		// 💣 GEFRAGT WIRD NACH `bumps`, NICHT NACH `peakBumps` (2026-07-29). Bis dahin stand hier
		// „hat die Fläche Gipfelbuckel?", und das war dasselbe wie „trägt sie Gelände?" -- solange ein
		// Gipfel die einzige Höhenquelle war. Seit eine Fläche ihr Gelände auch aus der eingetragenen
		// Maximalhöhe bekommt, sind das zwei verschiedene Fragen: ein Gebirge ohne Gipfel hat Rausch-,
		// aber keine Gipfelbuckel und wäre hier lautlos herausgefallen. Der Feldbau hätte korrekt
		// gerechnet, die Unit-Tests wären grün geblieben (sie rufen ihn direkt) und auf der KARTE hätte
		// sich nichts getan. `bumps` ist die Vereinigung beider und damit die richtige Frage:
		// „trägt dieses Feld irgendetwas bei?"
		if (field && Array.isArray(field.bumps) && field.bumps.length > 0) {
			fields.push(field);
			areaIdsByField.push(String(area?.public_id || ""));
		}
	});

	// Erst JETZT verdichten -- die Radien entstehen im Feldbau darüber. Ein Gipfel ohne Radius liegt in
	// keiner Fläche und kann nichts fenstern; ihn weiter abzutasten kostete live das Siebenfache
	// (62 statt 9 Punkte je Rasterpunkt, gemessen 24,1 ms je 60.000 Abfragen).
	if (peakWindow && typeof peakWindow.compact === "function") {
		peakWindow.compact();
	}

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
