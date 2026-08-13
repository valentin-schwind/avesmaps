// 🪤 Kein "use strict": in strict mode bekommt eval() seinen EIGENEN Variablenraum, die unten
// herausgeschnittenen Funktionen erreichten diese Datei nie und jede Pruefung staerbe an
// "not defined".
//
// Prueft die reinen Zeichenfunktionen des Besucher-Dashboards
// (js/review/review-visitor-analytics.js) samt der Kopplungen, an denen sie schon gerissen sind.
// Nichts wird hier nachgebaut: eine nachgebaute Kopie bestuende, waehrend die ausgelieferte Datei
// kaputt ist.
//
// Entwurf: docs/superpowers/specs/2026-08-13-status-statistiken-ueberarbeitung-design.md
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/visitor-analytics-render.test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const src = read("js", "review", "review-visitor-analytics.js");
const css = read("css", "components", "visitor-analytics.css");
const indexHtml = read("index.html");

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
		console.error("FAIL: " + name + " nicht in js/review/review-visitor-analytics.js gefunden");
		process.exit(1);
	}
	return match[0];
}

// vaEscape geht ueber das DOM. Der Stub kann genau das eine, was die Funktion braucht -- er ist
// bewusst kein halbes DOM: was er nicht kann, soll auffallen, nicht durchrutschen.
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
// Funktionsdeklaration in sloppy mode). Getrennt ausgewertet saehen die Funktionen ihre Tabellen nicht.
//
// controlled: die Eingabe ist unsere eigene Repo-Datei, und das hier ist ein Wegwerf-Geruest
eval([
	extractConst("VA_HEAT_DAYS"),
	extractConst("VA_HEAT_ROW_ORDER"),
	extractConst("VA_HEAT_HOUR_TICKS"),
	extract("vaEscape"),
	extract("vaBars"),
	extract("vaLine"),
	extract("vaLocalHourShift"),
	extract("vaHeatmapGrid"),
	extract("vaHeatmap"),
	extract("vaPrettyMapMode"),
].join("\n"));

let failed = 0;
const check = (label, ok) => {
	console.log((ok ? "  PASS  " : "  FAIL  ") + label);
	if (!ok) { failed++; }
};
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------------------------
// 1. Die Balken. 💣 `.va-row__fill` ist ein <span>; ohne `display: block` wirken `width`/`height`
//    nicht und ALLE acht Balkenlisten stehen unsichtbar da, waehrend die Zahl daneben stimmt.
//    Genau so war es bis 2026-08-13. Der Gegenbeweis ist `.va-geo-fill`, das die Zeile immer hatte.
// ---------------------------------------------------------------------------------------------
const fillRule = css.match(/\.va-row__fill\s*\{[^}]*\}/);
check("es gibt ueberhaupt eine .va-row__fill-Regel", !!fillRule);
check("💣 .va-row__fill traegt display: block -- sonst ist jeder Balken unsichtbar",
	!!fillRule && /display:\s*block/.test(fillRule[0]));

const geoFillRule = css.match(/\.va-geo-fill\s*\{[^}]*\}/);
check("die Laenderbalken behalten ihr display: block (der Gegenbeweis von damals)",
	!!geoFillRule && /display:\s*block/.test(geoFillRule[0]));

const bars = vaBars([{ dimension: "google.com", c: 40 }, { dimension: "wiki-aventurica.de", c: 10 }], "#4a3aa7");
check("der groesste Wert fuellt die Spur ganz", bars.indexOf("width:100%") !== -1);
check("der kleinere Wert bekommt seinen Anteil", bars.indexOf("width:25%") !== -1);
check("leere Daten sagen es, statt eine leere Spur zu zeichnen",
	vaBars([], "#4a3aa7").indexOf("noch keine Daten") !== -1);

// ---------------------------------------------------------------------------------------------
// 2. Mouseover im Liniendiagramm.
// ---------------------------------------------------------------------------------------------
const daily = [
	{ day: "2026-08-11", views: 1234, uniques: 567, routes: 12 },
	{ day: "2026-08-12", views: 80, uniques: 40, routes: 3 },
	{ day: "2026-08-13", views: 5, uniques: 5, routes: 0 },
];
const lineSvg = vaLine(daily);

