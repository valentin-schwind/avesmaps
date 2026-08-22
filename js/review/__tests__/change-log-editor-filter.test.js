// Der Filter nach Editor im Fenster „Änderungen" (Owner-Auftrag 22.08.2026, Fassung A).
//
// ⚠️ Er siebt aus den GELADENEN 200 Zeilen, er holt nichts nach. Ein Haken zeigt „die Zeilen dieses
// Editors unter den letzten 200 insgesamt", nicht „seine letzten 200".
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox, nicht eine abgeschriebene Kopie der Regel.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-editor-filter.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const QUELLE = path.join(ROOT, "js", "review", "review-panels-change-log.js");
const source = fs.readFileSync(QUELLE, "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-panels-change-log.js" });

const changeLogEditorOptions = sandbox.changeLogEditorOptions;
const changeLogFilterEntries = sandbox.changeLogFilterEntries;
assert.strictEqual(typeof changeLogEditorOptions, "function", "die echte Funktion ist geladen");
assert.strictEqual(typeof changeLogFilterEntries, "function", "die echte Funktion ist geladen");

const zeilen = [
	{ username: "Valentin" },
	{ username: "Valentin" },
	{ username: "Valentin" },
	{ username: "Alrike" },
	{ username: "", actor_source: "import" },
];

// ---- Die Namen im Trichter, mit ihrer Anzahl ------------------------------------------------------

// ⚠️ Verglichen wird über JSON, nicht mit deepStrictEqual: die Objekte entstehen IM vm-Kontext und
// tragen dessen Object.prototype -- deepStrictEqual prüft den Prototyp mit und schlägt fehl,
// obwohl jeder Wert stimmt.
assert.strictEqual(
	JSON.stringify(changeLogEditorOptions(zeilen, new Set())),
	JSON.stringify([
		{ value: "Valentin", label: "Valentin", count: 3 },
		{ value: "Alrike", label: "Alrike", count: 1 },
		{ value: "Import", label: "Import", count: 1 },
	]),
	"die Namen stehen mit ihrer Anzahl da, der aktivste zuerst, bei Gleichstand alphabetisch",
);

// 💣 Die Import-Tuer ist kein Mensch und heisst im Trichter genauso wie in der Zeile: „Import".
// Zwei Schreibweisen fuer denselben Urheber waeren ein Haken, der nicht das filtert, was danebensteht.
assert.ok(
	changeLogEditorOptions(zeilen, new Set()).some((option) => option.value === "Import"),
	"maschinelle Urheber tragen im Trichter denselben Namen wie in der Zeile",
);

// 💣 DER FALL, DER DEN FILTER UNBEDIENBAR MACHEN WUERDE: ein angehakter Name faellt nach einem
// Zuruecknehmen aus den letzten 200 heraus. Verschwaende er aus dem Menue, waere sein Haken weiter
// WIRKSAM -- die Liste stuende leer da, und niemand koennte ihn loesen.
const optionenMitAbwesendem = changeLogEditorOptions(zeilen, new Set(["Gestern-Weg"]));
assert.ok(
	optionenMitAbwesendem.some((option) => option.value === "Gestern-Weg" && option.count === 0),
	"ein angehakter Name bleibt im Menue, auch mit Anzahl 0",
);
assert.strictEqual(
	optionenMitAbwesendem[optionenMitAbwesendem.length - 1].value,
	"Gestern-Weg",
	"und steht unten, weil er nichts beitraegt",
);

assert.strictEqual(changeLogEditorOptions([], new Set()).length, 0, "ohne Zeilen ist der Trichter leer");
assert.strictEqual(changeLogEditorOptions(null, null).length, 0, "und null wirft nicht");

// ---- Das Sieben ----------------------------------------------------------------------------------
// 🔴 Leere Auswahl heisst ALLE -- dieselbe Regel wie in jedem anderen Trichter des Hauses.

