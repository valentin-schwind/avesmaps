// 🪤 Kein "use strict": in strict mode bekommt eval() seinen EIGENEN Variablenraum, die unten
// herausgeschnittenen Funktionen erreichten diese Datei nie und jede Pruefung staerbe an
// "not defined". Dieselbe Zeile steht aus demselben Grund ueber visitor-analytics-render.test.js.
//
// Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/api-metrics-render.test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const src = read("js", "review", "review-api-metrics.js");
const css = read("css", "components", "visitor-analytics.css");
const indexHtml = read("index.html");
// 🪤 Die Unterreiter-Logik sitzt in review-visitor-analytics.js, NICHT in review-status.js --
// der Bauplan hat die Datei falsch benannt, und ein Test gegen die falsche Datei waere gruen
// geblieben, waehrend der dritte Reiter tot ist.
const subtabJs = read("js", "review", "review-visitor-analytics.js");
const leser = read("api", "_internal", "analytics", "api-metrics.php");

// 🪤 KOMMENTARE MUESSEN HERAUS, BEVOR AM CODE GEPRUEFT WIRD. Das ist bei diesem Test ZWEIMAL
// aufgeschlagen: die Zusicherung „die Stundenspalte wird nicht umbenannt" fand `hour AS h` in dem
// Kommentar, der genau davor warnt, und die Zusicherung „keine Hexwerte" fand #d3a04a/#e08272 in
// dem Kommentar, der die gemessenen Dunkel-Kontraste festhaelt. Ein Quelltexttest, der Kommentare
// mitliest, bestraft das Aufschreiben der Regel -- und der naechste Leser loescht dann den
// Kommentar statt den Test zu reparieren.
const ohneBlockKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
// Nur ganze Kommentarzeilen: ein `//` mitten in einer Zeichenkette (etwa einer URL) bliebe sonst
// auf der Strecke und riss den Rest der Zeile mit.
// 🪤 NUR `//`, NIEMALS `#`. Die erste Fassung strich auch Zeilen, die mit `#` beginnen -- gedacht
// als PHP-Kommentar, in CSS aber ein ID-SELEKTOR. Sie loeschte damit `#api-dashboard` aus dem
// Stylesheet, und die Zusicherung „der Abschnitt kann scrollen" meldete eine fehlende Regel, die
// in Wahrheit dastand. Ein Werkzeug, das die Sprache verwechselt, erfindet Befunde.
const ohneZeilenKommentare = (text) => text.replace(/^[ \t]*\/\/.*$/gm, "");
const nurCode = (text) => ohneZeilenKommentare(ohneBlockKommentare(text));

let fehler = 0;
function pruefe(bedingung, was) {
	if (!bedingung) {
		console.error("FAIL: " + was);
		fehler++;
	}
}

function extract(name) {
	const match = src.match(new RegExp("function " + name + "\\b[\\s\\S]*?\\n\\}"));
	if (!match) {
		console.error("FAIL: " + name + " nicht in js/review/review-api-metrics.js gefunden");
		process.exit(1);
	}
	return match[0];
}

// apiEscape geht ueber das DOM. Der Stub kann genau das eine, was die Funktion braucht -- er ist
// bewusst kein halbes DOM: was er nicht kann, soll auffallen, nicht durchrutschen. Uebernommen aus
// visitor-analytics-render.test.js, damit beide Tests dieselbe Zusage pruefen.
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

// 💣 EIN eval, nicht mehrere: ein `const` verlaesst den eval-Raum NIE (anders als eine
// Funktionsdeklaration in sloppy mode). Getrennt ausgewertet saehe apiKlassenBalken seine
// Farbtabelle nicht -- genau daran ist die erste Fassung dieses Tests umgefallen, mit einem
// „API_KLASSEN_FARBEN is not defined", das wie ein fehlendes Feature aussieht.
//
// ⚠️ ZUM eval(): es liest ausschliesslich den EIGENEN Quelltext des Projekts, der oben per
// fs.readFileSync aus dem Repo kommt -- keine Eingabe von aussen, kein Netz, keine Nutzerdaten.
// Die Alternative waere, die Funktionen im Test NACHZUBAUEN, und eine nachgebaute Kopie besteht
// froehlich weiter, waehrend die ausgelieferte Datei kaputt ist.
eval([
	extract("apiEscape"),
	src.match(/const API_KLASSEN_FARBEN[\s\S]*?\n\};/)[0],
	extract("apiKlassenBalken"),
	extract("apiZaehlstandSatz"),
].join("\n"));

// --- Der gestapelte Balken ---------------------------------------------------------------------
const klassen = [
	{ dimension: "2xx", c: 900 },
	{ dimension: "4xx", c: 60 },
	{ dimension: "5xx", c: 30 },
	{ dimension: "leer", c: 10 },
];
const balken = apiKlassenBalken(klassen);
pruefe(balken.includes("90%"), "2xx nimmt 90 % der Breite");
pruefe(/leer/.test(balken), "die leeren Antworten stehen in der Legende");
pruefe(/1\.000|900/.test(balken), "die Zahlen stehen dabei");

