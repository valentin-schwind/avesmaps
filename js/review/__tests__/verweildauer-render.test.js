// 🪤 Kein "use strict": in strict mode bekommt eval() seinen EIGENEN Variablenraum, die unten
// herausgeschnittenen Funktionen erreichten diese Datei nie und jede Pruefung staerbe an
// "not defined".
//
// Die Verweildauer-Karte des Besucher-Dashboards (js/review/review-visitor-analytics.js).
// Nichts wird hier nachgebaut: eine nachgebaute Kopie bestuende, waehrend die ausgelieferte Datei
// kaputt ist.
//
// Entwurf: docs/superpowers/specs/2026-08-25-verweildauer-design.md
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/verweildauer-render.test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const src = read("js", "review", "review-visitor-analytics.js");
const css = read("css", "components", "visitor-analytics.css");
const php = read("api", "_internal", "analytics", "visitor-analytics.php");

function extract(name) {
	const match = src.match(new RegExp("function " + name + "\\b[\\s\\S]*?\\n\\}"));
	if (!match) {
		console.error("FAIL: " + name + " nicht in js/review/review-visitor-analytics.js gefunden");
		process.exit(1);
	}
	return match[0];
}
function extractConst(name) {
	const match = src.match(new RegExp("const " + name + "\\s*=[\\s\\S]*?;"));
	if (!match) {
		console.error("FAIL: " + name + " nicht gefunden");
		process.exit(1);
	}
	return match[0];
}

global.document = {
	createElement() {
		let value = "";
		return {
			set textContent(next) { value = String(next); },
			get innerHTML() {
				return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
			},
		};
	},
};

// EIN eval, nicht mehrere: ein `const` verlaesst den eval-Raum nie (anders als eine
// Funktionsdeklaration in sloppy mode). Getrennt ausgewertet saehen die Funktionen ihre Tabelle nicht.
//
// controlled: die Eingabe ist unsere eigene Repo-Datei, und das hier ist ein Wegwerf-Geruest --
// dieselbe Bauform wie in visitor-analytics-render.test.js nebenan.
eval([
	extractConst("VA_DWELL_KLASSEN"),
	extract("vaEscape"),
	extract("vaDwellKorbBreite"),
	extract("vaDwellMedian"),
	extract("vaDwellGruppieren"),
	extract("vaDwellText"),
	extract("vaDwell"),
	extract("vaDwellKarte"),
	// 🪤 Ein `const` verlaesst den eval-Raum nie -- die Tabelle muss ausdruecklich herausgereicht
	// werden, sonst sehen sie nur die Funktionen und nicht die Pruefungen. Sie abzuschreiben waere
	// die Alternative, und eine abgeschriebene Tabelle prueft sich selbst.
	"globalThis.KLASSEN = VA_DWELL_KLASSEN;",
].join("\n"));

let failed = 0;
const check = (label, ok) => {
	console.log((ok ? "  PASS  " : "  FAIL  ") + label);
	if (!ok) { failed++; }
};
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------------------------
// 1. Die Korbbreiten. 💣 Sie sind mit avesmapsVisitorDwellBucket im PHP GEKOPPELT -- der Server
//    legt die Koerbe an, der Browser interpoliert in ihnen. Laufen die zwei Staffelungen
//    auseinander, sitzt der Median im falschen Korb und niemand sieht es ihm an.
// ---------------------------------------------------------------------------------------------
check("bis 5 min sind die Koerbe 10 s breit", vaDwellKorbBreite(0) === 10 && vaDwellKorbBreite(290) === 10);
check("ab 5 min eine Minute", vaDwellKorbBreite(300) === 60 && vaDwellKorbBreite(3540) === 60);
check("ab einer Stunde fuenf Minuten", vaDwellKorbBreite(3600) === 300 && vaDwellKorbBreite(40000) === 300);
// 💣 Die Grenzen aus dem PHP nachgelesen, nicht abgeschrieben: laufen sie auseinander, faellt es hier auf.
check("💣 die Schwellen stehen genauso im PHP (300 / 3600)",
	/\$seconds\s*<\s*300/.test(php) && /\$seconds\s*<\s*3600/.test(php));
