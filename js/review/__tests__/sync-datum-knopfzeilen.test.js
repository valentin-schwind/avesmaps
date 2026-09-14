// „Zuletzt gesynct" an den Knoepfen: EINE Quelle (die Serverkarte), EIN Datumsbauer, Ortszeit.
//
// Owner-Entscheid 14.09.2026 („fixen") auf zwei Befunde aus der Sitzung „Sync-Datum bei Vorkommen":
//
// 💣 1. Das Datum unter „Vorkommen bearbeiten" kam aus der Vorkommen-LISTE (renderLoreLastSynced),
//    die Auswahlzeile aus der Serverkarte (refreshWikiSyncKindSyncedStatus). Nach einem Lauf ohne
//    Uebernahme frischt nur die Karte auf -- die Leiste zeigte das neue Datum, der Knopf bis zum
//    naechsten Klick das alte. Dieselbe Doppelung steckte im Fertig-Zweig eines Kind-Syncs: er schrieb
//    das Datum des LAUFS in den Knopf, die Karte meint den Stand der Tabelle.
// 💣 2. Literatur, Karten, Kraftlinien und Vorkommen stempeln UTC (gmdate) in app_setting, und jede
//    Knopfzeile las den Wert als Ortszeit -- im Sommer zwei Stunden zu frueh. Gemessen am Dump vom
//    08.09.2026: `lore_last_synced` traegt 13:40:26 im Wert und 15:40:26 in `updated_at` derselben
//    Zeile. Die Karte kennzeichnet solche Werte seither mit „Z" (vorkommen-datum-in-der-leiste-test.php,
//    Abschnitt 6); DIESER Test haelt fest, dass der Bauer beide Formen richtig liest.
//
// ⚠️ Die Zeitzone ist TRAGEND. Im Tor (GitHub-Runner, UTC) ist Ortszeit gleich UTC, und genau dieser
//    Fehler waere dort unsichtbar -- also Europe/Berlin fest, und geprueft, dass es wirkt.
//
// ⭐ Alles wird AUSGEFUEHRT, nichts gegrept: die echte review-wiki-sync.js und die echte Vorkommen-Liste
//    laufen gegen eine gefaelschte Serverkarte, einen gefaelschten Katalogabruf und ein Attrappen-DOM.
//
// Run: node js/review/__tests__/sync-datum-knopfzeilen.test.js

"use strict";

process.env.TZ = "Europe/Berlin";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

assert.strictEqual(new Date(Date.UTC(2026, 8, 5, 12, 0, 0)).getHours(), 14,
	"TZ=Europe/Berlin wirkt nicht -- ohne sie prueft dieser Test nichts, weil UTC und Ortszeit zusammenfallen");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let checks = 0;

function element(tag, id) {
	const el = {
		id: id || "",
		tagName: String(tag).toUpperCase(),
		style: { setProperty() {} },
		dataset: {},
		attributes: {},
		children: [],
		textContent: "",
		className: "",
		title: "",
		hidden: true,
		value: "",
		clientHeight: 0,
		scrollHeight: 0,
		scrollTop: 0,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		setAttribute(name, value) { this.attributes[name] = String(value); },
		getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
		addEventListener() {},
		appendChild(child) { this.children.push(child); return child; },
		append(...kinder) { this.children.push(...kinder); },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		closest() { return null; },
		insertAdjacentHTML() {},
	};
	let html = "";
	Object.defineProperty(el, "innerHTML", {
		get() { return html; },
		set(value) { html = String(value); if (html === "") { el.children.length = 0; } },
	});
	return el;
}

// Die acht Knopfzeilen -- je Art der Span, den index.html im Knopf traegt.
const KNOPFZEILE = {
	settlement: "settlement-editor-synced",
	path: "path-editor-synced",
	region: "ecosystem-editor-synced",
	territory: "wiki-sync-territory-synced",
	adventure: "game-literature-editor-synced",
	citymap: "citymaps-editor-synced",
	powerline: "powerline-editor-synced",
	lore: "wiki-sync-lore-synced",
};

