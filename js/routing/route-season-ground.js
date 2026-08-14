/*
 * Die Anbindung des Bodenabzugs an die Route: welche Klimazone liegt unter einer Etappe, an welchem
 * Tag wird sie gereist, und wie viel laenger dauert sie deshalb.
 *
 * Der RECHNER steht in season-ground.js (Zone x Jahreszeit -> Bodenzustand -> Tempofaktor, gegen den
 * Server paritaetsgeprueft). Hier steht nur, WORAUF er angewandt wird.
 *
 * 💣 DIE RECHNUNG IST SEQUENTIELL, UND ZWAR NOTWENDIG. Der Abzug einer Etappe haengt an ihrem Datum,
 * ihr Datum an der bis dahin verstrichenen Zeit -- und die hat der Abzug der vorherigen Etappen
 * gerade verlaengert. Das ist die Selbstbezueglichkeit aus Entwurf §6, im Kleinen. Sie loest sich
 * ohne Fixpunkt, weil das Datum einer Etappe NUR von den vorherigen abhaengt: ein Durchgang von vorn
 * nach hinten genuegt. Wer stattdessen alle Daten vorab aus den unkorrigierten Zeiten bestimmt,
 * datiert jede Etappe zu frueh -- und bei einer Reise ueber Wochen faellt der Jahreszeitwechsel dann
 * an der falschen Stelle.
 *
 * 💣 ER WIRKT AUF DIE ANZEIGE, NICHT AUF DIE WEGWAHL. Der Router hat seine Route ohne diesen Abzug
 * gesucht; im Winter fuehrt er weiter ueber den Pass, obwohl der Umweg schneller waere. Das ist
 * bewusst so und Phase 4 der Umsetzungsanweisung -- sie haengt an der noch offenen Entscheidung zu
 * Entwurf §6 (exakt je Kante gegen grob gegen das Aufbruchsdatum) und daran, dass BEIDE Engines
 * mitziehen muessen. Bis dahin gilt: die genannte Zeit stimmt fuer DIESE Route, die Route selbst ist
 * die schnellste ohne Boden.
 */

// Einmal je Sitzung, nicht je Route: der Rueckfall auf die alte anteilige Uhr soll auffallen, aber
// die Konsole nicht zumuellen (siehe applyRouteSeasonGround).
let avesmapsSeasonGroundFallbackWarned = false;

/**
 * Die Klimazone unter einer Etappe, oder "" wenn keine bekannt ist.
 *
 * 💣 Eine Etappe kann mehrere Zonen beruehren (193 der 5.765 Wege tun es) -- genommen wird die mit
 * dem groessten gedeckten Anteil. Ein Mittelwert waere sinnlos: „halb boreal, halb gemaessigt" ist
 * kein Bodenzustand, und die Tabelle kennt nur ganze Zonen.
 *
 * ⚠️ Liefert "" auch, solange die Landschaften noch nicht geladen sind (der Abruf laeuft asynchron).
 * Das ist richtig so: lieber ohne Abzug rechnen als mit geratener Zone. Wenn die Ablage eintrifft,
 * zeichnet der Plan sich neu.
 */
function routeEntryClimateZone(entry, segments) {
	if (typeof avesmapsPathLandscapesStore === "undefined" || !avesmapsPathLandscapesStore) {
		return "";
	}
	const store = avesmapsPathLandscapesStore;
	const catalogue = store.landscapes || {};
	const paths = store.paths || {};
	const pathIds = typeof routeEntryPathIds === "function" ? routeEntryPathIds(entry, segments) : [];
	const byZone = {};
	pathIds.forEach((pathId) => {
		const record = paths[pathId];
		if (!record || !Array.isArray(record.in)) {
			return;
		}
		record.in.forEach((pair) => {
			const region = catalogue[pair && pair[0]];
			if (!region || String(region.kind || "") !== "klima") {
				return;
			}
			// 💣 `art_key`, NICHT `art`. Letzteres ist das Label („Gemäßigte Zone"), das die Anzeige
			// zeichnet; die Bodentabelle kennt nur den Schluessel („gemaessigt"). Ein Vergleich gegen
			// das Label findet nie eine Zone -- und faellt nicht auf, weil „keine Zone" ein
			// legitimer Zustand ist und stillschweigend Faktor 1,0 bedeutet.
			const zoneKey = String(region.art_key || "").trim().toLowerCase();
			if (!zoneKey) {
				return;
			}
			byZone[zoneKey] = (byZone[zoneKey] || 0) + Math.max(0, Number(pair[1]) || 0);
		});
	});
	let best = "";
	let bestCovered = 0;
	Object.keys(byZone).forEach((zoneKey) => {
		if (byZone[zoneKey] > bestCovered) {
			best = zoneKey;
			bestCovered = byZone[zoneKey];
		}
	});
	return best;
}