check("💣 und der Deckel ist beidseits 43200 (12 h)",
	/AVESMAPS_VISITOR_DWELL_MAX_SECONDS['\s,)]*43200/.test(php.replace(/\s+/g, " "))
	&& KLASSEN[KLASSEN.length - 1][0] === 43200);

// ---------------------------------------------------------------------------------------------
// 2. Der Median wird INNERHALB seines Korbs interpoliert. Ohne das waere er immer die Untergrenze
//    seines Korbs -- bei 5-Minuten-Koerben also bis zu fuenf Minuten zu klein.
// ---------------------------------------------------------------------------------------------
const koerbe = [{ from_seconds: 0, count: 50 }, { from_seconds: 140, count: 150 }];
// 200 Besuche, die Haelfte ist 100. Der erste Korb traegt 50, der zweite die restlichen 50 von 150
// -> 140 + 10 * (50/150) = 143,33 s.
check("der Median liegt im richtigen Korb und wird darin interpoliert",
	Math.abs(vaDwellMedian(koerbe) - 143.333) < 0.01);
check("nicht einfach die Untergrenze des Korbs", vaDwellMedian(koerbe) !== 140);
check("ohne Besuche gibt es keinen Median (null, nicht 0)", vaDwellMedian([]) === null && vaDwellMedian(null) === null);
check("unsortierte Koerbe werden vorher geordnet",
	Math.abs(vaDwellMedian([{ from_seconds: 140, count: 150 }, { from_seconds: 0, count: 50 }]) - 143.333) < 0.01);
check("ein einziger Korb gibt einen Median darin",
	vaDwellMedian([{ from_seconds: 300, count: 10 }]) === 330);

// ---------------------------------------------------------------------------------------------
// 3. Die feinen Koerbe auf die elf gezeigten Klassen legen.
// ---------------------------------------------------------------------------------------------
check("elf Klassen, wie im Mockup abgenommen", KLASSEN.length === 11);
const gruppiert = vaDwellGruppieren([
	{ from_seconds: 0, count: 7 }, { from_seconds: 50, count: 3 },
	{ from_seconds: 140, count: 5 }, { from_seconds: 43200, count: 2 },
]);
check("zwei Koerbe unter einer Minute landen in derselben Klasse", gruppiert[0] === 10);
check("2:20 min landet in der Klasse 2–5", gruppiert[2] === 5);
check("der Ueberlaufkorb landet in der letzten Klasse", gruppiert[10] === 2);
check("kein Besuch geht bei der Gruppierung verloren",
	gruppiert.reduce((a, b) => a + b, 0) === 17);
// ⚠️ Ein Korb jenseits des Deckels darf nicht durchs Raster fallen -- findIndex faende ihn nicht.
check("⚠️ ein Wert oberhalb der letzten Klasse faellt in sie hinein, nicht heraus",
	vaDwellGruppieren([{ from_seconds: 99999, count: 4 }])[10] === 4);

// ---------------------------------------------------------------------------------------------
// 4. Die Beschriftung der Dauer.
// ---------------------------------------------------------------------------------------------
check("unter einer Stunde in Minuten", vaDwellText(145) === "2:25 min");
check("die Sekunden sind zweistellig", vaDwellText(125) === "2:05 min");
check("ab einer Stunde in Stunden", vaDwellText(5400) === "1:30 h");
check("null ist null, nicht leer", vaDwellText(0) === "0:00 min");
check("ohne Wert ein Gedankenstrich, keine NaN", vaDwellText(null) === "—" && vaDwellText(Infinity) === "—");

// ---------------------------------------------------------------------------------------------
// 5. Das Bild.
// ---------------------------------------------------------------------------------------------
check("ohne Daten sagt die Karte das, statt ein leeres Raster zu zeichnen",
	vaDwell({ buckets: [], sessions: 0, seconds_total: 0 }).indexOf("noch keine Daten") !== -1);
check("und wirft auch bei gar keiner Antwort nicht", typeof vaDwell(null) === "string");

const dwell = {
	buckets: [
		{ from_seconds: 0, count: 50 }, { from_seconds: 140, count: 150 },
		{ from_seconds: 600, count: 40 }, { from_seconds: 5400, count: 8 },
	],
	// 💣 Absichtlich NICHT zu den Koerben passend: der Durchschnitt kommt aus den zwei Zaehlern
	//    (exakt), nicht aus den Klassenmitten (genaehert). Waere er aus den Koerben gerechnet,
	//    stuende hier eine andere Zahl.
	sessions: 248,
	seconds_total: 248 * 584,
	max_seconds: 43200,
};
const svg = vaDwell(dwell);

check("elf Balken", countOf(svg, 'class="va-hist__bar"') === 11);
// ⚠️ Durch vaEscape: "<1 min" steht als "&lt;1 min" im Bild. Wer hier den rohen Namen erwartet,
// prueft in Wahrheit, dass NICHT escaped wird -- und genau das waere der Fehler.
const escaped = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
check("jede Klasse traegt ihren Namen unter dem Balken",
	KLASSEN.every((k) => svg.indexOf(">" + escaped(k[2]) + "</text>") !== -1));
check("⚠️ und die spitzen Klammern der Namen sind escaped, nicht roh im Markup",
	svg.indexOf("&lt;1 min") !== -1 && svg.indexOf(">12 h<") === -1);
check("der Tooltip nennt Klasse und Zahl", svg.indexOf("1,5–3 h — 8 Besuche") !== -1);
// 248 Besuche, die Haelfte ist 124: der erste Korb traegt 50, der zweite die restlichen 74 von
// 150 -> 140 + 10 * (74/150) = 144,9 s. Dieselben 2:25 min wie im abgenommenen Mockup.
check("der Median steht als Fahne im Bild", svg.indexOf("Median 2:25 min") !== -1);
check("💣 der Durchschnitt kommt aus den Zaehlern, nicht aus den Klassenmitten",
	svg.indexOf("Ø 9:44 min") !== -1);

// 💣 Unter jedem Strich liegt eine breitere Linie in der Kartenfarbe. Tinte ueber einem goldenen
//    Balken hat im dunklen Thema nur 1,7:1 Kontrast -- dort ist die Tinte hell und der Balken auch.
check("💣 jeder der zwei Striche hat eine Fassung unter sich",
	countOf(svg, "va-hist__mark-casing") === 2);
check("💣 die Fassung steht VOR ihrem Strich -- SVG kennt kein z-index, es gewinnt die Reihenfolge",
	svg.indexOf("va-hist__mark-casing") < svg.indexOf('class="va-hist__mark "'));
check("die Striche liegen ueber den Balken",
	svg.lastIndexOf("va-hist__mark") > svg.lastIndexOf('class="va-hist__bar"'));
check("nur der Durchschnitt ist gestrichelt", countOf(svg, "va-hist__mark--avg") === 1);

// 💣 DIE TRAGENDE PRUEFUNG DES BILDES: die Achse ist NICHT linear in Sekunden. Ein Median von
//    143 s gehoert anteilig in die Klasse "2–5", nicht auf 143/86400 der Gesamtbreite. Linear
//    gerechnet klebten beide Striche am linken Rand und das Bild waere wertlos.
const striche = svg.match(/<line x1="([\d.]+)" y1="14"/g) || [];
const medianX = parseFloat((svg.match(/<line x1="([\d.]+)" y1="14" [^>]*class="va-hist__mark "/) || [])[1]);
const padL = 24, plotW = 360 - 24 - 10, slot = plotW / 11;
check("💣 der Median-Strich sitzt in SEINER Klasse (2–5), nicht linear am linken Rand",
	medianX > padL + 2 * slot && medianX < padL + 3 * slot);
check("linear gerechnet saesse er am Rand -- die Gegenprobe",
	padL + (143 / 86400) * plotW < padL + 1);
check("beide Striche sind gezeichnet", striche.length === 4);

// ---------------------------------------------------------------------------------------------
// 6. CSS
// ---------------------------------------------------------------------------------------------
const barRule = css.match(/\.va-hist__bar\s*\{[^}]*\}/);
check("es gibt eine Regel fuer die Balken", !!barRule);
// 💣 EINE Farbe, keine sequenzielle Leiter: --color-accent-brown ist hell dunkelbraun und dunkel
//    ein helles Tan, die Hausleiter kehrt sich im Dunkelmodus um und ist dort keine mehr.
check("💣 die Balken tragen EINE Tokenfarbe, keine Leiter",
	!!barRule && /var\(--color-accent-strong\)/.test(barRule[0]) && css.indexOf(".va-hist__bar--") === -1);