// 🔴 Die leere Klasse ist der Grund fuer die ganze Tafel -- aber sie darf auch nicht erfunden
// werden, wenn es keine gibt.
pruefe(apiKlassenBalken([{ dimension: "2xx", c: 5 }]).includes("leer") === false,
	"ohne leere Antworten steht auch keine leere Legende da");

// Leere Daten ergeben einen Satz, KEINE Nullbalken -- „Zahl da, Balken leer" liest sich wie
// „Wert ist 0", und genau daran standen im Besucher-Dashboard acht Listen monatelang unbemerkt.
pruefe(/noch keine Daten/.test(apiKlassenBalken([])), "leere Daten sagen es");
pruefe(/noch keine Daten/.test(apiKlassenBalken([{ dimension: "2xx", c: 0 }])),
	"lauter Nullen zaehlen als keine Daten");

// --- 🪤 Der Zaehlstand -------------------------------------------------------------------------
// Ein stummer Zaehler sieht aus wie Ruhe. Das Panel muss den Unterschied benennen.
pruefe(apiZaehlstandSatz(null) !== "", "ohne jede Zaehlung wird etwas gesagt");
pruefe(/nichts gez/i.test(apiZaehlstandSatz("2026-08-01")), "ein alter Stand wird als Warnung gelesen");
pruefe(apiZaehlstandSatz(new Date().toISOString().slice(0, 10)) === "", "ein heutiger Stand schweigt");

// --- Die Verdrahtung ---------------------------------------------------------------------------
pruefe(/data-status-subtab="api"/.test(indexHtml), "der dritte Reiterknopf steht in index.html");
pruefe(/data-status-subsection="api"/.test(indexHtml), "und sein Abschnitt");
pruefe(/id="api-dashboard"/.test(indexHtml), "der Anker fuer den Renderer");
pruefe(indexHtml.includes("js/review/review-api-metrics.js"), "das Skript wird geladen");

// 💣 Die Ladereihenfolge ist ein Vertrag: review-api-metrics.js benutzt vaBars/vaHeatmap/vaDonut
// aus review-visitor-analytics.js und muss NACH ihr stehen.
pruefe(
	indexHtml.indexOf("js/review/review-visitor-analytics.js") < indexHtml.indexOf("js/review/review-api-metrics.js"),
	"review-api-metrics.js laedt NACH review-visitor-analytics.js"
);

// Der Schalter kennt den dritten Namen -- und normalisiert nicht mehr auf zwei.
pruefe(/"api"/.test(subtabJs), "activateStatusSubtab kennt den dritten Namen");
pruefe(!/statusSubtab === "besucher" \? "besucher" : "editoren"/.test(subtabJs),
	"der Klick-Verdrahter zwingt nicht mehr auf zwei Namen");

// 💣 EIN Schreiber auf den REITER-Speicherschluessel. Der Reiterzustand gehoert der Kaskadentabelle
// REVIEW_TAB_FAMILIES in js/ui/ui-controls.js; ein zweiter Schreiber hier war schon einmal da --
// ein Schluessel, zwei Schreiber.
//
// 🪤 Die erste Fassung verbot `localStorage` in der GANZEN Datei und war damit zu breit: eine
// Nachbarsitzung legte am selben Tag eine voellig andere Einstellung dort ab (die Skalenwahl der
// Editoren-Linie, VA_EDITOR_SCALE_KEY) -- voellig legitim, und mein Test haette ihre Arbeit rot
// gemeldet. Eine Zusicherung muss die Regel treffen, die sie meint, nicht deren Nachbarschaft.
pruefe(!/avesmaps\.review\.status\.activeTab/.test(subtabJs),
	"der Reiterzustand wird hier NICHT gespeichert (das macht REVIEW_TAB_FAMILIES)");

// 💣 vaHeatmapGrid liest r.dow / r.hour / r.c. Ein Alias `hour AS h` im Leser laesst jede Zelle in
// Stunde 0 landen -- die Karte zeigte dann einen soliden Streifen und saehe wie ein Befund aus
// statt wie ein Fehler.
pruefe(!/hour\s+AS\s+h\b/i.test(nurCode(leser)), "die Stundenspalte wird NICHT umbenannt");