/**
 * Traegt den Bodenabzug in die Etappen ein: verlaengert `travelTime` und haengt den Vermerk an.
 * Ohne Reisebeginn (oder ohne geladene Zonen) bleibt jede Zahl, wie sie war.
 *
 * ⭐ Angewandt VOR der Rastrechnung (buildRouteSteps), damit Rast und alle Summen von selbst
 * mitziehen -- so wie es der Gelaendefaktor tut. Wer die Zeit erst in der Anzeige verlaengert,
 * bekommt eine Etappenliste, die ihrer eigenen Summe widerspricht.
 *
 * @param {Array} planEntries Etappen aus buildRoutePlanEntries (werden VERAENDERT)
 * @param {Array} segments Die Segmente derselben Route (fuer die Zonensuche)
 * @param {object} departure {monthKey, day} aus dem Panel, oder null
 * @param {number} travelPerDay Reisestunden am Tag -- Rueckfall, falls kein Rastzaehler kommt
 * @param {{bookRest?: function(number, number): number}} [options] `bookRest(index, travelTime)`
 *        ist der laufende Rastzaehler des Aufrufers und liefert die Raststunden DIESER Etappe.
 *        💣 Die Reihenfolge der zwei Zahlen ist die SPIEGELUNG von `bookLeg(travelTime, exempt)`
 *        eine Ebene tiefer -- vertauscht wirft nichts, es rechnete nur lautlos mit einer
 *        Reisezeit von 0..n und ohne Rast. `route-season-ground-apply.test.js` faengt das.
 */
function applyRouteSeasonGround(planEntries, segments, departure, travelPerDay, options) {
	const entries = Array.isArray(planEntries) ? planEntries : [];
	if (!departure || !departure.monthKey
		|| typeof travelCalendarAdvance !== "function"
		|| typeof seasonGroundReport !== "function") {
		return entries;
	}
	const perDay = Number.isFinite(Number(travelPerDay)) && Number(travelPerDay) > 0 ? Number(travelPerDay) : 24;
	// 💣 KALENDERZEIT IST REISEZEIT PLUS RAST, UND DIE RAST FAELLT IN PORTIONEN AN. `bookRest` ist
	// der Rastzaehler des Aufrufers (avesmapsRouteRestCounter): er sagt je Etappe, wieviele
	// Raststunden auf ihr faellig werden, und traegt den angebrochenen Reisetag zur naechsten
	// Etappe weiter. Er MUSS in derselben Reihenfolge und genau einmal je Etappe gerufen werden --
	// er ist ein laufender Zaehler, keine Formel.
	//
	// ⚠️ Der Rueckfall darunter ist die alte anteilige Regel (`24 / Reisestunden` je Reisestunde).
	// Sie ueberschaetzt: sie bucht auch fuer den angebrochenen letzten Tag eine volle Nacht, die Uhr
	// geht also vor. Sie steht nur noch fuer Aufrufer ohne Zaehler da (die Node-Tests der Modul-
	// schnittstelle); im Reiseplaner reicht `buildRouteSteps` den Zaehler immer mit.
	//
	// 💣 UND SIE SAGT BESCHEID. Ein stiller Rueckfall waere genau die Sorte Fehler, gegen die dieser
	// Umbau steht: nach einem fehlgeschlagenen Deploy kann eine gecachte 4-Argument-Fassung dieser
	// Datei auf eine neue route-result.js treffen (AGENTS §9, der vergiftete `?v=`-Stempel), und der
	// Planer faehrt wortlos wieder die alte Uhr. Auffallen wuerde das erst an einer Route, die eine
	// Jahreszeitgrenze streift -- also fast nie, und dann als Raetsel.
	const bookRest = options && typeof options.bookRest === "function" ? options.bookRest : null;
	if (!bookRest && !avesmapsSeasonGroundFallbackWarned && typeof console !== "undefined" && console.warn) {
		avesmapsSeasonGroundFallbackWarned = true;
		console.warn("applyRouteSeasonGround: kein Rastzaehler uebergeben -- Jahreszeit-Uhr rechnet anteilig (alte Regel).");
	}
	const calendarPerTravelHour = 24 / perDay;
	let elapsedCalendarHours = 0;
	entries.forEach((entry, index) => {
		const date = travelCalendarAdvance(departure.monthKey, departure.day, elapsedCalendarHours);
		const season = date ? date.season : "";
		const zoneKey = routeEntryClimateZone(entry, segments);
		const report = seasonGroundReport(entry.type, zoneKey, season);
		if (report && report.speedFactor > 0) {
			// Zeit ist der Kehrwert des Tempos: 0,875 Tempo sind 1/0,875 = +14,3 % Zeit.
			entry.travelTime = entry.travelTime / report.speedFactor;
			entry.seasonGround = report;
		}
		// Erst NACH dem Bodenabzug buchen: die Rast dieser Etappe faellt auf ihre endgueltige
		// Reisezeit an, nicht auf die vor dem Abzug.
		elapsedCalendarHours += bookRest
			? entry.travelTime + bookRest(index, entry.travelTime)
			: entry.travelTime * calendarPerTravelHour;
	});
	return entries;
}

// Node-Export (im Browser wirkungslos).
if (typeof module !== "undefined" && module.exports) {
	module.exports = { routeEntryClimateZone, applyRouteSeasonGround };
}
