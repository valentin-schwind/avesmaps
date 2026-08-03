// Das Datum JE ETAPPE in der Etappenzeile des Reiseplans.
//
// ⭐ Geprueft wird das ECHTE Markup aus `showRoutePlan()`, nicht eine nachgebaute Zeile: der Test
// stellt die Raender (jQuery, Icons) und laesst Kalender, Etappenbau und Markup selbst laufen. Ein
// Test, der nur `routePlanCalendar` befragt, waere gruen, auch wenn niemand die Funktion aufruft --
// und genau das ist hier die zu pruefende Aenderung.
//
// 💣 KALENDERzeit, nicht Reisezeit. Der Faktor (Gesamtzeit / Reisezeit) verteilt die Rast; wer die
// reine travelTime summiert, laesst jede Etappe etwa doppelt so frueh datieren.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/route-plan-leg-date.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- Die Monatswahl aus index.html, nicht abgeschrieben -------------------------------------------
// 💣 `routePlanFormatDate` liest den Monatsnamen aus dem <select>; fehlt es, faellt sie auf
// `monthKey.charAt(0).toUpperCase() + …` zurueck -- was fuer „firun" ZUFAELLIG auch „Firun" ergibt.
// Ein Test mit leerem DOM zertifiziert also die Notbremse statt der Regel (vm-sandbox-stub-swallows-rule).
// Darum kommen die Optionen aus dem echten Markup: wandern die Namen dort, wird dieser Test rot.
const indexHtml = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
const monthSelectMarkup = indexHtml.slice(indexHtml.indexOf('<select id="travelStartMonth"'));
const monthOptions = Array.from(
	monthSelectMarkup.slice(0, monthSelectMarkup.indexOf("</select>")).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g),
	(match) => ({ value: match[1], textContent: match[2] })
);
assert.ok(monthOptions.length === 13, `13 Optionen erwartet (leer + 12 Monate), gefunden: ${monthOptions.length}`);
assert.ok(monthOptions.some((o) => o.value === "firun" && /^Firun/.test(o.textContent)), "Firun steht im Markup");

// ---- Umgebung ------------------------------------------------------------------------------------
let travelStartMonthValue = "";
let travelStartDayValue = "1";
const monthSelect = { get value() { return travelStartMonthValue; }, options: monthOptions };
const dayInput = { get value() { return travelStartDayValue; } };
global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
global.document = {
	getElementById: (id) => (id === "travelStartMonth" ? monthSelect : id === "travelStartDay" ? dayInput : null),
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: {},
};
global.localStorage = { getItem: () => null, setItem() {} };

// Globals aus js/config.js -- festgenagelt, sonst prueft der Test Fallbacks statt der Regel.
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";
global.TIME_SCALE_FACTOR = 1.19;
global.KM_TO_MILES = 1;
global.DISTANCE_SCALING_FACTOR = 3;
global.SYNTHETIC_ROUTE_LONG_LEG_WARN_DISTANCE = 1e9; // nie ausloesen: hier geht es um das Datum
global.ROUTE_ICON_PATHS = { Weg: "weg.svg" };
global.SPEED_TABLE = { groupFoot: { Weg: 3.5 } };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
global.getTransportOption = () => "groupFoot";
global.THRESHOLD = 0.5;
global.ROUTE_CITY_NODE_THRESHOLD = 0.15;
global.normalizeLocationSearchName = (value) => String(value || "");
global.findPathByPublicId = () => null;
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;
global.isCrossingLocation = () => false;
// 💣 Ohne echte Orte an den Segmentenden heissen alle Endpunkte „Markierung", und
// `cleanRoutePlanNoiseEntries` verklebt die vier Segmente zu EINER Etappe -- eine Etappe pro Zeile
// gibt es nur, wo eine Etappe an einem ECHTEN Ort endet. `coordinates` ist [lat, lng] = [y, x].
const placeNames = ["Aran", "Beran", "Ceran", "Deran", "Eran"];
global.locationData = placeNames.map((name, index) => ({ name, coordinates: [0, index * 30] }));
global.selectedLocations = [];
// Der Routen-Zustand aus js/app/runtime-state.js. Er wird hier gesetzt und nicht dem Zufall
// ueberlassen: `showRoutePlan` SCHREIBT die drei, `redrawRoutePlan` LIEST sie -- ohne Deklaration
// haette der Lesezugriff geworfen statt die Regel zu pruefen.
global.currentRoutePlanEntries = [];
global.currentRouteSegments = [];
global.currentRouteNames = [];
global.activeRoutePlanEntryIndex = null;

