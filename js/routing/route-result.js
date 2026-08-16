function resolveRouteStepTransport(routeStep, fallbackTransport = null) {
	const resolvedRouteStep = routeStep || {};
	if (resolvedRouteStep.transport) {
		return resolvedRouteStep.transport;
	}

	if (resolvedRouteStep.transport_option) {
		return resolvedRouteStep.transport_option;
	}

	if (resolvedRouteStep.mode) {
		return resolvedRouteStep.mode;
	}

	return fallbackTransport;
}

function countTransportTransfers(routeSteps) {
	const safeRouteSteps = Array.isArray(routeSteps) ? routeSteps : [];
	let transferCount = 0;
	let previousTransport = null;

	safeRouteSteps.forEach((routeStep) => {
		const transport = resolveRouteStepTransport(routeStep);
		if (!transport) {
			return;
		}

		if (previousTransport && transport !== previousTransport) {
			transferCount += 1;
		}

		previousTransport = transport;
	});

	return transferCount;
}

/**
 * A running rest counter for ONE journey. Returns `bookLeg(travelTime, exempt)`, which reports the
 * rest hours that fall due on that leg and carries the day's remaining travel hours over to the
 * next call.
 *
 * 🔴 THIS IS THE ONLY PLACE THE RULE LIVES, and it is a factory rather than a plain function
 * because it has TWO consumers that cannot share one instance: `buildRouteSteps` books the rest
 * that gets displayed, and `applyRouteSeasonGround` books it a second time to know how much
 * CALENDAR time has passed before each leg -- which decides that leg's season, which decides its
 * ground penalty, which decides its travel time. Each consumer walks the same legs from a rested
 * start, so two instances of one rule agree by construction. A second hand-written copy of the
 * loop would not, and the divergence would show up as a leg dated into the wrong season.
 *
 * @param {number} travelPerDay travel hours per day, > 0
 * @param {boolean} includeRests false = travel round the clock, no rests at all
 * @returns {function(number, boolean): number} books one leg, returns its rest hours
 */
function avesmapsRouteRestCounter(travelPerDay, includeRests) {
	const fallbackDay = Number(travelPerDay) > 0 ? Number(travelPerDay) : 0.5;
	// 💣 GEZAEHLT WIRD DER ANTEIL DES TAGES, NICHT DIE STUNDE. Seit Land 8 und Wasser 12 Reisestunden
	// haben (2026-08-16), ist „Stunden seit der letzten Rast" keine Groesse mehr: dieselbe Stunde
	// fuellt an Land ein Achtel und auf dem Wasser ein Zwoelftel des Reisetages. Der ANTEIL ist es,
	// und die geschuldete Nacht waechst mit ihm -- vier Stunden Marsch plus sechs Stunden Segeln sind
	// ein voller Tag und schulden 0,5 x 16 + 0,5 x 12 = 14 Stunden Rast.
	// ⚠️ Bei EINEM Reisetag fuer alle Etappen faellt das exakt auf die alte Rechnung zurueck, Zahl fuer
	// Zahl -- deshalb bleiben die Faelle in rest-portions.test.js unveraendert gueltig.
	let dayUsed = 0;
	let restOwed = 0;

	return function bookLeg(travelTime, exempt, legTravelHours) {
		const dayHours = Number(legTravelHours) > 0 ? Number(legTravelHours) : fallbackDay;
		const restPortion = Math.max(24 - dayHours, 0);
		if (exempt) {
			// Slept aboard: the passage costs no rest time and leaves the traveller rested.
			dayUsed = 0;
			restOwed = 0;
			return 0;
		}

		if (!includeRests) {
			return 0;
		}

		let restTime = 0;
		// 💣 `Number.isFinite`, not `|| 0`: `Number(Infinity) || 0` is `Infinity` (truthy) and the loop
		// below only ever subtracts a finite `dayHours` per turn, so an Infinity travel time never
		// brings `remaining` under the epsilon and the loop never returns. NaN and negative values
		// fall to 0 the same way the `dayHours` fallback above already does.
		const rawTravelTime = Number(travelTime);
		let remaining = Number.isFinite(rawTravelTime) && rawTravelTime > 0 ? rawTravelTime : 0;
		// The epsilon is not cosmetic: a leg boundary lands on the day's last hour through a chain
		// of float subtractions, so `hoursSinceRest` arrives as 11.999999999999998 rather than 12.
		// Without the tolerance that night is skipped, and the next stretch is 2e-15 hours long.
		while (remaining > 1e-9) {
			if (dayUsed >= 1 - 1e-9) {
				restTime += restOwed;
				dayUsed = 0;
				restOwed = 0;
			}

			const stretch = Math.min(remaining, (1 - dayUsed) * dayHours);
			dayUsed += stretch / dayHours;
			// Anteilig geschuldet: ein halber Reisetag schuldet eine halbe Nacht DIESES Mittels.
			restOwed += (stretch / dayHours) * restPortion;
			remaining -= stretch;
		}

		return restTime;
	};
}