const elemente = new Map();
[
	"wiki-sync-subject-rail", "wiki-sync-sync-path",
	"lore-dlg-scroll", "lore-dlg-search", "lore-dlg-count",
	...Object.values(KNOPFZEILE),
].forEach((id) => elemente.set(id, element("div", id)));
const knopfzeile = (kind) => elemente.get(KNOPFZEILE[kind]);

const document = {
	getElementById: (id) => elemente.get(id) || null,
	querySelectorAll: () => [],
	querySelector: () => null,
	addEventListener() {},
	createElement: (tag) => element(tag),
	body: element("body"),
	head: element("head"),
};

let karte = {};
let listenAntwort = null;
const abrufe = [];
const warnungen = [];
const context = {
	window: { setTimeout, clearTimeout },
	document,
	console: Object.assign({}, console, { warn: (...args) => warnungen.push(args.join(" ")) }),
	setTimeout,
	clearTimeout,
	// Die Serverkarte, wie api-client.js sie liefert.
	fetchWikiSyncKindLastSynced: async () => Object.assign({}, karte),
	// Der Katalogabruf der Vorkommen-Liste (api/app/lore.php).
	fetch: async (url) => {
		abrufe.push(String(url));
		return { ok: true, json: async () => listenAntwort };
	},
};
context.globalThis = context;
vm.createContext(context);
// Dieselbe Reihenfolge wie index.html.
vm.runInContext(lies("js/app/utils.js"), context);
vm.runInContext(lies("js/review/review-subjects.js"), context);
vm.runInContext(lies("js/ui/listen-statuskreis.js"), context);
vm.runInContext('let activeWikiSyncPanelTab = "locations";', context);
vm.runInContext(lies("js/review/review-wiki-sync.js"), context);
vm.runInContext(lies("js/review/review-wiki-sync-lore-list.js"), context);

