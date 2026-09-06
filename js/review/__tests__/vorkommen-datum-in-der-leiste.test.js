// Die Leiste zeigt „Vorkommen" sein Datum aus DERSELBEN Antwort wie alle anderen Subjekte -- und
// aus keiner zweiten.
//
// Owner 06.09.2026 (mit Bild): „bei vorkommen steht nie dran wann gesynct wurde - nur wenn ich
// paar mal drauf klickt kommt das datum".
//
// 💣 DER FEHLER hatte zwei Haelften. Serverseitig fehlte `lore` in avesmapsWikiDumpSyncKindLastSynced
// (api/_internal/wiki/__tests__/vorkommen-datum-in-der-leiste-test.php haelt das). Clientseitig
// gab es einen ZWEITEN Schreiber fuer dasselbe Feld: die Vorkommen-LISTE haengte ihr `last_synced`
// in wikiSyncKindSyncedRaw ein -- nur beim Laden des Panels, also erst nach dem Klick, asynchron
// und mit jedem weiteren Klick verworfen. Zwei Stellen fuer dasselbe Feld sind genau der Grund,
// warum das Fehlen bei Wegen und Regionen einmal wochenlang unbemerkt blieb
// (refreshWikiSyncKindSyncedStatus, Kommentar dort). Seither gibt es EINEN Schreiber.
//
// Run: node js/review/__tests__/vorkommen-datum-in-der-leiste.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let checks = 0;

// ---- 1. Die Leiste, wirklich ausgefuehrt ----------------------------------------------------
// Ein Regex auf `wikiSyncRailDateText` saehe nicht, ob die Antwort des Servers je bei der Zeile
// ankommt. Also: refreshWikiSyncKindSyncedStatus mit gefaelschter Serverantwort fahren und die
// gebauten Zeilen lesen.

function element(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		style: {},
		attributes: {},
		children: [],
		textContent: "",
		className: "",
		title: "",
		hidden: false,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		setAttribute(name, value) { this.attributes[name] = String(value); },
		getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
		addEventListener() {},
		appendChild(child) { this.children.push(child); return child; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		closest() { return null; },
	};
	let html = "";
	// Ein `innerHTML = ""` leert im Browser auch die Kinder -- die Leiste tut genau das vor jedem Neubau.
	Object.defineProperty(el, "innerHTML", {
		get() { return html; },
		set(value) { html = String(value); if (html === "") { el.children.length = 0; } },
	});
	return el;
}

const rail = element("div");
const document = {
	getElementById: (id) => (id === "wiki-sync-subject-rail" ? rail : null),
	querySelectorAll: () => [],
	querySelector: () => null,
	addEventListener() {},
	createElement: element,
	body: element("body"),
	head: element("head"),
};

const warnungen = [];
const antwort = {
	settlement: "2026-09-02 02:19:00",
	lore: "2026-09-05 12:00:00",
	adventure: null,
	// territory fehlt bewusst: „dazu kam keine Antwort" muss von „nie" unterscheidbar bleiben.
};
const context = {
	window: {},
	document,
	console: Object.assign({}, console, { warn: (...args) => warnungen.push(args.join(" ")) }),
	setTimeout,
	clearTimeout,
	// Der Abruf, den die echte Datei aus api-client.js bekommt -- hier die gefaelschte Serverkarte.
	fetchWikiSyncKindLastSynced: async () => Object.assign({}, antwort),
};
context.globalThis = context;
vm.createContext(context);
// Dieselbe Reihenfolge wie index.html: Escaper, Registry, Statuskreis, dann die Datei.
vm.runInContext(lies("js/app/utils.js"), context);
vm.runInContext(lies("js/review/review-subjects.js"), context);
vm.runInContext(lies("js/ui/listen-statuskreis.js"), context);
// Das aktive Subjekt lebt als `let` in js/app/runtime-state.js (mit der halben App daneben); hier
// nur diese eine Bindung, mit demselben Startwert.
vm.runInContext('let activeWikiSyncPanelTab = "locations";', context);
vm.runInContext(lies("js/review/review-wiki-sync.js"), context);

assert.strictEqual(typeof context.refreshWikiSyncKindSyncedStatus, "function", "refreshWikiSyncKindSyncedStatus ist global");
checks++;

