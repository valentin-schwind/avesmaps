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

// 🔴 EIN WINZIGES DOM, damit die Zeilenbauer WIRKLICH LAUFEN. Die Spaltenregeln sind Verhalten,
// nicht nur CSS -- „im Bündel trägt Spalte 2 die Aktion statt des Namens" und „die Urheberzelle
// bleibt auch leer stehen" lassen sich an keiner Textsuche ablesen. Nachgebildet ist genau so viel,
// wie changeLogGroupHeader und changeLogEntryRow anfassen; alles andere fehlt absichtlich, damit ein
// künftiger Griff daneben hier auffällt statt still ins Leere zu laufen.
function macheElement(tag) {
	const el = {
		tag,
		className: "",
		dataset: {},
		kinder: [],
		textContent: "",
		title: "",
		hidden: false,
		attribute: {},
		classList: {
			add: (n) => { el.klassen.add(n); el.className = [...el.klassen].join(" "); },
			toggle: (n, an) => { if (an) { el.klassen.add(n); } else { el.klassen.delete(n); }
				el.className = [...el.klassen].join(" "); },
			contains: (n) => el.klassen.has(n),
		},
		setAttribute: (k, v) => { el.attribute[k] = v; },
		appendChild: (kind) => { el.kinder.push(kind); return kind; },
		querySelector: (wahl) => el.kinder.find((k) => ("." + k.className.split(" ").join(".")).includes(wahl)) || null,
	};
	el.klassen = new Set();
	Object.defineProperty(el, "innerHTML", {
		set(html) {
			el.kinder = (html.match(/class="[^"]+"/g) || []).map((treffer) => {
				const kind = macheElement("span");
				kind.className = treffer.slice(7, -1);
				kind.klassen = new Set(kind.className.split(" "));
				return kind;
			});
		},
		get() { return ""; },
	});

	return el;
}
const sandbox = {
	console,
	fetch: () => {},
	// ⚠️ `getElementById` gibt null zurück: das Modul hängt beim Laden Zuhörer an Suchfeld und Liste
	// und prüft jeden Fund -- „nicht da" ist der Zustand, den es ohnehin verträgt. Vorher stand hier
	// `document: undefined`, was denselben Zweig traf; sobald das Objekt existiert, muss es die
	// Methode aber wirklich haben.
	document: { createElement: macheElement, getElementById: () => null },
	window: undefined,
};
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
// 🔴 JEDE ZEILE IST EIN BÜNDEL -- auch eine mit einer einzigen Änderung (Owner 22.08.2026: „es wäre
// konsequent wenn auch einzelne einträge, die nur aus einem item bestehen, das als subitem haben und
// aufgeklappt werden können, sodass alles einheitlich ist"). Bis dahin fiel eine einzelne Änderung in
// eine ANDERE Bauform: zwei Zeilen hoch statt einer, ohne Dreieck, mit dem Rückgängig-Knopf direkt in
// der Zeile -- und das war die HÄUFIGERE der beiden Sorten.
// 💣 Die Zusicherung prüft die ABWESENHEIT der Abzweigung, nicht ihre Anwesenheit: eine Schwelle, ab
// der gebündelt wird, ist genau das, was hier nicht mehr existieren darf.
assert.ok(
	!/CHANGE_LOG_GROUP_MIN/.test(source),
	"es gibt keine Schwelle mehr, ab der gebündelt wird -- jede Zeile ist ein Bündel",
);
assert.ok(
	/changeLogGroupHeader\(gruppe\)/.test(source) && !/changeLogEntryRow\([^)]*,\s*false\)/.test(source),
	"der Zeichner baut für JEDE Gruppe eine Kopfzeile und keine freistehende Zeile mehr",
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

// 🔴 TITEL, NAME UND ANZAHL STEHEN IN SPALTEN -- über beide Zeilenarten hinweg. Owner 22.08.2026:
// „mach, dass titel, name, anzahl änderungen tabellarisch untereinander stehen, das verbessert die
// lesbarkeit der liste." Vorher war jede Zeile ein Flex-Streifen, und ausser dem Titel richtete sich
// nichts aus: der Name wanderte mit der Titellänge mit (gemessen 1082 gegen 1101) und stand in einer
// Einzelzeile sogar in der zweiten Zeile.
//
// 💣 Die Zusicherung prüft, dass es GENAU EINE Tafel gibt und beide Zeilenarten daran hängen. Zwei
// Tafeln liefen beim ersten geänderten Wert auseinander -- und eine Tabelle, die an einer einzelnen
// Zeile bricht, liest sich schlechter als gar keine.
// 💣 Kommentare vorher weg: sie stehen zwischen der letzten schliessenden und der nächsten
// öffnenden Klammer und zählten sonst zum Selektor der Regel darunter.
const cssOhneKommentar = panelCss
	.split("/*")
	.map((teil, i) => (i === 0 ? teil : teil.slice(teil.indexOf("*/") + 2)))
	.join("");
