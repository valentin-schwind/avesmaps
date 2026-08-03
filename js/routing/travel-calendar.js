/*
 * Der aventurische Kalender fuer den Reiseplan: zwoelf Monate zu dreissig Tagen, danach die fuenf
 * Namenlosen Tage -- 365 im Jahr.
 *
 * 💣 DIESE DATEI SPIEGELT DEN SERVER, SIE ERFINDET NICHTS (api/_internal/routing/travel-calendar.php).
 * Beide Engines muessen fuer dieselbe Etappe dasselbe Datum liefern, sonst springt die Ankunft, sobald
 * jemand zwischen Server- und Client-Routing umschaltet -- der Fehler aus `routing-two-server-switches`.
 * `js/routing/__tests__/travel-calendar.test.js` liest die PHP-Datei und vergleicht Monatsfolge,
 * Jahreszeiten und Konstanten Zelle fuer Zelle; laufen sie auseinander, wird der Test rot.
 *
 * Reine Arithmetik ueber (Monat, Tag, Stunden): kein DOM, kein Zustand, keine Anzeige. Die NAMEN der
 * Monate stehen bewusst nicht hier, sondern im Markup (index.html) -- dort sind sie eine Wahrheit und
 * schon uebersetzt.
 */

// Die Reihenfolge IST das Jahr: Praios eroeffnet es, Rahja schliesst es, die Namenlosen folgen.
const TRAVEL_CALENDAR_MONTHS = [
	"praios", "rondra", "efferd",
	"travia", "boron", "hesinde",
	"firun", "tsa", "phex",
	"peraine", "ingerimm", "rahja",
];

const TRAVEL_CALENDAR_DAYS_PER_MONTH = 30;
const TRAVEL_CALENDAR_NAMELESS_DAYS = 5;
const TRAVEL_CALENDAR_DAYS_PER_YEAR = 365; // 12 * 30 + 5
const TRAVEL_CALENDAR_HOURS_PER_DAY = 24;

const TRAVEL_CALENDAR_SEASONS = {
	praios: "sommer", rondra: "sommer", efferd: "sommer",
	travia: "herbst", boron: "herbst", hesinde: "herbst",
	firun: "winter", tsa: "winter", phex: "winter",
	peraine: "fruehling", ingerimm: "fruehling", rahja: "fruehling",
};

/** Position eines Monats im Jahr, 0-basiert; null fuer alles, was keiner der zwoelf ist. */
function travelCalendarMonthIndex(monthKey) {
	if (monthKey === null || monthKey === undefined) {
		return null;
	}
	const index = TRAVEL_CALENDAR_MONTHS.indexOf(String(monthKey).trim().toLowerCase());
	return index === -1 ? null : index;
}

/**
 * (Monat, Tag) -> Tag im Jahr, 1..365. Null, wenn der Monat unbekannt ist.
 *
 * Der Tag wird geklemmt statt abgelehnt: er kommt aus der Adresszeile, und ein Link mit „31. Firun"
 * soll am 30. reisen, statt den ganzen Reisebeginn fallen zu lassen.
 */
function travelCalendarDayOfYear(monthKey, day) {
	const monthIndex = travelCalendarMonthIndex(monthKey);
	if (monthIndex === null) {
		return null;
	}
	const numericDay = Number.isFinite(Number(day)) ? Math.floor(Number(day)) : 1;
	const clampedDay = Math.max(1, Math.min(TRAVEL_CALENDAR_DAYS_PER_MONTH, numericDay));
	return monthIndex * TRAVEL_CALENDAR_DAYS_PER_MONTH + clampedDay;
}

/**
 * Tag im Jahr -> das Datum, das er benennt. Die Tage 361..365 sind die Namenlosen: sie tragen keinen
 * Monat. Der Wert laeuft um, eine Reise darf also ins naechste Jahr hineinlaufen.
 */
