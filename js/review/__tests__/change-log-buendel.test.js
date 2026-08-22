// Die kompakte, gebündelte Zeile im Fenster „Änderungen" (Owner 22.08.2026: „mach die items etwas
// kompakter, da geht viel platz verloren, fass die items besser zusammen" -- Entwurf 2 von dreien).
//
// 🔴 GEBÜNDELT WIRD NUR, WAS AUFEINANDERFOLGT. Über die Zeit hinweg zusammengezogen würde eine
// Änderung von 15 Uhr nach oben zu einer von 18 Uhr wandern, und die Liste beantwortete „was ist
// gerade passiert" nicht mehr -- das ist neben „wer war das" ihre zweite Aufgabe.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox, nicht eine abgeschriebene Kopie der Regel.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-buendel.test.js

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

const changeLogFormatTime = sandbox.changeLogFormatTime;
const changeLogGroupEntries = sandbox.changeLogGroupEntries;
const changeLogGroupTimeLabel = sandbox.changeLogGroupTimeLabel;
for (const [name, fn] of [
	["changeLogFormatTime", changeLogFormatTime],
	["changeLogGroupEntries", changeLogGroupEntries],
	["changeLogGroupTimeLabel", changeLogGroupTimeLabel],
]) {
	assert.strictEqual(typeof fn, "function", `${name} ist geladen`);
}

const HEUTE = "2026-08-22";

// ---- Die Uhrzeit -----------------------------------------------------------------------------------
// 💣 Die Millisekunden waren Maschinenausgabe: `2026-08-22 18:52:58.708` hat in einer 400px schmalen
// Spalte mehr Platz gebraucht als der Name des Objekts, um das es ging.

assert.strictEqual(changeLogFormatTime("2026-08-22 18:52:58.708", HEUTE), "18:52", "heute: nur die Uhrzeit");
assert.strictEqual(changeLogFormatTime("2026-08-20 09:07:01.000", HEUTE), "20.08. 09:07", "an einem anderen Tag: mit Datum");
assert.strictEqual(changeLogFormatTime("2025-12-31 23:59:00", HEUTE), "31.12. 23:59", "auch über den Jahreswechsel");
assert.strictEqual(changeLogFormatTime("", HEUTE), "", "ohne Angabe bleibt es leer");
assert.strictEqual(changeLogFormatTime(null, HEUTE), "", "und null wirft nicht");
// ⚠️ Etwas Unerwartetes wird DURCHGEREICHT, nicht verschluckt -- eine leere Zelle sähe aus, als
// hätte es die Änderung nie gegeben.
assert.strictEqual(changeLogFormatTime("irgendwas", HEUTE), "irgendwas", "Unbekanntes wird gezeigt, nicht geschluckt");

// ---- Die Zeitspanne eines Bündels -------------------------------------------------------------------
// ⚠️ Die Liste ist absteigend sortiert: die LETZTE Zeile ist die älteste. Wer das verwechselt,
// schreibt „18:52–18:47" und merkt es nie, weil beide Zahlen stimmen.

const spanne = [
	{ created_at: "2026-08-22 18:52:58" },
	{ created_at: "2026-08-22 18:47:12" },
];
assert.strictEqual(changeLogGroupTimeLabel(spanne, HEUTE), "18:47–18:52", "von der ältesten zur jüngsten");
assert.strictEqual(
	changeLogGroupTimeLabel([{ created_at: "2026-08-22 18:52:01" }, { created_at: "2026-08-22 18:52:59" }], HEUTE),
	"18:52",
	"dieselbe Minute wird nur einmal genannt",
);
assert.strictEqual(changeLogGroupTimeLabel([], HEUTE), "", "ohne Zeilen keine Spanne");

// ---- Das Bündeln -------------------------------------------------------------------------------------