check("je Tag ein Mausfeld, nicht eines fuer das ganze Diagramm", countOf(lineSvg, "<rect") === daily.length);
check("💣 fill=\"transparent\" -- fill=\"none\" faengt keine Zeigerereignisse, der Tooltip erschiene nie",
	countOf(lineSvg, '<rect x="') === countOf(lineSvg, 'fill="transparent"'));
// 💣 Gegen Kurven UND Punkte gemessen. Die Punkte sind <circle>, nicht <path> -- eine Pruefung nur
// gegen <path> laesst die Felder unter die Punkte rutschen, und genau auf einem Datenpunkt (dem
// Ort, den man zuerst ansteuert) erschiene dann kein Tooltip.
check("💣 die Felder stehen NACH Kurven und Punkten -- SVG kennt kein z-index, es gewinnt die Reihenfolge",
	lineSvg.lastIndexOf("<rect") > Math.max(lineSvg.lastIndexOf("<path"), lineSvg.lastIndexOf("<circle")));
check("der Tooltip nennt das volle Datum, nicht nur Tag und Monat",
	lineSvg.indexOf("11.08.2026") !== -1);
check("der Tooltip nennt beide Zahlen des Tages",
	lineSvg.indexOf("Aufrufe: " + (1234).toLocaleString("de-DE")) !== -1
	&& lineSvg.indexOf("Eindeutige: " + (567).toLocaleString("de-DE")) !== -1);
check("die Felder liegen im Diagramm, nicht ueber der Datumszeile",
	(lineSvg.match(/<rect [^>]*height="(\d+(?:\.\d+)?)"/) || [])[1] === "80");
check("ein einzelner Tag laesst das Diagramm nicht zerfallen",
	vaLine([{ day: "2026-08-13", views: 3, uniques: 3 }]).indexOf("<rect") !== -1);
check("gar keine Daten werfen nicht", typeof vaLine([]) === "string");

// ---------------------------------------------------------------------------------------------
// 3. Die Heatmap in Ortszeit. 💣 Der Versatz nimmt den WOCHENTAG mit -- ohne Uebertrag waere die
//    Stunde richtig und die Zeile falsch. MySQL DAYOFWEEK: 1 = Sonntag, 2 = Montag.
// ---------------------------------------------------------------------------------------------
check("ohne Versatz bleibt alles, wo es war",
	vaHeatmapGrid([{ dow: 2, hour: 9, c: 7 }], 0)["1_9"] === 7);
check("💣 +2 h ueber Mitternacht: UTC Montag 23 Uhr wird Dienstag 1 Uhr",
	vaHeatmapGrid([{ dow: 2, hour: 23, c: 7 }], 2)["2_1"] === 7);
check("💣 −1 h rueckwaerts ueber Mitternacht: UTC Montag 0 Uhr wird Sonntag 23 Uhr",
	vaHeatmapGrid([{ dow: 2, hour: 0, c: 7 }], -1)["0_23"] === 7);
check("💣 der Wochenwechsel laeuft rund: UTC Samstag 23 Uhr wird Sonntag 1 Uhr",
	vaHeatmapGrid([{ dow: 7, hour: 23, c: 7 }], 2)["0_1"] === 7);
check("💣 und rueckwaerts: UTC Sonntag 0 Uhr wird Samstag 23 Uhr",
	vaHeatmapGrid([{ dow: 1, hour: 0, c: 7 }], -1)["6_23"] === 7);

const shifted = vaHeatmapGrid([{ dow: 2, hour: 22, c: 5 }, { dow: 2, hour: 23, c: 9 }, { dow: 3, hour: 0, c: 1 }], 2);
check("der Versatz verliert keinen einzigen Aufruf",
	Object.values(shifted).reduce((a, b) => a + b, 0) === 15);

check("der Versatz kommt aus der Zeitzone des Browsers, mit umgekehrtem Vorzeichen",
	vaLocalHourShift({ getTimezoneOffset: () => -120 }) === 2
	&& vaLocalHourShift({ getTimezoneOffset: () => 0 }) === 0
	&& vaLocalHourShift({ getTimezoneOffset: () => 300 }) === -5);

const heat = vaHeatmap([{ dow: 2, hour: 9, c: 7 }]);
// 🪤 Mit dem schliessenden Anfuehrungszeichen gezaehlt: „va-heat__cells" (der Zeilencontainer)
// enthaelt „va-heat__cell" als Teilstring und faelschte die Zahl sonst um 8 nach oben.
check("7 Tage zu 24 Stunden", countOf(heat, 'va-heat__cell"') === 7 * 24);
check("eine Stundenzeile ueber dem Raster", countOf(heat, "va-heat__hours") === 1);
check("24 Stundenfelder, damit die Beschriftung ueber ihrer Spalte sitzt",
	countOf(heat, 'va-heat__hour"') === 24);