const casingRule = css.match(/\.va-hist__mark-casing\s*\{[^}]*\}/);
check("die Fassung nimmt die Kartenfarbe und ist breiter als der Strich",
	!!casingRule && /var\(--color-panel\)/.test(casingRule[0]) && /stroke-width:\s*4/.test(casingRule[0]));
check("der Strich selbst ist Tinte, nicht Gold",
	/\.va-hist__mark\s*\{[^}]*var\(--color-text-strong\)/.test(css));
check("kein hartkodierter Farbwert in den neuen Regeln (AGENTS.md §12)",
	!/\.va-hist__[^{]*\{[^}]*#[0-9a-f]{3,8}/i.test(css));

// ---------------------------------------------------------------------------------------------
// 7. Die Kennzahl-Kacheln der Verweildauer. 🪤 Sie tragen als einzige eine EINHEIT mit ("0:45 min",
//    "1:30 h") statt einer blanken Zahl -- bei den geerbten 20 px brach "0:45 min" auf zwei Zeilen
//    um, und eine Kennzahl ueber zwei Zeilen liest sich als zwei. Vom Owner an der Live-Seite
//    gemeldet, 26.08.2026.
// ---------------------------------------------------------------------------------------------
const karte = vaDwellKarte(dwell);
check("die Dauer-Kacheln haben eine eigene Klasse, statt die geerbte Groesse zu tragen",
	karte.indexOf("va-kpis va-kpis--dauer") !== -1);
const dauerRegel = css.match(/\.va-kpis--dauer \.va-kpi__value\s*\{[^}]*\}/);
check("und dazu eine Regel", !!dauerRegel);
check("🪤 sie ist KLEINER als die geerbten 20 px",
	!!dauerRegel && parseFloat((dauerRegel[0].match(/font-size:\s*(\d+)/) || [])[1]) < 20);
check("und der Wert bricht nicht um", !!dauerRegel && /white-space:\s*nowrap/.test(dauerRegel[0]));
// 💣 `nowrap` nimmt einer Grid-Spalte die Schrumpffaehigkeit (min-width:auto). Am Telefon ist das
//    Panel min(400px, 100vw - 64px) -- auf einem 360er also 296 px -- und dann schiebt die
//    Kachelreihe ueber die Karte hinaus. Die schmalere Polsterung ist der Ausgleich, gemessen bei
//    296/311/360/400 px. Wer sie entfernt, muss dort neu messen.
check("💣 die schmalere Seitenpolsterung gehoert dazu -- sonst laeuft die Reihe am Telefon ueber",
	/\.va-kpis--dauer \.va-kpi\s*\{[^}]*padding:\s*11px 8px/.test(css));
// Der Grund fuer das alles: in diesen Kacheln steht eine Einheit.
check("die Werte tragen wirklich eine Einheit", /Median[^<]*<\/div><div class="va-kpi__value">[^<]*(min|h)</.test(karte));

console.log(failed === 0 ? "\nOK -- alle Pruefungen bestanden" : "\n" + failed + " Pruefung(en) fehlgeschlagen");
process.exit(failed === 0 ? 0 : 1);