/**
 * The rest hours of every leg, in travel order.
 *
 * 💣 ONE COUNTER FOR THE WHOLE ROUTE, never one per leg. A rest portion falls due when the day's
 * travel hours are used up AND there is still road ahead -- so three short legs share one travel
 * day and a night can land in the middle of a leg. Computing it per leg instead gives a route made
 * of short legs no night at all, however long it is: every number stays plausible and only the sum
 * is nonsense. Until 2026-08-14 the rest was a PROPORTION of the travel time, which charged a full
 * night for the part-day you already arrived on -- 10.6 hours of walking were reported as 21.2.
 *
 * 💣 THE PORTION IS BOOKED BEFORE THE NEXT STRETCH, never after the last one. That is the whole
 * trick, and the reason no look-ahead is needed: a portion can only come into being while there is
 * something left to travel. Booking it as soon as the day is full hangs a night behind the arrival
 * of every journey that ends exactly on the day's last hour.
 *
 * @param {Array<{travelTime: number, exempt: boolean}>} entries legs in travel order; `exempt`
 *        marks a leg that is slept through while moving (the fast sailer)
 * @param {number} travelPerDay travel hours per day, > 0
 * @param {boolean} includeRests false = travel round the clock, no rests at all
 * @returns {number[]} rest hours per leg, same length and order
 */
function avesmapsRouteRestPortions(entries, travelPerDay, includeRests) {
	const safeEntries = Array.isArray(entries) ? entries : [];
	const bookLeg = avesmapsRouteRestCounter(travelPerDay, includeRests);

	return safeEntries.map((entry) => bookLeg(entry && entry.travelTime, Boolean(entry && entry.exempt), entry && entry.dayHours));
}

/**
 * Der Reisetag EINER Etappe in Stunden.
 *
 * 🔴 LAND FOLGT DEM PLANERFELD, WASSER SEINEM EIGENEN TAG. „Reisestunden pro Tag" ist die Hausregel
 * der Gruppe -- wie lange marschiert wird. Ueber den Rhythmus eines Schiffes entscheidet sie nicht:
 * Lastensegler und Galeere ankern nachts (GA S. 131), der Schnellsegler faehrt durch und ist ohnehin
 * rastbefreit. Die VORGABE des Feldes ist deshalb genau der Landtag, 8 Stunden (WdE S. 160-162) --
 * wer nichts verstellt, bekommt an Land und auf dem Wasser den Reisetag seiner Quelle.
 *
 * ⚠️ Ohne TRANSPORT_TRAVEL_HOURS (die Modultests laden js/config.js nicht aus) gilt fuer jede Etappe
 * der Planertag -- exakt das Verhalten von vor dem Umbau, und damit bleiben ihre Faelle gueltig.
 */
function avesmapsRouteLegTravelHours(transport, plannerDayHours) {
	if (typeof TRANSPORT_TRAVEL_HOURS === "undefined" || !TRANSPORT_TRAVEL_HOURS) return plannerDayHours;
	if (typeof VALID_TRANSPORT_OPTIONS !== "undefined" && VALID_TRANSPORT_OPTIONS
		&& VALID_TRANSPORT_OPTIONS.land && VALID_TRANSPORT_OPTIONS.land.has(transport)) {
		return plannerDayHours;
	}
	const own = Number(TRANSPORT_TRAVEL_HOURS[transport]);

	return Number.isFinite(own) && own > 0 ? own : plannerDayHours;
}

