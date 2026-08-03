/*
 * Wann darf ein Reisemittel ueber diesen Weg?
 *
 * ⭐ EINE FRAGE, NICHT ZWEI. „Ist die Kutsche hier erlaubt" und „ist der Pass heute offen" sind
 * dieselbe Frage in zwei Aufloesungen, darum stehen sie in einer Struktur: `allowed_transports` sagt
 * OB, `transport_seasons` sagt WANN. Drei Zustaende decken alles ab, was die Geographia sagt:
 *
 *   nicht angehakt            -> nie          („nicht fuer Karren", Raschtulsweg)
 *   angehakt, ohne Fenster    -> ganzjaehrig  (der gewoehnliche Weg, und heute jeder)
 *   angehakt, mit Fenster     -> saisonal     („gangbar Anfang Peraine bis Ende Boron")
 *
 * 💣 DIESE DATEI SPIEGELT DEN SERVER (api/_internal/routing/transport-season.php); der Node-Test
 * schickt dieselben Faelle durch beide Rechner.
 */

// Der Kalender ist im Browser ein Global (index.html laedt travel-calendar.js davor). In Node gibt
// es das nicht, also wird er hier nachgereicht -- VOR den Funktionen, damit sie in beiden Welten
// denselben Namen sehen. Nicht "aufraeumen": ohne das laeuft der Paritaetstest ins Leere.
if (typeof module !== "undefined" && module.exports) {
	const calendar = require("./travel-calendar.js");
	global.travelCalendarDayOfYear = calendar.travelCalendarDayOfYear;
	global.TRAVEL_CALENDAR_DAYS_PER_MONTH = calendar.TRAVEL_CALENDAR_DAYS_PER_MONTH;
}

/** Ein Fenster ist [from_month, from_day, to_month, to_day]; beide Enden gehoeren dazu. */
function seasonWindowNormalize(window) {
	if (!window || typeof window !== "object") {
		return null;
	}
	const fromDayOfYear = travelCalendarDayOfYear(window.from_month, window.from_day === undefined ? 1 : window.from_day);
	const toDayOfYear = travelCalendarDayOfYear(window.to_month, window.to_day === undefined ? 30 : window.to_day);
	if (fromDayOfYear === null || toDayOfYear === null) {
		return null;
	}
	const clamp = (value, fallback) => {
		const numeric = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
		return Math.max(1, Math.min(TRAVEL_CALENDAR_DAYS_PER_MONTH, numeric));
	};
	return {
		from_month: String(window.from_month).trim().toLowerCase(),
		from_day: clamp(window.from_day, 1),
		to_month: String(window.to_month).trim().toLowerCase(),
		to_day: clamp(window.to_day, 30),
		from_day_of_year: fromDayOfYear,
		to_day_of_year: toDayOfYear,
	};
}

/**
 * Liegt ein Tag des Jahres im Fenster?
 *
 * 💣 Das Fenster darf ueber den Jahreswechsel laufen, und die meisten tun es: die Quelle nennt
 * GANGBARKEIT, und die laeuft ueber den Jahreswechsel („Peraine bis Boron" = Tag 271 bis Tag 150).
 * Die Sperren tun das nicht -- genau deshalb ist das Fenster das sicherere der beiden.
 *
 * ⭐ Die fuenf Namenlosen Tage brauchen keinen Sonderfall: sie sind die Tage 361..365 derselben
 * Zaehlung.
 */
function seasonWindowContainsDay(window, dayOfYear) {
	const from = Number(window && window.from_day_of_year);
	const to = Number(window && window.to_day_of_year);
	if (!(from > 0) || !(to > 0)) {
		return true;
	}
	return from <= to
		? dayOfYear >= from && dayOfYear <= to
		: dayOfYear >= from || dayOfYear <= to;
}

/** Die gespeicherten Fenster eines Weges, je Reisemittel. Unbrauchbares faellt weg statt zu raten. */
function seasonWindowsFromProperties(seasons) {
	if (!seasons || typeof seasons !== "object") {
		return {};
	}
	const windows = {};
	Object.keys(seasons).forEach((transport) => {
		const key = String(transport).trim();
		const normalized = seasonWindowNormalize(seasons[transport]);
		if (key && normalized) {
			windows[key] = normalized;
		}
	});
	return windows;
}

/** DIE Frage je Kante: darf dieses Mittel hier an diesem Tag? `null` = kein Reisebeginn gesetzt. */
function transportOpenOn(allowedTransports, windows, transport, dayOfYear) {
	if (!Array.isArray(allowedTransports) || allowedTransports.indexOf(transport) === -1) {
		return false;
	}
	if (dayOfYear === null || dayOfYear === undefined || !windows || !windows[transport]) {
		return true;
	}
	return seasonWindowContainsDay(windows[transport], dayOfYear);
}

/** Fuer den Reiseplan: das Fenster, das hier zugemacht hat -- oder null, wenn nichts zu ist. */
function seasonClosureFor(allowedTransports, windows, transport, dayOfYear) {
	if (dayOfYear === null || dayOfYear === undefined) {
		return null;
	}
	if (!Array.isArray(allowedTransports) || allowedTransports.indexOf(transport) === -1) {
		return null;
	}
	const window = windows && windows[transport];
	if (!window || seasonWindowContainsDay(window, dayOfYear)) {
		return null;
	}
	return {
		transport: transport,
		open_from: { month: window.from_month, day: window.from_day },
		open_to: { month: window.to_month, day: window.to_day },
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		seasonWindowNormalize,
		seasonWindowContainsDay,
		seasonWindowsFromProperties,
		transportOpenOn,
		seasonClosureFor,
	};
}