function zeile(subjectKey) {
	const row = rail.children.find((child) => child.getAttribute("data-wiki-sync-panel-tab") === subjectKey);
	assert.ok(row, `die Leiste traegt eine Zeile fuer ${subjectKey}`);
	const datum = row.innerHTML.match(/wiki-sync-rail__date">([^<]*)</);
	assert.ok(datum, `die Zeile ${subjectKey} traegt eine Datumszelle`);
	return { datum: datum[1], title: row.title };
}

(async () => {
	await context.refreshWikiSyncKindSyncedStatus();

	assert.deepStrictEqual(warnungen, [], "der Abruf faellt nicht in den catch-Zweig");
	checks++;
	assert.ok(rail.children.length >= 8, `die Leiste ist gebaut (${rail.children.length} Zeilen)`);
	checks++;

	const vorkommen = zeile("lore");
	assert.strictEqual(vorkommen.datum, "05.09.",
		"Vorkommen zeigt sein Datum aus der Serverkarte -- OHNE dass jemand das Subjekt angeklickt oder die Liste geladen hat");
	checks++;
	assert.ok(vorkommen.title.startsWith("Vorkommen — Zuletzt gesynct: "),
		`der Tooltip nennt das Datum in Langform (got ${JSON.stringify(vorkommen.title)})`);
	checks++;

	assert.strictEqual(zeile("locations").datum, "02.09.", "Orte lesen weiterhin aus derselben Karte");
	checks++;
	assert.strictEqual(zeile("adventures").datum, "nie", "ein null vom Server ist „nie“ -- nachweislich nie gesynct");
	checks++;
	const territorien = zeile("territories");
	assert.strictEqual(territorien.datum, "", "ein FEHLENDER Schluessel bleibt leer -- dazu kam keine Antwort");
	checks++;
	assert.ok(territorien.title.endsWith("Zuletzt gesynct: unbekannt"),
		"und sein Tooltip sagt „unbekannt“, nicht „Noch nie gesynct“");
	checks++;

	// ---- 2. EIN Schreiber: die Vorkommen-Liste haengt nichts mehr in die Karte der Leiste ----
	// Kommentare vorher entfernen: der Hinweis, WARUM es die Stelle nicht mehr gibt, darf den Namen
	// nennen, ohne dass dieser Test daran anschlaegt.
	const ohneKommentare = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
	const loreListe = ohneKommentare(lies("js/review/review-wiki-sync-lore-list.js"));
	assert.ok(!/\bwikiSyncKindSyncedRaw\b/.test(loreListe),
		"review-wiki-sync-lore-list.js schreibt NICHT mehr in wikiSyncKindSyncedRaw -- das Datum der Leiste hat "
		+ "einen Schreiber (refreshWikiSyncKindSyncedStatus), sonst heilt die Liste nach dem Klick still, "
		+ "was die Serverkarte gerade wieder verloren hat");
	checks++;

	// ---- 3. Nach der Uebernahme frischt derselbe Schreiber die Leiste auf -------------------
	// Vorher tat das die Liste (loadLoreList("panel") -> Injektion). Faellt die Injektion, muss der
	// onApplied-Zweig der Vorkommen-Vorschau den einen Schreiber rufen -- wie Literatur es tut.
	const src = lies("js/review/review-wiki-sync.js");
	const von = src.indexOf('kind: "lore",');
	assert.ok(von > 0, "die Vorkommen-Vorschau (openSyncPlanSheet kind: \"lore\") steht in review-wiki-sync.js");
	checks++;
	const onApplied = src.indexOf("onApplied", von);
	assert.ok(onApplied > von, "die Vorkommen-Vorschau hat einen onApplied-Zweig");
	checks++;
	const zweig = src.slice(onApplied, src.indexOf("});", onApplied));
	assert.ok(zweig.includes("refreshWikiSyncKindSyncedStatus("),
		"nach der Uebernahme ruft die Vorkommen-Vorschau refreshWikiSyncKindSyncedStatus -- die Leiste "
		+ "zeigt sonst bis zum Neuladen den alten Stempel");
	checks++;

	// ---- 4. Der LAUF frischt die Leiste auf, nicht erst die Uebernahme -----------------------
	// Owner 06.09.2026: „man soll wissen, wann zuletzt gesynct wurde. ob was gesynct wurde ist dabei
	// egal". Der Server stempelt seither im Fertig-Zweig von sync_lore (sync-lauf-stempel-test.php);
	// der Client muss die Leiste nach dem Rechenlauf holen -- VOR der Vorschau und unabhaengig davon,
	// ob jemand etwas uebernimmt. Ein Lauf mit null Unterschieden zeigt sonst weiter das alte Datum,
	// obwohl der Server laengst das neue traegt. Dieselbe Stelle wie bei Literatur und Karten.
	const lauf = src.indexOf("async function startWikiSyncLoreSync(");
	assert.ok(lauf > 0, "startWikiSyncLoreSync steht in review-wiki-sync.js");
	checks++;
	const rechenlauf = src.indexOf("runWikiSyncLoreSyncLoop(", lauf);
	const vorschau = src.indexOf("openSyncPlanSheet({", lauf);
	assert.ok(rechenlauf > lauf && vorschau > rechenlauf, "im Lauf folgt auf den Rechenlauf die Vorschau");
	checks++;
	const zwischen = src.slice(rechenlauf, vorschau);
	assert.ok(zwischen.includes("refreshWikiSyncKindSyncedStatus("),
		"nach dem Rechenlauf und VOR der Vorschau frischt startWikiSyncLoreSync die Leiste auf -- "
		+ "sonst rueckt ein Lauf mit null Unterschieden das Datum nicht vor, obwohl der Server gestempelt hat");
	checks++;

	console.log(`OK vorkommen-datum-in-der-leiste (${checks} Zusicherungen)`);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