function buildRouteSteps(routeNames, segments, options = {}) {
	const includeRests = Boolean(options.includeRests);
	const restHoursPerDay = Number.isFinite(Number(options.restHoursPerDay)) ? Number(options.restHoursPerDay) : 10;
	const travelPerDay = Math.max(24 - restHoursPerDay, 0.5);
	const planEntries = buildRoutePlanEntries(routeNames, segments);

	// 💣 THE NIGHT PASSAGE BELONGS TO A SHIP, NOT TO THE SEA. S. 131 grants it by name to exactly
	// two vessels -- the Schnellsegler (250 miles) and the Kurier-Dromone (200, which we do not
	// model) -- and calls it a special case with conditions. The Lastensegler's own row is 120
	// miles at 12 hours and the Galeere's is 70 at 8; both are coastal ships, of which the same
	// page says they „ankern gewöhnlich nachts oder laufen einen Hafen an".
	//
	// This condition was keyed on the PATH TYPE until 2026-08-03 and handed the 24-hour day to
	// every ship afloat: the Lastensegler ran 201,7 miles/day against a source row of 120, the
	// Galeere 181,5 against 70. Only the Schnellsegler happened to land right (242 against 250),
	// which is what made the error look like none. Same shape as the river bug it followed --
	// right per hour, wrong per day.
	const exemptFlags = planEntries.map((entry) => entry.type === "Seeweg"
		&& resolveRouteStepTransport(entry, entry.type) === "fastShip");

	// Der Reisetag JE ETAPPE -- Land nach Planerfeld, Wasser nach seinem eigenen (siehe oben).
	// 💣 Einmal gerechnet und von BEIDEN Zaehlern benutzt: die Jahreszeitschleife und die angezeigte
	// Rast muessen ueber dieselben Tageslaengen laufen, sonst datiert eine Etappe in die falsche
	// Jahreszeit -- derselbe Fehler, den der gemeinsame Rastzaehler am 14.08.2026 behoben hat.
	const legDayHours = planEntries.map((entry) => avesmapsRouteLegTravelHours(
		resolveRouteStepTransport(entry, entry.type),
		travelPerDay
	));

	// Der Bodenabzug des Reisebeginns greift HIER, vor der Rastrechnung: dadurch waechst die Rast mit
	// der verlaengerten Reisezeit, und jede Summe darueber zieht von selbst nach. Ohne Reisebeginn
	// (options.departure fehlt) bleibt jede Zahl, wie sie war.
	//
	// 💣 UND ER BRAUCHT DEN RASTZAEHLER SELBST. Welche Jahreszeit auf einer Etappe herrscht, haengt
	// daran, wieviel KALENDERzeit bis dorthin vergangen ist -- und Kalenderzeit ist Reisezeit PLUS
	// Rast. Bis zum 14.08.2026 rechnete die Jahreszeitschleife dafuer `24 / Reisestunden` je
	// Reisestunde, also die alte anteilige Regel: die Uhr ging damit vor, nie nach, weil sie auch
	// fuer den angebrochenen letzten Tag eine volle Nacht buchte. Eine Etappe rutschte so zu frueh
	// in die naechste Jahreszeit, bekam deren Bodenabzug -- und der falsche Abzug zog Rast, Summe,
	// Ankunft und Kosten mit.
	//
	// Deshalb bekommt sie hier einen EIGENEN Zaehler derselben Regel. Nicht denselben wie unten:
	// beide laufen ueber dieselben Etappen von einem ausgeruhten Start, ein gemeinsamer waere nach
	// dem ersten Durchgang aufgebraucht. Zwei Instanzen einer Regel stimmen ueberein, zwei Kopien
	// der Schleife nicht.
	if (typeof applyRouteSeasonGround === "function") {
		const bookCalendarRest = avesmapsRouteRestCounter(travelPerDay, includeRests);
		applyRouteSeasonGround(planEntries, segments, options.departure, travelPerDay, {
			bookRest: (index, travelTime) => bookCalendarRest(travelTime, exemptFlags[index], legDayHours[index]),
		});
	}

	// 💣 ONE call for the WHOLE route, outside the map. The rest belongs to the journey, not to the
	// row: three short legs share a travel day, and a night can fall in the middle of a leg.
	const restPortions = avesmapsRouteRestPortions(
		planEntries.map((entry, index) => ({ travelTime: entry.travelTime, exempt: exemptFlags[index], dayHours: legDayHours[index] })),
		travelPerDay,
		includeRests
	);

	return planEntries.map((entry, index) => {
		const restTime = restPortions[index];

		return {
			type: entry.type,
			transport: resolveRouteStepTransport(entry, entry.type),
			from: entry.startName,
			to: entry.endName,
			path_name: entry.segmentLabel || "",
			// Stroemungszustand der Fluss-Etappe (flussabwaerts/-aufwaerts) fuer die Anzeige;
			// null = unbekannt/kein Fluss.
			flow_state: entry.flowState || null,
			// V14: querfeldein gerechnet, kein gezeichneter Weg. Muss hier DURCH -- die Etappenzeile
			// entsteht nicht aus `buildRoutePlanEntries`, sondern aus diesen Schritten ueber das
			// Ansichtsmodell, und beide bauen ihr Objekt aus einer Feldliste. Ein Feld, das in einer
			// der beiden Listen fehlt, kommt lautlos nie an.
			offroad: entry.offroad === true,
			distance: entry.distance,
			travel_time: entry.travelTime,
			rest_time: restTime,
			// Der Bodenabzug dieser Etappe (Zustand, Abzug, Faktor) -- oder gar nicht, wo die
			// Jahreszeit nichts tut. 💣 Wie `offroad` daneben muss auch dieses Feld durch BEIDE
			// Feldlisten (hier und route-view-model.js), sonst kommt es lautlos nie an.
			season_ground: entry.seasonGround || null,
			segment_ids: entry.segmentIndexes || [],
		};
	});
}

