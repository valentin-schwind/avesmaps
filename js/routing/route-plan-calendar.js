/*
 * Der mitlaufende Kalender im Reiseplan: Abreise, Ankunft, und das Datum jeder Etappe.
 *
 * ⭐ DIE JAHRESZEIT HAENGT AN DER ETAPPE, NICHT AN DER REISE. Eine Reise dauert Tage bis Wochen --
 * wer im Firun aufbricht, kommt womoeglich im Tsa an. Deshalb wird hier je Etappe die bis dahin
 * verstrichene KALENDERzeit aufsummiert und daraus ihr Datum bestimmt.
 *
 * 💣 KALENDERzeit heisst travel_time + rest_time. Eine Etappe von 8 Reisestunden bei 12 Stunden am
 * Tag belegt 16 Stunden Kalender; wer nur die Reisezeit summiert, laesst jede Reise etwa doppelt so
 * frueh ankommen.
 *
 * Ohne gesetzten Reisebeginn liefert alles hier `null` und der Plan sieht aus wie bisher.
 */

/** Der gewaehlte Reisebeginn aus dem Panel, oder null. */
function routePlanDepartureFromPanel() {
	const monthElement = document.getElementById("travelStartMonth");
	const dayElement = document.getElementById("travelStartDay");
	const monthKey = monthElement ? String(monthElement.value || "").trim() : "";
	if (!monthKey || typeof travelCalendarDayOfYear !== "function") {
		return null;
	}
	const day = dayElement ? Number(dayElement.value) : 1;
	return { monthKey: monthKey, day: Number.isFinite(day) ? day : 1 };
}

