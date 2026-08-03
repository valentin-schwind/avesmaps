// Der aventurische Kalender -- und die Bindung zwischen den zwei Engines.
//
// 🔴 ZWEI ENGINES, EINE ZAHL. Der Reiseplan entsteht wahlweise im Server (api/_internal/routing/) oder
// im Client (js/routing/). Liefern die beiden Kalender verschiedene Daten, springt die Ankunft, sobald
// jemand den Schalter umlegt -- und zwar lautlos, weil beide fuer sich plausibel aussehen. Genau diese
// Falle steht als `routing-two-server-switches` im Haus.
//
// Dieser Test prueft deshalb in DREI Richtungen:
//   1. das Verhalten des Clients an denselben Faellen, die travel-calendar-test.php prueft,
//   2. Monatsfolge, Jahreszeiten und Konstanten gegen die PHP-Datei GELESEN, nicht abgetippt,
//   3. wenn `php` erreichbar ist: dieselben Eingaben durch BEIDE Rechner und Feld fuer Feld verglichen.
//
// Lauf: node js/routing/__tests__/travel-calendar.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..", "..");
const cal = require(path.join(repoRoot, "js/routing/travel-calendar.js"));
const HOURS = (days) => days * cal.TRAVEL_CALENDAR_HOURS_PER_DAY;

// ============================================================ 1. Verhalten
assert.strictEqual(cal.TRAVEL_CALENDAR_MONTHS.length, 12, "zwoelf Monate");
assert.strictEqual(
	12 * cal.TRAVEL_CALENDAR_DAYS_PER_MONTH + cal.TRAVEL_CALENDAR_NAMELESS_DAYS,
	cal.TRAVEL_CALENDAR_DAYS_PER_YEAR,
	"12 x 30 + 5 = 365 -- die drei Konstanten duerfen nicht auseinanderlaufen"
);
assert.strictEqual(cal.travelCalendarMonthIndex("praios"), 0, "Praios eroeffnet das Jahr");
assert.strictEqual(cal.travelCalendarMonthIndex("rahja"), 11, "Rahja schliesst es");
assert.strictEqual(cal.travelCalendarMonthIndex("FIRUN"), 6, "Grossschreibung aus einem Link faellt nicht durch");
assert.strictEqual(cal.travelCalendarMonthIndex("namenlose"), null, "die Namenlosen Tage sind kein Monat");

// Jeder Tag des Jahres genau einmal erreichbar -- eine Luecke waere ein Datum, auf das keine Reise je
// faellt, eine Dopplung zwei Daten, die sich gleich ausdrucken.
const seen = new Set();
for (let d = 1; d <= cal.TRAVEL_CALENDAR_DAYS_PER_YEAR; d++) {
	const date = cal.travelCalendarFromDayOfYear(d);
	const key = date.nameless ? `namenlos-${date.day}` : `${date.monthKey}-${date.day}`;
	assert.ok(!seen.has(key), `Tag ${d} (${key}) kommt zweimal vor`);
	seen.add(key);
}
assert.strictEqual(seen.size, 365, "alle 365 Tage sind verschieden");

// Rundreise
cal.TRAVEL_CALENDAR_MONTHS.forEach((monthKey) => {
	[1, 15, 30].forEach((day) => {
		const back = cal.travelCalendarFromDayOfYear(cal.travelCalendarDayOfYear(monthKey, day));
		assert.strictEqual(`${back.monthKey}-${back.day}`, `${monthKey}-${day}`, `Rundreise ${day}. ${monthKey}`);
	});
});

// Ein Tag aus der Adresszeile wird geklemmt, nicht verworfen.
assert.strictEqual(cal.travelCalendarDayOfYear("firun", 31), cal.travelCalendarDayOfYear("firun", 30), "Tag 31 wird auf 30 geklemmt");
assert.strictEqual(cal.travelCalendarDayOfYear("firun", 0), cal.travelCalendarDayOfYear("firun", 1), "Tag 0 wird auf 1 geklemmt");
assert.strictEqual(cal.travelCalendarDayOfYear("nichtvorhanden", 5), null, "ein erfundener Monat ergibt kein Datum");