function buildRouteSummary(routeLocations, routeSteps, options = {}) {
	const safeRouteLocations = Array.isArray(routeLocations) ? routeLocations : [];
	const safeRouteSteps = Array.isArray(routeSteps) ? routeSteps : [];
	const optimize = options.optimize === "shortest" ? "shortest" : "fastest";
	const totalDistance = safeRouteSteps.reduce((sum, step) => sum + (Number(step.distance) || 0), 0);
	const totalTravelTime = safeRouteSteps.reduce((sum, step) => sum + (Number(step.travel_time) || 0), 0);
	const totalRestTime = safeRouteSteps.reduce((sum, step) => sum + (Number(step.rest_time) || 0), 0);
	const totalHours = totalTravelTime + totalRestTime;
	// The "Drachenflug": how far a dragon flies that visits the SAME stations -- one air leg per pair of
	// consecutive waypoints, summed. Until 2026-07-30 this was the single line from the first waypoint to
	// the last, so Wehrheim -> Lowangen -> Greifenfurt reported 157.2 miles while its first leg alone
	// measures 313: a total smaller than one of its own parts, and a detour comparison that meant nothing.
	// The legs travel with the sum because the summary shows what the sum is made of.
	const airDistanceLegs = [];
	for (let index = 0; index + 1 < safeRouteLocations.length; index += 1) {
		const legStart = safeRouteLocations[index]?.coordinates;
		const legEnd = safeRouteLocations[index + 1]?.coordinates;
		if (!legStart || !legEnd) {
			continue;
		}

		airDistanceLegs.push(calculateScaledDistance(legStart, legEnd));
	}
	const airDistance = airDistanceLegs.reduce((sum, legDistance) => sum + legDistance, 0);

	return {
		distance_miles: totalDistance,
		air_distance_miles: airDistance,
		air_distance_legs: airDistanceLegs,
		travel_hours: totalTravelTime,
		rest_hours: totalRestTime,
		total_hours: totalHours,
		total_days: totalHours / 24,
		optimize,
		transfers: countTransportTransfers(safeRouteSteps),
	};
}

function buildRouteResult(routeLocations, routeNames, segments, options = {}) {
	const routeSteps = buildRouteSteps(routeNames, segments, options);
	const routeSummary = buildRouteSummary(routeLocations, routeSteps, options);

	return {
		summary: routeSummary,
		steps: routeSteps,
	};
}