const iTafel = cssOhneKommentar.indexOf(".change-log-group,");
assert.ok(iTafel >= 0, "es gibt eine Regel, die mit .change-log-group beginnt und noch etwas nennt");
const tafelAuf = cssOhneKommentar.indexOf("{", iTafel);
const tafelWahl = cssOhneKommentar.slice(iTafel, tafelAuf);
const tafelRumpf = cssOhneKommentar.slice(tafelAuf + 1, cssOhneKommentar.indexOf("}", tafelAuf));
assert.ok(
	tafelWahl.includes(".change-log-entry"),
	"Bündelkopf und Einzelzeile teilen sich EINE Spaltentafel",
);
assert.ok(tafelRumpf.includes("display: grid"), "und die Tafel ist ein Raster");

// ⚠️ Die erste Spalte plus der Spalt ergeben die 18px, auf denen der Titel vorher stand (Dreieck
// 10px + Abstand 8px). Die linke Kante war ein eigener Owner-Entscheid („es ist doof dass der text
// eingerückt ist") und darf sich durch den Umbau nicht verschoben haben. Zwei gekoppelte Werte in
// EINER Regel; wer einen anfasst, muss den anderen mitbewegen. Live gemessen: Titel bei x = 909 in
// jeder Zeile, Name 1071, Anzahl 1149, Zeit 1179, Rückgängig 1244.
const spalten = tafelRumpf.slice(
	tafelRumpf.indexOf("grid-template-columns:") + "grid-template-columns:".length,
	tafelRumpf.indexOf(";", tafelRumpf.indexOf("grid-template-columns:")),
).trim().split(" ");
const spalt = tafelRumpf.slice(
	tafelRumpf.indexOf("column-gap:") + "column-gap:".length,
	tafelRumpf.indexOf(";", tafelRumpf.indexOf("column-gap:")),
).trim();
assert.strictEqual(
	parseInt(spalten[0], 10) + parseInt(spalt, 10),
	18,
	"erste Spalte + Spalt = 18px -- die linke Kante von vorher, jetzt aus dem Raster",
);
// 💣 Die letzte Spalte muss den Rückgängig-Knopf fassen (gemessen 25px). Mit 18px stiess er nach
// links aus seiner Zelle heraus und berührte die Zeitangabe: ein Rasterplatz hält seinen Inhalt
// nicht, er lässt ihn überlaufen.
assert.ok(
	parseInt(spalten[spalten.length - 1], 10) >= 25,
	"die letzte Spalte fasst den Rückgängig-Knopf (25px), sonst stösst er in die Zeit",
);

// 🔴 JEDE ZELLE NENNT IHRE SPALTE SELBST. Eine Einzelzeile hat kein Dreieck, eine Bündelzeile kein
// „Rückgängig" -- bei automatischer Platzierung rutschte alles um eine Spalte nach links, und zwar
// nur in den Zeilen, in denen etwas fehlt. Die Tabelle bräche also unregelmässig.
function spalteVon(klasse) {
	let pos = 0;
	for (;;) {
		const i = cssOhneKommentar.indexOf(klasse, pos);
		if (i < 0) {
			return null;
		}
		const auf = cssOhneKommentar.indexOf("{", i);
		const zu = cssOhneKommentar.indexOf("}", auf);
		if (auf < 0 || zu < 0) {
			return null;
		}
		const rumpf = cssOhneKommentar.slice(auf + 1, zu);
		const p = rumpf.indexOf("grid-column:");
		if (p >= 0) {
			return rumpf.slice(p + "grid-column:".length, rumpf.indexOf(";", p)).trim();
		}
		pos = i + klasse.length;
	}
}
[
	[".change-log-group__caret", "1"],
	[".change-log-group__name", "2"],
	[".change-log-entry__target", "2"],
	[".change-log-group__actor", "3"],
	[".change-log-group__count", "4"],
	[".change-log-group__time", "5"],
	[".change-log-entry__time", "5"],
	[".change-log-entry__actions", "6"],
].forEach(([klasse, spalte]) => {
	assert.strictEqual(spalteVon(klasse), spalte, klasse + " steht in Spalte " + spalte);
});
// Die Erklärzeile spannt von Spalte 2 bis zum Rand: unter dem Titel beginnen, aber die volle Breite
// nutzen -- sie ist der längste Text der Zeile.
assert.strictEqual(spalteVon(".change-log-entry__l2"), "2 / -1", "die zweite Zeile spannt bis zum Rand");