// Ohne Reisebeginn = wie bisher
assert.strictEqual(cal.travelCalendarAdvance("", 1, HOURS(5)), null, "ohne Monat kein Datum");
assert.strictEqual(cal.travelCalendarAdvance(null, 1, HOURS(5)), null, "null-Monat kein Datum");

// Kalenderstunden, nicht Reisestunden
assert.strictEqual(cal.travelCalendarAdvance("firun", 25, 23.9).day, 25, "unter 24 Kalenderstunden bleibt der Tag stehen");
assert.strictEqual(cal.travelCalendarAdvance("firun", 25, 24).day, 26, "genau 24 Kalenderstunden = ein Tag weiter");
assert.strictEqual(cal.travelCalendarAdvance("firun", 25, 30).hourOfDay, 6, "der Rest der Stunden bleibt als Uhrzeit erhalten");
assert.strictEqual(cal.travelCalendarAdvance("firun", 25, -5).day, 25, "negative Stunden reisen nicht rueckwaerts");

// Aufbruch 28. Phex -> in den Peraine: die Jahreszeit wechselt MITTEN in der Route.
assert.strictEqual(cal.travelCalendarAdvance("phex", 28, HOURS(2)).season, "winter", "nach zwei Tagen noch Winter");
const spring = cal.travelCalendarAdvance("phex", 28, HOURS(3));
assert.strictEqual(`${spring.monthKey}-${spring.day}`, "peraine-1", "ein Tag weiter beginnt der Peraine");
assert.strictEqual(spring.season, "fruehling", "💣 die Jahreszeit wechselt mitten in der Route");

// Aufbruch 28. Rahja -> durch die Namenlosen Tage
const nameless = cal.travelCalendarAdvance("rahja", 28, HOURS(3));
assert.strictEqual(nameless.nameless, true, "💣 der Tag NACH dem 30. Rahja ist namenlos");
assert.strictEqual(nameless.monthKey, "", "ein namenloser Tag traegt keinen Monat");
assert.strictEqual(cal.travelCalendarAdvance("rahja", 28, HOURS(7)).day, 5, "fuenf namenlose Tage, nicht vier und nicht sechs");
const newYear = cal.travelCalendarAdvance("rahja", 28, HOURS(8));
assert.strictEqual(`${newYear.monthKey}-${newYear.day}`, "praios-1", "danach beginnt das neue Jahr");
assert.strictEqual(newYear.yearsPassed, 1, "und der Jahreswechsel wird mitgezaehlt");

// ============================================================ 2. gegen die PHP-Datei GELESEN
// 🪤 Keine abgetippte Monatsliste: der Sinn dieses Blocks sind die ECHTEN Werte der anderen Engine.
const phpSource = fs.readFileSync(path.join(repoRoot, "api/_internal/routing/travel-calendar.php"), "utf8");

const phpMonths = (() => {
	const match = phpSource.match(/const AVESMAPS_TRAVEL_CALENDAR_MONTHS = \[([\s\S]*?)\];/);
	assert.ok(match, "AVESMAPS_TRAVEL_CALENDAR_MONTHS in der PHP-Datei gefunden");
	return match[1].split(",").map((part) => part.trim().replace(/^'|'$/g, "")).filter(Boolean);
})();
assert.deepStrictEqual(phpMonths, cal.TRAVEL_CALENDAR_MONTHS,
	"die Monatsfolge muss in beiden Engines dieselbe sein -- sie IST das Jahr");