// Aus der Quelle geholt, nicht abgeschrieben: ein `const` verlaesst den eval-Raum nie, und so
// folgt die Pruefung ausserdem, wenn die Liste im Quelltext einmal anders gewaehlt wird.
const hourTicks = JSON.parse(extractConst("VA_HEAT_HOUR_TICKS").match(/\[[^\]]*\]/)[0]);
hourTicks.forEach((hh) => {
	check("die Stunde " + hh + " ist beschriftet", heat.indexOf(">" + hh + "</span>") !== -1);
});
const untagged = [];
for (let hh = 0; hh < 24; hh++) {
	if (hourTicks.indexOf(hh) === -1 && heat.indexOf(">" + hh + "</span>") !== -1) { untagged.push(hh); }
}
check("nicht jede Stunde traegt eine Zahl -- 24 passen nicht in die Panelbreite, gefunden: " + untagged.join(","),
	untagged.length === 0);
check("⚠️ auch die Sonntagszeile traegt ihre Titel (sie war als einzige ohne gebaut)",
	countOf(heat, 'title="So ') === 24);
check("der Titel nennt Tag, Stundenspanne und Zahl",
	heat.indexOf('title="Mo 9–10 Uhr: 7"') !== -1 || heat.indexOf('title="Mo 9–10 Uhr: 0"') !== -1);
check("die Zeilen stehen von Montag bis Sonntag",
	heat.indexOf(">Mo</span>") < heat.indexOf(">So</span>"));
check("keine rohe Farbe mehr in den Beschriftungen -- die stehen jetzt an Tokens",
	heat.indexOf("#8a7355") === -1);

// ---------------------------------------------------------------------------------------------
// 4. Die Kartenansicht. 💣 Die sechs Ansichten stehen NUR in den <option> von #mapLayerModeSelect.
//    Die geloeschte Tabelle kannte vier davon -- „original" und „ecosystem" standen mit ihrem
//    internen Schluessel in der Statistik.
// ---------------------------------------------------------------------------------------------
check("💣 keine zweite Beschriftungstabelle im Dashboard",
	src.indexOf("VA_MAP_MODE_LABELS") === -1);
check("die Beschriftungen kommen aus dem <select>",
	/querySelectorAll\(\s*["']#mapLayerModeSelect option["']\s*\)/.test(src));

const selectBlock = indexHtml.match(/<select id="mapLayerModeSelect"[\s\S]*?<\/select>/);
check("#mapLayerModeSelect steht im selben Dokument wie das Dashboard", !!selectBlock);

const optionLabels = {};
(selectBlock ? selectBlock[0].match(/<option value="[^"]+"[^>]*>[^<]+<\/option>/g) || [] : []).forEach((option) => {
	optionLabels[option.match(/value="([^"]+)"/)[1]] = option.match(/>([^<]+)<\/option>/)[1].trim();
});
check("alle sechs Ansichten sind dort zu holen", Object.keys(optionLabels).length === 6);
check("💣 „ecosystem\" heisst Landschaften, nicht ecosystem",
	vaPrettyMapMode("ecosystem", optionLabels) === "Landschaften");
check("💣 „original\" heisst Original",
	vaPrettyMapMode("original", optionLabels) === "Original");
["none", "political", "deregraphic", "powerlines"].forEach((slug) => {
	check("„" + slug + "\" bekommt weiterhin seinen Klarnamen",
		vaPrettyMapMode(slug, optionLabels) === optionLabels[slug] && optionLabels[slug] !== slug);
});
check("⚠️ ein zurueckgezogener Modus faellt auf seinen Schluessel zurueck, statt geraten zu werden",
	vaPrettyMapMode("hexgrid", optionLabels) === "hexgrid");
check("ein leerer Wert bleibt leer, statt „undefined\" zu drucken",
	vaPrettyMapMode(null, optionLabels) === "" && vaPrettyMapMode(undefined, optionLabels) === "");

console.log(failed === 0 ? "\nOK -- alle Pruefungen bestanden" : "\n" + failed + " Pruefung(en) fehlgeschlagen");
process.exit(failed === 0 ? 0 : 1);