const gruppeCss = panelCss.slice(panelCss.indexOf(".change-log-group {"), panelCss.indexOf(".change-log-group:hover"));
assert.ok(/padding: 7px 0;/.test(gruppeCss), "die Kopfzeile hat KEINE seitliche Polsterung");
// ⚠️ 14px, nicht 32: die 18px aus Spalte 1 kommen hinzu. Die Einrückung eines offenen Bündels bleibt
// damit bei 32px -- live gemessen beginnt der Text dort bei x = 923 statt 909.
const gebuendeltCss = panelCss.slice(
	panelCss.indexOf(".change-log-entry--grouped {"),
	panelCss.indexOf(".change-log-group__name,"),
);
assert.ok(/padding-left: 14px/.test(gebuendeltCss), "gebündelte Zeilen rücken um 14px ein (macht mit Spalte 1 wieder 32px)");

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

// ---- Die Zellen, die die Spalten füllen ------------------------------------------------------------
// 🔴 Hier laufen die Zeilenbauer WIRKLICH (gegen das kleine DOM oben). Die Spalten aus dem CSS sind
// nur die eine Hälfte -- die andere ist, dass jede Zeile die passenden Zellen mitbringt.
const changeLogGroupHeader = sandbox.changeLogGroupHeader;
const changeLogEntryRow = sandbox.changeLogEntryRow;

// 🪤 changeLogGroupHeader ruft changeLogHeute() SELBST auf und liest damit die echte Systemzeit --
// nicht das HEUTE von oben, das nur die reine changeLogFormatTime bekommt. Ein festes Datum in den
// Buendeln hier unten ist deshalb genau EINEN Tag lang gruen: am 23.08.2026 kippte der Test von
// selbst um ("22.08. 12:38" statt "12:38"), ohne dass jemand Code angefasst hatte -- und weil der
// Deploy ein Tor ist, hielt er ab da JEDEN Push zurueck, auch fremde. Das Datum kommt darum aus dem
// Kalender; die Uhrzeiten bleiben fest, denn genau sie werden geprueft.
const HEUTE_ECHT = (() => {
	const jetzt = new Date();
	const zwei = (zahl) => String(zahl).padStart(2, "0");

	return `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}`;
})();
for (const [name, fn] of [["changeLogGroupHeader", changeLogGroupHeader], ["changeLogEntryRow", changeLogEntryRow]]) {
	assert.strictEqual(typeof fn, "function", name + " ist geladen");
}
const buendel = {
	key: "Reichsstraße 2|nics|1",
	target: "Reichsstraße 2",
	actor: "nics",
	entries: [
		{ id: 1, name: "Reichsstraße 2", action: "update_path", username: "nics", created_at: HEUTE_ECHT + " 12:38:00" },
		{ id: 2, name: "Reichsstraße 2", action: "update_path", username: "nics", created_at: HEUTE_ECHT + " 12:36:00" },
		{ id: 3, name: "Reichsstraße 2", action: "update_path", username: "nics", created_at: HEUTE_ECHT + " 12:34:00" },
	],
};
const kopf = changeLogGroupHeader(buendel);
const zelle = (el, klasse) => el.querySelector("." + klasse);
assert.strictEqual(zelle(kopf, "change-log-group__name").textContent, "Reichsstraße 2", "Spalte 2: der Titel");
assert.strictEqual(zelle(kopf, "change-log-group__actor").textContent, "nics", "Spalte 3: der Name");