function travelCalendarFromDayOfYear(dayOfYear) {
	const normalized = (((dayOfYear - 1) % TRAVEL_CALENDAR_DAYS_PER_YEAR) + TRAVEL_CALENDAR_DAYS_PER_YEAR)
		% TRAVEL_CALENDAR_DAYS_PER_YEAR; // 0..364, auch fuer negative Eingaben
	const yearsPassed = Math.floor((dayOfYear - 1) / TRAVEL_CALENDAR_DAYS_PER_YEAR);
	const monthIndex = Math.floor(normalized / TRAVEL_CALENDAR_DAYS_PER_MONTH);

	if (monthIndex >= TRAVEL_CALENDAR_MONTHS.length) {
		// 💣 Die fuenf Namenlosen Tage sind KEIN dreizehnter Monat. Sie haben keinen Namen, sind als
		// Reisebeginn nicht waehlbar, und wer `monthKey` fuer eine Zeichenkette haelt, druckt sonst
		// stillschweigend einen leeren Monat -- `nameless` ist das Feld, das man fragt.
		return {
			monthKey: "",
			day: normalized - TRAVEL_CALENDAR_MONTHS.length * TRAVEL_CALENDAR_DAYS_PER_MONTH + 1,
			nameless: true,
			dayOfYear: normalized + 1,
			yearsPassed: yearsPassed,
			// Sie liegen zwischen Rahja und Praios und erben die Jahreszeit des Monats, aus dem sie
			// herauswachsen. Eine Setzung, keine Regel der Quelle -- aber ohne Jahreszeit waere jede
			// Bodenabfrage ein Sonderfall.
			season: TRAVEL_CALENDAR_SEASONS.rahja,
		};
	}

	const monthKey = TRAVEL_CALENDAR_MONTHS[monthIndex];
	return {
		monthKey: monthKey,
		day: (normalized % TRAVEL_CALENDAR_DAYS_PER_MONTH) + 1,
		nameless: false,
		dayOfYear: normalized + 1,
		yearsPassed: yearsPassed,
		season: TRAVEL_CALENDAR_SEASONS[monthKey],
	};
}

/**
 * Aufbruch + vergangene KALENDERstunden -> das erreichte Datum. Null, wenn kein Aufbruchsmonat
 * gesetzt ist -- das ist der Fall „Ohne Jahreszeit" und heisst: rechne wie bisher.
 *
 * 💣 KALENDERstunden, nicht Reisestunden. Eine Etappe von 8 Reisestunden bei 12 Stunden am Tag
 * belegt 16 Stunden Kalender. Die Engine kennt beide Zahlen je Etappe (`travel_time` + `rest_time`);
 * wer hier Reisestunden hineingibt, laesst jede Reise etwa doppelt so frueh ankommen.
 */
function travelCalendarAdvance(monthKey, day, calendarHours) {
	const startDayOfYear = travelCalendarDayOfYear(monthKey, day);
	if (startDayOfYear === null) {
		return null;
	}
	const safeHours = Math.max(0, Number.isFinite(Number(calendarHours)) ? Number(calendarHours) : 0);
	// Nur ganze Tage: ein Datum ist ein Tag. Der Rest reist als Uhrzeit mit, damit ein Aufrufer
	// „kommt am 3. an, frueh" von „kommt am 3. an, spaet" unterscheiden kann.
	const elapsedDays = Math.floor(safeHours / TRAVEL_CALENDAR_HOURS_PER_DAY);
	const result = travelCalendarFromDayOfYear(startDayOfYear + elapsedDays);
	result.hourOfDay = safeHours % TRAVEL_CALENDAR_HOURS_PER_DAY;
	result.elapsedDays = elapsedDays;
	return result;
}

/** Die Jahreszeit eines Monats; leere Zeichenkette fuer einen unbekannten -- keine fuenfte erfinden. */
function travelCalendarSeason(monthKey) {
	const normalized = monthKey === null || monthKey === undefined ? "" : String(monthKey).trim().toLowerCase();
	return TRAVEL_CALENDAR_SEASONS[normalized] || "";
}

// Node-Export (im Browser wirkungslos, dort laedt index.html die Datei als gewoehnliches Skript und
// alles oben ist schlicht global).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		TRAVEL_CALENDAR_MONTHS,
		TRAVEL_CALENDAR_DAYS_PER_MONTH,
		TRAVEL_CALENDAR_NAMELESS_DAYS,
		TRAVEL_CALENDAR_DAYS_PER_YEAR,
		TRAVEL_CALENDAR_HOURS_PER_DAY,
		TRAVEL_CALENDAR_SEASONS,
		travelCalendarMonthIndex,
		travelCalendarDayOfYear,
		travelCalendarFromDayOfYear,
		travelCalendarAdvance,
		travelCalendarSeason,
	};
}