assert.strictEqual(changeLogFilterEntries(zeilen, new Set()).length, 5, "ohne Haken bleiben alle Zeilen");
assert.strictEqual(changeLogFilterEntries(zeilen, new Set(["Valentin"])).length, 3, "ein Haken siebt auf einen Editor");
assert.strictEqual(
	changeLogFilterEntries(zeilen, new Set(["Valentin", "Alrike"])).length,
	4,
	"zwei Haken sind ein ODER, kein UND",
);
assert.strictEqual(changeLogFilterEntries(zeilen, new Set(["Import"])).length, 1, "auch die Import-Tuer laesst sich sieben");
assert.strictEqual(
	changeLogFilterEntries(zeilen, new Set(["Gestern-Weg"])).length,
	0,
	"ein Name, der nicht vorkommt, siebt alles weg -- und das Menue zeigt ihn trotzdem an (oben)",
);
assert.strictEqual(changeLogFilterEntries(null, new Set(["Valentin"])).length, 0, "und null wirft nicht");

// ---- Verdrahtung: eine gepruefte Funktion, die niemand aufruft, beweist nichts ---------------------

assert.ok(
	/changeLogFilterEntries\(changeLogEntries, changeLogEditorFilter\)/.test(source),
	"der Zeichner siebt wirklich, statt changeLogEntries direkt zu zeichnen",
);
assert.ok(
	/avmFilterMenuAttach\(\s*"change-log-filter-toggle",\s*"change-log-filter-menu"/.test(source),
	"der geteilte Trichter ist an die Huelle gehaengt -- kein zweiter Nachbau",
);
assert.ok(
	/avesmapsListBalanceText\("Änderungen"/.test(source),
	"die Bilanzzeile kommt aus dem EINEN Erzeuger, nicht aus einer zweiten Formel",
);

// 💣 Die Huelle steht statisch in index.html. Fehlt eine der drei Kennungen, findet avmFilterMenuAttach
// nichts und gibt still eine leere Funktion zurueck -- kein Fehler, kein Knopf, kein Hinweis.
const markup = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
for (const id of ["change-log-filter-toggle", "change-log-filter-menu", "change-log-editor-menu"]) {
	assert.ok(markup.includes(`id="${id}"`), `die Huelle traegt #${id}`);
}
// Und sie steht im richtigen Abschnitt: ein Trichter im falschen Reiter waere unsichtbar.
const abschnitt = markup.slice(markup.indexOf('data-editor-panel-section="changes"'));
assert.ok(
	abschnitt.indexOf('id="change-log-filter-toggle"') < abschnitt.indexOf('id="change-log-list"'),
	"der Trichter steht im Reiter „Änderungen\", ueber der Liste",
);

// 💣 DER TRICHTER MUSS AM RECHTEN ENDE SEINER ZEILE STEHEN, sonst ist er zwar da, aber unsichtbar.
// Sein Menü hängt an `right: 0` und klappt nach LINKS auf; steht der Knopf links und ist das Menü
// breiter als er, läuft es aus dem Panel heraus -- und `.review-panel` hat `overflow: hidden`.
// Live gemessen am 22.08.2026: Menü 170px breit bei x = -79, sichtbar blieb allein die Anzahl ganz
// rechts in der Zeile. Überall sonst schiebt das Suchfeld daneben den Trichter nach rechts; im
// Reiter „Änderungen" steht er allein.
//
// ⚠️ Das fängt kein DOM-Test: die Ankreuzfelder EXISTIEREN, tragen Text und die richtige Farbe --
// sie liegen nur außerhalb. Genau deshalb steht die Regel hier als Zusicherung an der CSS-Datei.
const panelCss = fs.readFileSync(path.join(ROOT, "css", "features", "review-panel.css"), "utf8");
assert.ok(
	/\[data-editor-panel-section="changes"\]\s+\.wiki-sync-panel__filter\s*\{[^}]*justify-content:\s*flex-end/.test(panelCss),
	"die Filterzeile des Reiters schiebt den Trichter nach rechts -- sonst klappt sein Menue aus dem Panel",
);

console.log("change-log-editor-filter ok");