// 🔴 „3×" statt „3 Änderungen": in einer eigenen Spalte kostete das Wort 74 statt 13 Pixel, und das
// ging bei 361px Zeilenbreite direkt vom Titel ab. Das Wort steht im `title`, es geht nicht verloren.
assert.strictEqual(zelle(kopf, "change-log-group__count").textContent, "3×", "Spalte 4: die Anzahl, kurz");
assert.strictEqual(zelle(kopf, "change-log-group__count").title, "3 Änderungen", "und ausgeschrieben im title");

// ⚠️ Die Zeitspalte zeigt EINEN Zeitpunkt, den jüngsten -- die Spanne hiesse an einem älteren Tag
// „19.08. 12:34–19.08. 12:38" und sprengte jede Spalte. Sie bleibt im `title`, und genau deshalb ist
// changeLogGroupTimeLabel weiter verdrahtet und nicht toter Code mit lebendem Test.
assert.strictEqual(zelle(kopf, "change-log-group__time").textContent, "12:38", "Spalte 5: der jüngste Zeitpunkt");
assert.strictEqual(zelle(kopf, "change-log-group__time").title, "12:34–12:38", "die Spanne bleibt im title erreichbar");

// 🔴 EINE EINZELNE ÄNDERUNG IST AUCH EIN BÜNDEL -- mit Dreieck, aufklappbar, „1×" in der Anzahl.
// Owner 22.08.2026: „sodass alles einheitlich ist."
const einzelBuendel = {
	key: "Gareth|nics|9",
	target: "Gareth",
	actor: "nics",
	entries: [{ id: 9, name: "Gareth", action: "update_location", username: "nics", created_at: HEUTE_ECHT + " 12:28:00" }],
};
const einzelKopf = changeLogGroupHeader(einzelBuendel);
assert.strictEqual(zelle(einzelKopf, "change-log-group__count").textContent, "1×", "auch eine einzelne Änderung zählt sichtbar");
assert.ok(zelle(einzelKopf, "change-log-group__caret").textContent.length > 0, "und trägt ein Dreieck wie jede andere Zeile");
assert.strictEqual(zelle(einzelKopf, "change-log-group__name").textContent, "Gareth", "ihr Name steht in der Kopfzeile");

// 🔴 Damit gibt es nur noch EINE Sorte Zeile unter einer Kopfzeile: Spalte 2 trägt die AKTION (der
// Name steht darüber). Sie leer zu lassen wäre die Alternative gewesen -- dann stünde jede Zeile
// eines offenen Bündels ohne Kopf da und schöbe ihren Text allein in die zweite Zeile.
const kindZeile = changeLogEntryRow(buendel.entries[0]);
assert.strictEqual(changeLogEntryRow.length, 1, "der Zeilenbauer kennt keinen zweiten Bauweg mehr");
assert.ok(kindZeile.classList.contains("change-log-entry--grouped"), "jede Zeile ist eine Bündelzeile");
assert.notStrictEqual(zelle(kindZeile, "change-log-entry__target").textContent, "Reichsstraße 2", "der Name wird NICHT wiederholt");
assert.ok(zelle(kindZeile, "change-log-entry__target").textContent.length > 0, "aber Spalte 2 bleibt gefüllt -- mit der Aktion");
assert.ok(
	zelle(kindZeile, "change-log-entry__target").classList.contains("change-log-entry__target--action"),
	"und sie ist als Aktion gekennzeichnet, damit sie nicht fett wie eine Überschrift steht",
);

// 🪤 KEINE Urheberzelle mehr. Hier stand, sie müsse leer stehenbleiben, „sonst rutschten Zeit und
// Rückgängig nach links" -- das war falsch und ist am 22.08.2026 im Browser widerlegt worden: jede
// Zelle nennt ihre Spalte selbst, und eine feste Platzierung verschiebt sich nicht, wenn eine andere
// Zelle fehlt. Das Argument gälte nur bei automatischer Platzierung.
assert.strictEqual(zelle(kindZeile, "change-log-entry__actor"), null, "die Urheberzelle ist weg -- sie wäre immer leer");

// ⚠️ Die alten Hüllen sind weg: ein Rasterplatz wird nur an DIREKTE Kinder vergeben, __body und __l1
// hätten die Spalten der Zellen darin verschluckt.
for (const alt of ["change-log-entry__body", "change-log-entry__l1"]) {
	assert.strictEqual(zelle(kindZeile, alt), null, "die Hülle ." + alt + " gibt es nicht mehr");
}

console.log("change-log-buendel ok");