const zeilen = [
	{ id: 9, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:52:58" },
	{ id: 8, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:52:41" },
	{ id: 7, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:52:37" },
	{ id: 6, name: "Dunkeltann", username: "nics", created_at: "2026-08-22 18:52:08" },
	{ id: 5, name: "Ferdok", username: "nottel", created_at: "2026-08-22 18:44:00" },
];
const gruppen = changeLogGroupEntries(zeilen);
assert.strictEqual(gruppen.length, 3, "drei Bündel: 3× Schattenforst, dann Dunkeltann, dann Ferdok");
assert.strictEqual(gruppen[0].entries.length, 3, "die drei aufeinanderfolgenden gehören zusammen");
assert.strictEqual(gruppen[0].target, "Schattenforst", "und tragen den Namen des Objekts");
assert.strictEqual(gruppen[1].entries.length, 1, "eine einzelne bleibt eine einzelne");

// 🔴 NUR AUFEINANDERFOLGEND. Hier liegt eine fremde Zeile dazwischen -- dann sind es ZWEI Bündel,
// keins. Alles andere würde die zeitliche Reihenfolge der Liste zerstören.
const unterbrochen = [
	{ id: 4, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:52:00" },
	{ id: 3, name: "Dunkeltann", username: "nics", created_at: "2026-08-22 18:51:00" },
	{ id: 2, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:50:00" },
];
const getrennt = changeLogGroupEntries(unterbrochen);
assert.strictEqual(getrennt.length, 3, "eine fremde Zeile dazwischen trennt, sie wird nicht übersprungen");
assert.notStrictEqual(getrennt[0].key, getrennt[2].key, "und die zwei gleichnamigen Bündel sind unterscheidbar");

// ⚠️ Verschiedene Urheber am selben Objekt bündeln NICHT -- die Kopfzeile nennt nur einen Namen,
// und zwei Leute unter einem Namen zusammenzufassen wäre eine falsche Aussage darüber, wer es war.
const zweiLeute = [
	{ id: 2, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:52:00" },
	{ id: 1, name: "Schattenforst", username: "nottel", created_at: "2026-08-22 18:51:00" },
];
assert.strictEqual(changeLogGroupEntries(zweiLeute).length, 2, "zwei Urheber sind zwei Bündel");

// 💣 „Unbenannt" ist KEIN gemeinsames Objekt, sondern ein fehlender Name. Zusammengefasst stünde
// dort „Unbenannt · 40 Änderungen" für vierzig völlig verschiedene Dinge.
const namenlos = [
	{ id: 3, name: "", feature_subtype: "", username: "nics", created_at: "2026-08-22 18:52:00" },
	{ id: 2, name: "", feature_subtype: "", username: "nics", created_at: "2026-08-22 18:51:00" },
	{ id: 1, name: "", feature_subtype: "", username: "nics", created_at: "2026-08-22 18:50:00" },
];
assert.strictEqual(changeLogGroupEntries(namenlos).length, 3, "namenlose Zeilen bündeln nicht");

assert.strictEqual(changeLogGroupEntries([]).length, 0, "ohne Zeilen keine Bündel");
assert.strictEqual(changeLogGroupEntries(null).length, 0, "und null wirft nicht");

// ---- Verdrahtung -------------------------------------------------------------------------------------

assert.ok(/changeLogGroupEntries\(sichtbar\)/.test(source), "der Zeichner bündelt wirklich");
assert.ok(
	/gruppe\.entries\.length < CHANGE_LOG_GROUP_MIN/.test(source),
	"eine einzelne Änderung bleibt eine normale Zeile, kein Bündel mit „1\"",
);
// ⚠️ Die Klick- und Rückgängig-Zuhörer hängen in js/routing/routing.js am Dokument und suchen
// `.change-log-entry` samt `data-change-id`. Beides muss bleiben, sonst ist die Liste tot.
assert.ok(/itemElement\.className = "change-log-entry"/.test(source), "die Zeile behält ihre Klasse");
assert.ok(/itemElement\.dataset\.changeId = String\(entry\.id \|\| ""\)/.test(source), "und ihre Kennung");
// 🔴 Die Kopfzeile eines Bündels ist KEINE `.change-log-entry` -- sonst hielte der Dokument-Zuhörer
// sie für eine Änderung und suchte eine `data-change-id`, die es nicht gibt.
assert.ok(
	/element\.className = "change-log-group"/.test(source),
	"die Kopfzeile eines Bündels trägt eine eigene Klasse",
);
// ⚠️ Und sie trägt KEIN „Rückgängig": ein Knopf, der drei Schritte auf einmal zurücknimmt,
// verspräche etwas, das kein Protokoll einlöst.
const kopfBlock = source.slice(source.indexOf("function changeLogGroupHeader"), source.indexOf("function changeLogEntryRow"));
assert.ok(!kopfBlock.includes("change-log-entry__undo"), "die Kopfzeile bietet kein Zurücknehmen an");

// Der Knopf sagt, was er tut -- auch ohne Wort.
assert.ok(
	/undoButtonElement\.setAttribute\("aria-label", undoButtonElement\.title\)/.test(source),
	"der Zeichen-Knopf trägt seinen Namen in title und aria-label",
);

// ---- Und das Aussehen: flache Zeilen mit Trennlinie, keine gerahmten Kästen (AGENTS.md §12) ---------
const panelCss = fs.readFileSync(path.join(ROOT, "css", "features", "review-panel.css"), "utf8");
const zeileCss = panelCss.slice(panelCss.indexOf(".change-log-entry {"), panelCss.indexOf(".change-log-entry--grouped"));
assert.ok(/border-top:\s*1px solid var\(--color-border\)/.test(zeileCss), "die Zeile trennt mit einer Linie");
assert.ok(!/border-radius:\s*8px/.test(zeileCss), "und ist kein gerahmter Kasten mehr");
assert.ok(/\.change-log-group\s*\{/.test(panelCss), "die Kopfzeile eines Bündels hat ihr Aussehen");

console.log("change-log-buendel ok");