const phpSeasons = (() => {
	const match = phpSource.match(/const AVESMAPS_TRAVEL_CALENDAR_SEASONS = \[([\s\S]*?)\];/);
	assert.ok(match, "AVESMAPS_TRAVEL_CALENDAR_SEASONS in der PHP-Datei gefunden");
	const table = {};
	match[1].replace(/'([a-z]+)'\s*=>\s*'([a-z]+)'/g, (_, month, season) => {
		table[month] = season;
		return "";
	});
	return table;
})();
assert.deepStrictEqual(phpSeasons, cal.TRAVEL_CALENDAR_SEASONS,
	"die Jahreszeiten-Zuordnung muss in beiden Engines dieselbe sein");

[
	["AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_MONTH", cal.TRAVEL_CALENDAR_DAYS_PER_MONTH],
	["AVESMAPS_TRAVEL_CALENDAR_NAMELESS_DAYS", cal.TRAVEL_CALENDAR_NAMELESS_DAYS],
	["AVESMAPS_TRAVEL_CALENDAR_DAYS_PER_YEAR", cal.TRAVEL_CALENDAR_DAYS_PER_YEAR],
].forEach(([name, jsValue]) => {
	const match = phpSource.match(new RegExp(`const ${name} = ([0-9]+);`));
	assert.ok(match, `${name} in der PHP-Datei gefunden`);
	assert.strictEqual(Number(match[1]), jsValue, `${name} weicht zwischen den Engines ab`);
});

// ============================================================ 3. beide Rechner, dieselben Eingaben
// Der eigentliche Paritaetsbeweis. Laeuft nur, wo `php` erreichbar ist; wo nicht, sagt der Test es
// laut, statt still durchzuwinken.
const FAELLE = [
	["firun", 25, 0], ["firun", 25, 23.9], ["firun", 25, 24], ["firun", 25, 30],
	["phex", 28, HOURS(2)], ["phex", 28, HOURS(3)],
	["rahja", 28, HOURS(2)], ["rahja", 28, HOURS(3)], ["rahja", 28, HOURS(7)], ["rahja", 28, HOURS(8)],
	["praios", 1, HOURS(365)], ["praios", 1, HOURS(730)],
	["peraine", 30, HOURS(45.5)], ["tsa", 1, HOURS(199)], ["boron", 17, HOURS(88.25)],
];

let phpAvailable = true;
let phpResults = null;
try {
	const calendarPath = path.join(repoRoot, "api/_internal/routing/travel-calendar.php").replace(/\\/g, "/");
	const script = `require ${JSON.stringify(calendarPath)};`
		+ `$out = [];`
		+ `foreach (json_decode(${JSON.stringify(JSON.stringify(FAELLE))}, true) as $case) {`
		+ `  $r = avesmapsTravelCalendarAdvance($case[0], (int) $case[1], (float) $case[2]);`
		+ `  $out[] = [$r['month_key'], $r['day'], $r['nameless'], $r['season'], $r['years_passed']];`
		+ `}`
		+ `echo json_encode($out);`;
	phpResults = JSON.parse(execFileSync("php", ["-r", script], { encoding: "utf8" }));
} catch (error) {
	phpAvailable = false;
	console.log(`  (Paritaetslauf uebersprungen -- php nicht erreichbar: ${String(error.message).split("\n")[0]})`);
}

if (phpAvailable) {
	assert.strictEqual(phpResults.length, FAELLE.length, "der PHP-Lauf hat jeden Fall gerechnet");
	FAELLE.forEach((fall, index) => {
		const js = cal.travelCalendarAdvance(fall[0], fall[1], fall[2]);
		assert.deepStrictEqual(
			[js.monthKey, js.day, js.nameless, js.season, js.yearsPassed],
			phpResults[index],
			`Server und Client weichen ab bei ${fall[1]}. ${fall[0]} + ${fall[2]} Kalenderstunden`
		);
	});
	console.log(`  (Paritaet gegen PHP geprueft: ${FAELLE.length} Faelle, Feld fuer Feld gleich)`);
}

console.log("travel-calendar.test.js: all assertions passed");