/** „Firun" -- der Monatsname kommt aus dem Markup, damit es nur eine Liste der zwoelf gibt. */
function routePlanMonthLabel(monthKey) {
	const select = document.getElementById("travelStartMonth");
	if (select) {
		const option = Array.prototype.find.call(select.options, (entry) => entry.value === monthKey);
		if (option) {
			return String(option.textContent || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
		}
	}
	return monthKey.charAt(0).toUpperCase() + monthKey.slice(1);
}

/** „25. Firun". */
function routePlanFormatDate(date) {
	if (!date) {
		return "";
	}
	if (date.nameless) {
		return `${date.day}. ${tr("planner.calendar.nameless", "Namenloser Tag")}`;
	}
	return `${date.day}. ${routePlanMonthLabel(date.monthKey)}`;
}

/**
 * Die Spanne einer Etappe: „25. Firun" an einem Tag, „25.–27. Firun" im selben Monat, sonst
 * ausgeschrieben („30. Firun – 2. Tsa").
 *
 * 💣 Zusammengezogen wird NUR im selben Monat DESSELBEN Jahres. Ueber eine Monatsgrenze waere
 * „30.–2. Firun" schlicht falsch, und ueber den Jahreswechsel („25.–25. Firun" bei 365 Tagen
 * Fahrt) verschwiege die Kurzform ein ganzes Jahr. Die Namenlosen Tage tragen keinen Monat und
 * bleiben ebenfalls ausgeschrieben.
 */
function routePlanFormatDateRange(start, end) {
	if (!start || !end) {
		return "";
	}
	if (start.dayOfYear === end.dayOfYear && start.yearsPassed === end.yearsPassed) {
		return routePlanFormatDate(start);
	}
	const sameMonth = !start.nameless && !end.nameless
		&& start.monthKey === end.monthKey
		&& start.yearsPassed === end.yearsPassed;
	if (sameMonth) {
		return `${start.day}.–${end.day}. ${routePlanMonthLabel(start.monthKey)}`;
	}
	return `${routePlanFormatDate(start)} – ${routePlanFormatDate(end)}`;
}

/**
 * Datum je Etappe plus Ankunft. Gibt null zurueck, wenn kein Reisebeginn gesetzt ist.
 *
 * @param {Array} steps Etappen mit travel_time und rest_time (buildRouteSteps)
 */
function routePlanCalendar(steps, calendarFactor) {
	const departure = routePlanDepartureFromPanel();
	if (!departure || !Array.isArray(steps) || typeof travelCalendarAdvance !== "function") {
		return null;
	}
	// 💣 Die Rast steckt nicht in der Etappe, sondern in der Summe: die Planzeilen kennen nur
	// travelTime. Der Faktor (Gesamtzeit / Reisezeit) verteilt sie proportional -- exakt, solange
	// alle Etappen dieselbe Rastregel haben, und das tun sie ausser beim Schnellsegler.
	const factor = Number.isFinite(Number(calendarFactor)) && Number(calendarFactor) > 0 ? Number(calendarFactor) : 1;
	let elapsedHours = 0;
	const legs = steps.map((step) => {
		const start = travelCalendarAdvance(departure.monthKey, departure.day, elapsedHours);
		const travelHours = Number(step.travelTime !== undefined ? step.travelTime : step.travel_time) || 0;
		const calendarHours = travelHours * factor;
		elapsedHours += calendarHours;
		const end = travelCalendarAdvance(departure.monthKey, departure.day, elapsedHours);
		// Endet die Etappe am Tag, an dem sie begann, steht nur EIN Datum da -- „25.–25. Firun"
		// waere eine Spanne, die keine ist.
		const sameDay = start && end && start.dayOfYear === end.dayOfYear && start.yearsPassed === end.yearsPassed;
		return {
			start: start,
			end: end,
			sameDay: sameDay,
			label: routePlanFormatDateRange(start, end),
		};
	});
	const arrival = travelCalendarAdvance(departure.monthKey, departure.day, elapsedHours);
	const start = travelCalendarAdvance(departure.monthKey, departure.day, 0);
	return {
		departure: start,
		departureLabel: routePlanFormatDate(start),
		arrival: arrival,
		arrivalLabel: routePlanFormatDate(arrival),
		season: arrival ? arrival.season : "",
		days: elapsedHours / 24,
		legs: legs,
	};
}

/**
 * Die zwei Zeilen ueber der Distanz: Abreise und Ankunft. Leer, solange kein Reisebeginn gesetzt
 * ist -- der Plan sieht dann aus wie bisher.
 */
function routePlanCalendarSummaryMarkup(entries, calendarFactor) {
	const calendar = routePlanCalendar(entries, calendarFactor);
	if (!calendar || !calendar.arrival) {
		return "";
	}
	const seasonLabels = {
		winter: tr("planner.season.winter", "Winter"),
		fruehling: tr("planner.season.spring", "Frühling"),
		sommer: tr("planner.season.summer", "Sommer"),
		herbst: tr("planner.season.autumn", "Herbst"),
	};
	const note = `${seasonLabels[calendar.season] || ""} · ${tr("planner.summary.underway", "{n} Tage unterwegs", { n: formatDecimalNumber(calendar.days, 1) })}`;
	return routeSummaryRowMarkup(tr("planner.summary.departure", "Abreise"), calendar.departureLabel, "")
		+ routeSummaryRowMarkup(tr("planner.summary.arrival", "Ankunft"), calendar.arrivalLabel, note);
}

/**
 * Der leise Vermerk am Fuss einer Etappenzeile: ihr Datum (Entwurf §4.3, „je Etappe ein leiser
 * Vermerk mit IHREM Datum"). Leer ohne Reisebeginn -- die Zeile sieht dann aus wie bisher.
 *
 * 💣 Nimmt den FERTIGEN Kalender entgegen, statt ihn selbst zu rechnen. `routePlanCalendar` laeuft
 * ueber alle Etappen; je Zeile aufgerufen waere das Quadrat, und eine Route hat bis zu 45 Etappen.
 *
 * @param {object|null} calendar Rueckgabe von routePlanCalendar(), einmal je Plan gerechnet
 * @param {number} index Index der Etappe in derselben Liste
 */
function routePlanCalendarLegMarkup(calendar, index) {
	const leg = calendar && Array.isArray(calendar.legs) ? calendar.legs[index] : null;
	if (!leg || !leg.label) {
		return "";
	}
	return `<span class="route-plan-entry__date">${leg.label}</span>`;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		routePlanCalendar,
		routePlanFormatDate,
		routePlanFormatDateRange,
		routePlanMonthLabel,
		routePlanDepartureFromPanel,
		routePlanCalendarSummaryMarkup,
		routePlanCalendarLegMarkup,
	};
}