// ---- jQuery-Rand: sammelt, was showRoutePlan schreibt ---------------------------------------------
let appended = [];
let prepended = [];
const chainable = { on() { return chainable; }, empty() { return chainable; } };
const overview = {
	empty() { appended = []; prepended = []; return overview; },
	append(markup) { appended.push(String(markup)); return overview; },
	prepend(markup) { prepended.push(String(markup)); return overview; },
	find() { return chainable; },
};
global.$ = (selector) => {
	if (selector === "#overview") { return overview; }
	// Die Routenart: „schnellste" ist die Voreinstellung des Panels.
	return { val: () => "fastest", on() { return chainable; }, find() { return chainable; }, length: 0 };
};

const load = (relative) => {
	const absolute = path.join(__dirname, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};
load("../../app/i18n.js");
global.tr = global.window.tr;
load("../../app/utils.js");
load("../travel-calendar.js");
load("../route-plan-calendar.js");
load("../route-node.js");
load("../route-result.js");
load("../route-view-model.js");
load("../route-plan.js");

// Gegenprobe, dass die echten Rechner geladen sind und nicht ein Stub die Regel schluckt.
assert.strictEqual(typeof travelCalendarAdvance, "function", "der echte Kalender muss geladen sein");
assert.strictEqual(typeof routePlanCalendar, "function", "der echte Etappen-Kalender muss geladen sein");
assert.strictEqual(typeof formatDecimalNumber, "function", "das echte Zahlformat muss geladen sein");

// ---- Die Reise -------------------------------------------------------------------------------------
// Vier Etappen zu je 1 Karteneinheit (= 3 Meilen) auf einem „Weg": 3 / 3,5 * 1,19 = 1,02 Reisestunden.
// Zu wenig, um ein Datum zu bewegen -- die Etappenzeiten kommen darum unten aus `restHoursPerDay`
// UND der Streckenlaenge: 30 Einheiten je Etappe sind 90 Meilen und 30,6 Reisestunden.
const legSegment = (index) => ({
	geometry: { type: "LineString", coordinates: [[index * 30, 0], [(index + 1) * 30, 0]] },
	properties: { feature_subtype: "Weg", public_id: `p${index}` },
});
const segments = [0, 1, 2, 3].map(legSegment);
const routeNames = ["A", "B", "C", "D", "E"];

// 💣 `getPlannerRestHoursPerDay()` liefert die RASTstunden am Tag, nicht die Reisestunden: bei den
// voreingestellten 12 Reisestunden sind es 12 Rast, bei „durchreisen" (24 Reisestunden) null.
const renderLegs = ({ month, day, restHoursPerDay }) => {
	travelStartMonthValue = month;
	travelStartDayValue = String(day === undefined ? 1 : day);
	global.getPlannerRestHoursPerDay = () => restHoursPerDay;
	showRoutePlan(routeNames, segments);
	return appended.slice();
};

// 12 Reisestunden am Tag (= 12 Rast): eine Reisestunde belegt 2 Kalenderstunden. Jede Etappe misst
// 30,6 Reisestunden, also 61,2 Kalenderstunden = 2,55 Tage.
const legs = renderLegs({ month: "firun", day: 25, restHoursPerDay: 12 });
assert.strictEqual(legs.length, 4, `vier Etappenzeilen erwartet, bekommen: ${legs.length}`);

// ---- 🔴 DAS IST DER TEST: jede Etappenzeile traegt ihr eigenes Datum -------------------------------
// Aufbruch 25. Firun, je Etappe 61,2 Kalenderstunden (2 volle Tage):
//   Etappe 1: Tag 0 -> Tag 2   = 25.-27. Firun
//   Etappe 2: Tag 2 -> Tag 5   = 27.-30. Firun
//   Etappe 3: Tag 5 -> Tag 7   = 30. Firun - 2. Tsa   (Monatsgrenze: ausgeschrieben)
//   Etappe 4: Tag 7 -> Tag 10  = 2.-5. Tsa
const expected = ["25.–27. Firun", "27.–30. Firun", "30. Firun – 2. Tsa", "2.–5. Tsa"];
expected.forEach((label, index) => {
	assert.ok(
		legs[index].includes(label),
		`Etappe ${index + 1} muss „${label}" nennen.\nZeile war:\n${legs[index]}`
	);
});

// Ein zusammengezogenes Datum darf den Monat nicht doppelt nennen.
assert.ok(!legs[0].includes("25. Firun – 27. Firun"), "im selben Monat steht der Monatsname nur einmal");

// ---- Die Rast steckt drin, nicht nur die Reisezeit --------------------------------------------------
// 💣 Wer durchreist (24 Reisestunden = null Rast), fuer den ist Kalenderzeit = Reisezeit: dieselbe
// Route dauert halb so lang, und die Daten MUESSEN sich verschieben. Blieben sie gleich, waere der
// calendarFactor ignoriert und jede Reise datierte etwa doppelt so lang.
const legsNoRest = renderLegs({ month: "firun", day: 25, restHoursPerDay: 0 });
assert.ok(
	!legsNoRest[3].includes("2.–5. Tsa"),
	`ohne Rast muss die vierte Etappe frueher datieren, stand aber:\n${legsNoRest[3]}`
);
assert.ok(legsNoRest[0].includes("25.–26. Firun"), `ohne Rast: 30,6 Stunden = ein Tagwechsel.\n${legsNoRest[0]}`);
assert.ok(legsNoRest[3].includes("28.–30. Firun"), `ohne Rast endet die Reise im Firun.\n${legsNoRest[3]}`);

// ---- Rueckwaertskompatibel: ohne Reisebeginn sieht die Zeile aus wie bisher --------------------------
// 🔴 Der stabile Vertrag. „Ohne Jahreszeit" ist die Voreinstellung des Panels.
const legsNoStart = renderLegs({ month: "", restHoursPerDay: 12 });
assert.strictEqual(legsNoStart.length, 4, "auch ohne Reisebeginn stehen vier Etappen da");
legsNoStart.forEach((markup, index) => {
	assert.ok(!/\d+\.\s*(–|—)/.test(markup), `Etappe ${index + 1} darf ohne Reisebeginn kein Datum zeigen:\n${markup}`);
	assert.ok(!/Firun|Tsa/.test(markup), `Etappe ${index + 1} darf ohne Reisebeginn keinen Monat zeigen:\n${markup}`);
	// Was bisher dastand, steht weiterhin da.
	assert.ok(/Stunden/.test(markup) && /Meilen/.test(markup), `Etappe ${index + 1} behaelt Stunden und Meilen`);
});

// ---- Namenlose Tage: sie haben keinen Monat und duerfen keinen leeren drucken -------------------------
// Aufbruch 28. Rahja (letzter Monat): die Reise laeuft in die fuenf Namenlosen Tage hinein.
const legsNameless = renderLegs({ month: "rahja", day: 28, restHoursPerDay: 12 });
legsNameless.forEach((markup, index) => {
	assert.ok(!/\d+\.\s*(–|—)?\s*<|\d+\.\s+(–|—)\s+\d+\.\s*</.test(markup), `Etappe ${index + 1}: kein leerer Monat:\n${markup}`);
});
assert.ok(
	legsNameless.some((markup) => markup.includes("Namenloser Tag")),
	`eine Etappe muss in den Namenlosen Tagen liegen:\n${legsNameless.join("\n---\n")}`
);

// ---- Die Ankunftszeile passt in ihre Spalte ---------------------------------------------------------
// 💣 Die Notizspalte ist 64 px breit (live gemessen 2026-08-03): „Sommer · 42,3 Tage unterwegs"
// braucht 158 und brach DREIzeilig um, mitten im Begriff („42,3 Tage / unterwegs"). Auch gekuerzt auf
// „Sommer · 42,3 Tage" waeren es noch 102. Es bleibt die Jahreszeit -- die Tage stehen vier Zeilen
// tiefer als „Gesamte Reisezeit" ohnehin da, das war eine Dopplung und keine Herleitung.
travelStartMonthValue = "firun";
travelStartDayValue = "25";
global.getPlannerRestHoursPerDay = () => 12;
const summaryMarkup = routePlanCalendarSummaryMarkup(
	buildRoutePlanEntries(routeNames, segments),
	2
);
const arrivalNote = summaryMarkup.slice(summaryMarkup.lastIndexOf("route-plan-summary__note"));
assert.ok(/Winter/.test(arrivalNote), `die Ankunft nennt ihre Jahreszeit:\n${arrivalNote}`);
assert.ok(
	!/Tage/.test(arrivalNote),
	`die Tage gehoeren nicht in die 64-px-Spalte, sie stehen schon in „Gesamte Reisezeit":\n${arrivalNote}`
);

// ---- Den Reisebeginn NACHTRAEGLICH waehlen ---------------------------------------------------------
// 🔴 Der Nutzerpfad, der vorher ins Leere lief: Route steht, DANN waehlt jemand den Monat. Ohne
// Neuzeichnen passiert nichts -- das Datum erscheint erst, wenn die Route aus anderem Anlass neu
// gebaut wird, und wer nur den Monat setzt, haelt das Feature fuer kaputt.
travelStartMonthValue = "";
travelStartDayValue = "1";
global.getPlannerRestHoursPerDay = () => 12;
showRoutePlan(routeNames, segments);
assert.ok(!appended.join("").includes("__date"), "Vorbedingung: ohne Reisebeginn steht kein Datum da");

travelStartMonthValue = "firun";
travelStartDayValue = "25";
redrawRoutePlan();
const afterPick = appended.slice();
assert.strictEqual(afterPick.length, 4, `nach dem Neuzeichnen wieder vier Etappen, nicht ${afterPick.length}`);
assert.ok(
	afterPick[0].includes("25.–27. Firun"),
	`nach der Monatswahl muss das Datum ohne Routenneubau dastehen:\n${afterPick[0]}`
);

// ... und wieder abwaehlen raeumt es weg, statt ein totes Datum stehenzulassen.
travelStartMonthValue = "";
redrawRoutePlan();
assert.ok(!appended.join("").includes("__date"), "'Ohne Jahreszeit' nimmt das Datum wieder heraus");

// ---- Ohne Route tut das Neuzeichnen nichts ----------------------------------------------------------
// 💣 Der Handler haengt am Panel und feuert auch, wenn noch gar keine Route existiert (und beim
// Anwenden eines geteilten Links, bevor die Route gebaut ist). Er darf dort nicht werfen.
const savedNames = currentRouteNames;
const savedSegments = currentRouteSegments;
currentRouteNames = [];
currentRouteSegments = [];
appended = [];
assert.doesNotThrow(() => redrawRoutePlan(), "ohne Route darf das Neuzeichnen nicht werfen");
assert.strictEqual(appended.length, 0, "ohne Route wird auch nichts gezeichnet");
currentRouteNames = savedNames;
currentRouteSegments = savedSegments;

console.log("route-plan-leg-date.test.js: all assertions passed");