// ⭐ Der Ring kommt vom vorhandenen vaDonut, nicht aus einer zweiten Fassung.
pruefe(/vaDonut\(/.test(src), "apiZonenKarte benutzt den vorhandenen vaDonut");
pruefe(!/stroke-dasharray/.test(src), "kein zweiter Ring von Hand");

// --- Die Bauteile im CSS ------------------------------------------------------------------------
// 💣 DER ABSCHNITT MUSS SCROLLEN KOENNEN. `.status-subsection` ist eine Flex-Spalte fester Hoehe;
// ohne `flex: 1 1 auto` + `min-height: 0` + `overflow-y: auto` laeuft der Inhalt ueber und ist
// schlicht unerreichbar. Genau so ging der API-Reiter am 25.08.2026 live -- er erbte das Markup
// des Besucher-Reiters, aber nicht dessen Regel, und der Owner konnte nicht nach unten scrollen.
// 🪤 Das Pruefgeruest fand es nicht: dort scrollte die Seite selbst. Der Fehler haengt am WIRT.
//
// Geprueft wird der geteilte Selektor -- zwei getrennte Regeln liefen beim naechsten Mal wieder
// auseinander.
const scrollRegel = (nurCode(css).match(/#visitor-dashboard\s*,\s*\n?#api-dashboard\s*\{[^}]*\}/) || [""])[0];
pruefe(scrollRegel !== "", "#api-dashboard teilt die Scroll-Regel mit #visitor-dashboard");
["overflow-y: auto", "min-height: 0", "flex: 1 1 auto"].forEach((teil) => {
	pruefe(scrollRegel.includes(teil), "die Scroll-Regel traegt „" + teil + "“");
});
// Jeder Unterabschnitt in index.html braucht einen Inhalt, der in dieser Regel steht.
const abschnitte = [...indexHtml.matchAll(/data-status-subsection="([a-z]+)"[\s\S]{0,200}?id="([a-z-]+)"/g)]
	.map((m) => ({ reiter: m[1], anker: m[2] }));
abschnitte.forEach((a) => {
	if (a.anker === "presence-panel-status" || a.anker === "visitor-live") { return; }
	pruefe(scrollRegel.includes("#" + a.anker) || /visitor-pills/.test(a.anker),
		"der Abschnitt „" + a.reiter + "“ hat einen scrollenden Inhalt (#" + a.anker + ")");
});

pruefe(/\.va-stack\b/.test(css), "der gestapelte Balken hat eine Regel");
pruefe(/\.va-feed__tag--warn\b/.test(css), "die Plakettenklassen sind da");
pruefe(/\.va-feed__tag--neutral\b/.test(css), "auch die neutrale");

// 🪤 DAS TOKEN HEISST --color-warning. Die erste Fassung schrieb --color-warn, und eine
// undefinierte CSS-Variable macht die ganze Deklaration ungueltig: die Plakette blieb
// DURCHSICHTIG -- weisse Schrift auf der Karte, Kontrast 1,02, in hell UND dunkel. Das Mockup
// hatte den Fehler nicht gefunden, weil es seine Tokens SELBST definierte; dort war --color-warn
// eine Erfindung. Der Test haelt seither fest, dass nur existierende Tokens benutzt werden --
// das faengt die ganze Klasse, nicht nur diesen einen Namen.
const tokens = read("css", "base", "tokens.css");
const benutzt = new Set(
	[...(nurCode(css).match(/var\(--[a-z0-9-]+/g) || []), ...(nurCode(src).match(/var\(--[a-z0-9-]+/g) || [])]
		.map((v) => v.slice(4))
);
const fehlendeTokens = [...benutzt].filter((t) => !new RegExp(t.replace(/-/g, "\\-") + "\\s*:").test(tokens));
pruefe(fehlendeTokens.length === 0, "jedes benutzte Token existiert in tokens.css: " + fehlendeTokens.join(" "));

// ⭐ Beide Plaketten nehmen ein ENTWORFENES Paar aus tokens.css, keine selbstgebaute
// Themenausnahme. Ein handgedrehtes `[data-theme="dark"] { color: ... }` waere beim naechsten
// Tokenwechsel still auseinandergelaufen.
const warnRegel = (nurCode(css).match(/\.va-feed__tag--warn\s*\{[^}]*\}/) || [""])[0];
const neutralRegel = (nurCode(css).match(/\.va-feed__tag--neutral\s*\{[^}]*\}/) || [""])[0];
pruefe(/--color-warning-strong\b/.test(warnRegel) && /--color-warning-strong-text\b/.test(warnRegel),
	"die Warnplakette nimmt das Paar --color-warning-strong(-text)");
pruefe(/--color-button\b/.test(neutralRegel) && /--color-button-text\b/.test(neutralRegel),
	"die neutrale Plakette nimmt das Paar --color-button(-text)");
pruefe(!/\[data-theme="dark"\][\s\S]{0,160}\.va-feed__tag/.test(nurCode(css)),
	"keine handgedrehte Themenausnahme fuer die Plaketten");

// 💣 Keine hartkodierte Farbe in den neuen Regeln (AGENTS.md §12). Erlaubt sind nur die zwei
// Tinten der Plaketten, die dort begruendet stehen.
const neueRegeln = ohneBlockKommentare(css.slice(css.indexOf(".va-stack")));
const uebrigeHex = neueRegeln.replace(/#fff\b/g, "").replace(/#23201a\b/g, "").match(/#[0-9a-fA-F]{3,8}\b/g);
pruefe(uebrigeHex === null, "die neuen Regeln nehmen Token, keine Hexwerte: " + (uebrigeHex || []).join(" "));

if (fehler > 0) {
	console.error(fehler + " Pruefung(en) fehlgeschlagen");
	process.exit(1);
}
console.log("OK: api-metrics-render");