function leistenZeile(subjectKey) {
	const rail = elemente.get("wiki-sync-subject-rail");
	const row = rail.children.find((child) => child.getAttribute("data-wiki-sync-panel-tab") === subjectKey);
	assert.ok(row, `die Leiste traegt eine Zeile fuer ${subjectKey}`);
	const datum = row.innerHTML.match(/wiki-sync-rail__date">([^<]*)</);
	return { datum: datum ? datum[1] : null, title: row.title };
}

(async () => {
	// ---- 1. Die Serverkarte erreicht ALLE acht Knopfzeilen, in Ortszeit ----------------------
	// Zwei Formen stehen in der Karte, und beide sind eindeutig: ein naives DATETIME ist Sitzungszeit
	// der DB (Europe/Berlin), ein Wert mit „Z" ist UTC.
	karte = {
		settlement: "2026-09-02 02:19:00.123",
		path: "2026-09-03 10:00:00.000",
		region: null,
		territory: "2026-09-04 08:00:00",
		adventure: "2026-09-02T12:16:27Z",
		citymap: "2026-09-02T12:33:38Z",
		powerline: null,
		// Kurz vor Mitternacht UTC: in Ortszeit ist es schon der NAECHSTE Tag -- auch die Leiste.
		lore: "2026-09-05T23:30:00Z",
	};
	await context.refreshWikiSyncKindSyncedStatus();
	assert.deepStrictEqual(warnungen, [], "der Abruf faellt nicht in den catch-Zweig");
	checks++;

	const erwartet = {
		settlement: "Zuletzt gesynct: 02.09.2026, 02:19",
		path: "Zuletzt gesynct: 03.09.2026, 10:00",
		region: "Noch nie gesynct",
		territory: "Zuletzt gesynct: 04.09.2026, 08:00",
		adventure: "Zuletzt gesynct: 02.09.2026, 14:16",
		citymap: "Zuletzt gesynct: 02.09.2026, 14:33",
		powerline: "Noch nie gesynct",
		lore: "Zuletzt gesynct: 06.09.2026, 01:30",
	};
	Object.keys(erwartet).forEach((kind) => {
		assert.strictEqual(knopfzeile(kind).textContent, erwartet[kind],
			`Knopfzeile ${kind} liest die Serverkarte in Ortszeit (Karte: ${JSON.stringify(karte[kind])})`);
		assert.strictEqual(knopfzeile(kind).hidden, false, `Knopfzeile ${kind} ist sichtbar`);
		checks += 2;
	});

	// ---- 2. EIN Bauer: Knopfzeile, Tooltip und Kurzdatum der Leiste sagen dasselbe --------------
	const subjekte = vm.runInContext("WIKI_SYNC_SUBJECTS", context);
	subjekte.forEach((subject) => {
		const kind = subject.syncKind;
		if (!kind || !KNOPFZEILE[kind]) {
			return;
		}
		const zeile = leistenZeile(subject.key);
		const knopf = knopfzeile(kind).textContent;
		assert.strictEqual(zeile.title, subject.label + " — " + knopf,
			`Tooltip der Leiste und Knopfzeile von ${subject.key} kommen aus demselben Bauer`);
		const tag = knopf.match(/(\d{2}\.\d{2}\.)\d{4}/);
		assert.strictEqual(zeile.datum, tag ? tag[1] : "nie",
			`das Kurzdatum der Leiste (${zeile.datum}) ist der Tag der Knopfzeile (${knopf})`);
		checks += 2;
	});

	// ---- 3. Die Vorkommen-Liste schreibt die Knopfzeile NICHT mehr ---------------------------
	// Ihr Katalog traegt weiterhin ein `last_synced` (der oeffentliche Leser in api/_internal/app/lore.php).
	// Ein aelterer Wert darin darf das Datum der Karte nicht ueberschreiben -- genau das war die Luecke.
	listenAntwort = { ok: true, items: [], total: 0, q: "", last_synced: "2026-09-01 08:00:00", continents: [], origins: [] };
	vm.runInContext('loadLoreList("dialog");', context);
	await tick();
	await tick();
	await tick();
	assert.ok(abrufe.some((url) => url.indexOf("api/app/lore.php?catalog=1") === 0),
		"der Listen-Ablauf lief wirklich (Katalogabruf abgesetzt)");
	assert.strictEqual(elemente.get("lore-dlg-count").textContent, "0 von 0",
		"und seine Antwort wurde verarbeitet -- sonst waere die folgende Zusicherung leer");
	assert.strictEqual(knopfzeile("lore").textContent, erwartet.lore,
		"die Vorkommen-Liste ueberschreibt die Knopfzeile nicht mit ihrem eigenen Stempel");
	checks += 3;

	// ---- 4. Ein Lauf OHNE Uebernahme: die Knopfzeile folgt der Karte -------------------------
	// startWikiSyncLoreSync ruft nach dem Rechenlauf refreshWikiSyncKindSyncedStatus
	// (vorkommen-datum-in-der-leiste.test.js, Abschnitt 4) -- das muss jetzt auch den Knopf treffen.
	karte = Object.assign({}, karte, { lore: "2026-09-14T10:05:00Z" });
	await context.refreshWikiSyncKindSyncedStatus();
	assert.strictEqual(knopfzeile("lore").textContent, "Zuletzt gesynct: 14.09.2026, 12:05",
		"nach dem Lauf zeigt „Vorkommen bearbeiten“ sofort das neue Datum -- ohne Klick");
	assert.strictEqual(leistenZeile("lore").datum, "14.09.", "und die Leiste dasselbe");
	checks += 2;

	// ---- 5. Der Fertig-Zweig eines Kind-Syncs liest die KARTE, nicht den Lauf -----------------
	karte = Object.assign({}, karte, { path: "2026-09-14 12:00:00.000" });
	context.renderWikiSyncKindProgress("path", { processed: 3, total: 3 }, true, { completed_at: "2026-09-14 11:58:00.000" });
	await tick();
	await tick();
	assert.strictEqual(knopfzeile("path").textContent, "Zuletzt gesynct: 14.09.2026, 12:00",
		"nach „Wege syncen“ steht das Datum der Serverkarte am Knopf -- dasselbe, das nach einem Neuladen dort steht");
	assert.strictEqual(leistenZeile("paths").datum, "14.09.", "und die Leiste zieht im selben Zug nach");
	checks += 2;

	console.log(`OK sync-datum-knopfzeilen (${checks} Zusicherungen)`);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
