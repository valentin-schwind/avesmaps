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

// 💣 EINE FREMDE ZEILE DAZWISCHEN TRENNT NICHT. Das war die erste Fassung, und sie hat fast nichts
// gebündelt: Editoren arbeiten im Wechsel (Pergelbach, Fluss Weiden 1, Pergelbach, Kreuzung,
// Pergelbach). Live gemeldet am 22.08.2026: SECHS Pergelbach-Bündel untereinander statt einem.
const unterbrochen = [
	{ id: 4, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:52:00" },
	{ id: 3, name: "Dunkeltann", username: "nics", created_at: "2026-08-22 18:51:00" },
	{ id: 2, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:50:00" },
];
const verschraenkt = changeLogGroupEntries(unterbrochen);
assert.strictEqual(verschraenkt.length, 2, "die zwei Schattenforst-Zeilen finden zueinander, trotz der Zeile dazwischen");
assert.strictEqual(verschraenkt[0].target, "Schattenforst", "und das Bündel steht an der Stelle seiner JÜNGSTEN Zeile");
assert.strictEqual(verschraenkt[0].entries.length, 2, "mit beiden darin");
assert.strictEqual(verschraenkt[1].target, "Dunkeltann", "die fremde Zeile bleibt an ihrem Platz");

// 🔴 ABER DIE LÜCKE TRENNT. Ohne sie wanderte eine Änderung von 15 Uhr nach oben zu einer von
// 18 Uhr, und die Liste beantwortete „was ist gerade passiert" nicht mehr.
const weitAuseinander = [
	{ id: 3, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:52:00" },
	{ id: 2, name: "Schattenforst", username: "nics", created_at: "2026-08-22 18:40:00" },
	{ id: 1, name: "Schattenforst", username: "nics", created_at: "2026-08-22 15:00:00" },
];
const mitLuecke = changeLogGroupEntries(weitAuseinander);
assert.strictEqual(mitLuecke.length, 2, "12 Minuten ketten durch, dreieinhalb Stunden trennen");
assert.strictEqual(mitLuecke[0].entries.length, 2, "die beiden nahen bilden ein Bündel");
assert.strictEqual(mitLuecke[1].entries.length, 1, "die alte steht für sich");
assert.notStrictEqual(mitLuecke[0].key, mitLuecke[1].key, "und die zwei gleichnamigen Bündel sind unterscheidbar");

// ⚠️ Ohne verwertbaren Zeitstempel wird NICHT gebündelt -- eine Nähe zu behaupten, die niemand
// kennt, wäre schlimmer als zwei Zeilen.
const ohneZeit = [
	{ id: 2, name: "Schattenforst", username: "nics", created_at: "" },
	{ id: 1, name: "Schattenforst", username: "nics", created_at: "" },
];
assert.strictEqual(changeLogGroupEntries(ohneZeit).length, 2, "ohne Zeit kein Bündel");

// ---- Die Lücke selbst ------------------------------------------------------------------------------
const changeLogWithinGroupGap = sandbox.changeLogWithinGroupGap;
assert.strictEqual(typeof changeLogWithinGroupGap, "function", "changeLogWithinGroupGap ist geladen");
assert.strictEqual(changeLogWithinGroupGap(0, 14 * 60 * 1000), true, "14 Minuten liegen drin");
assert.strictEqual(changeLogWithinGroupGap(0, 16 * 60 * 1000), false, "16 Minuten nicht mehr");
assert.strictEqual(changeLogWithinGroupGap(14 * 60 * 1000, 0), true, "und die Richtung ist egal");
// 💣 `null` DARF NICHT ALS NULL DURCHGEHEN. `Math.abs(null - null)` ist 0 und läge damit mitten in
// der Lücke -- zwei Zeilen ohne Zeitangabe würden zusammengezogen, als wären sie gleichzeitig.
// ⚠️ Für `NaN` ist die Wache dagegen überflüssig (jeder Vergleich mit NaN ist ohnehin falsch); sie
// steht für genau diesen null-Fall, und deshalb wird er hier geprüft und nicht der NaN-Fall.
assert.strictEqual(changeLogWithinGroupGap(null, null), false, "null ist keine Zeit, auch nicht die Zeit 0");
assert.strictEqual(changeLogWithinGroupGap(undefined, 5), false, "undefined ebenso");
assert.strictEqual(changeLogWithinGroupGap(NaN, 5), false, "und eine unlesbare Zeit auch nicht");

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

// ⚠️ Gebündelt wird das SUCHERGEBNIS, nicht der Gesamtbestand -- sonst spiegelten die Bündel etwas,
// das die Liste gerade nicht zeigt.
assert.ok(/changeLogGroupEntries\(gefunden\)/.test(source), "der Zeichner bündelt wirklich, und zwar das Gesiebte");
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

// 🔴 DIE LINKE KANTE IST BEI ALLEN ZEILEN DIESELBE. Ein Bündel trägt vorn sein Dreieck, eine einzelne
// Änderung nicht -- ohne die Einrückung stünde deren Name um Dreieck plus Abstand weiter links, und
// die Liste hätte einen ausgefransten Rand (Owner 22.08.2026: „es ist doof dass der text eingerückt ist").
//
// ⚠️ Die 18px sind KEINE freie Zahl: 10px Dreieck + 8px Abstand -- genau das, was die Kopfzeile
// davor verbraucht. Drei gekoppelte Werte in zwei Regeln; wer einen anfasst, muss alle zusammen
// bewegen. Live gemessen: beide Namen beginnen bei x = 29.
assert.ok(/padding: 7px 0 7px 18px/.test(zeileCss), "die einzelne Zeile rückt auf die Kante des Bündels ein");
const gruppeCss = panelCss.slice(panelCss.indexOf(".change-log-group {"), panelCss.indexOf(".change-log-group__caret"));
assert.ok(/padding: 7px 0;/.test(gruppeCss), "die Kopfzeile hat KEINE seitliche Polsterung");
assert.ok(/gap: 8px/.test(gruppeCss), "und das Dreieck steht 8px vor dem Namen");
const caretCss = panelCss.slice(panelCss.indexOf(".change-log-group__caret"), panelCss.indexOf(".change-log-group__name"));
assert.ok(/width: 10px/.test(caretCss), "das Dreieck ist 10px breit");

// 🔴 UND DIE ZEILEN STEHEN AUF DERSELBEN KANTE WIE DIE BEDIENELEMENTE DARÜBER -- links wie rechts.
// Owner 22.08.2026: „der abstand ist nicht ganz perfekt". Mit einer seitlichen Polsterung von 4px
// stand alles um vier Pixel versetzt: Bedienelemente bei 11, das Dreieck bei 15, und rechts endete
// die Zeile bei 385, der Filterknopf bei 389.
// ⚠️ Deshalb `0` als seitliche Polsterung und NICHT eine zweite Zahl daneben: die gemeinsame Kante
// kommt allein aus dem Rand der Liste (10px) und dem der Bedienzeile (10px), die ohnehin gleich sind.
// Live gemessen: links 11 / Namen 29 / im Bündel 43, rechts überall 389.
assert.ok(!/padding: 7px 4px[^0-9]/.test(zeileCss), "keine 4px-Stufe mehr an der Zeile");

// 💣 UND DIE LISTE HAT KEINEN ZEILENABSTAND. `.review-panel__list` setzt `gap: 8px` -- richtig für
// die gerahmten Kästen der übrigen Panels, falsch, seit diese Zeilen mit einer TRENNLINIE arbeiten:
// die Linie sitzt am OBERRAND der nächsten Zeile, also klaffte zwischen dem Ende einer Zeile und
// ihrer Linie ein 8px-Loch. An der überfahrenen Zeile war es sofort zu sehen (Owner 22.08.2026:
// „da ist noch ein komischer abstand zwischen item und trenner").
// ⚠️ Die Regel gilt NUR für diesen Reiter -- die anderen Listen im selben Panel zeichnen weiter
// Kästen und brauchen ihren Abstand. Live gemessen: Lücke zwischen zwei Zeilen 0px.
assert.ok(
	/\[data-editor-panel-section="changes"\]\s+\.review-panel__list\s*\{[^}]*gap:\s*0/.test(panelCss),
	"die Liste des Reiters hat keinen Zeilenabstand -- sonst steht die Trennlinie frei",
);

console.log("change-log-buendel ok");
